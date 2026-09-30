/**
 * Detección de esquemas desactualizados.
 *
 * Cuando el mismo agente, el mismo día de la semana, marca distinto a su
 * esquema semana tras semana, eso no es una excepción: es el esquema que quedó
 * viejo. Cada semana genera un día para normalizar, y el supervisor termina
 * resolviendo el mismo caso cuatro veces por mes —o peor, pagándolo mal todas
 * las veces sin darse cuenta.
 *
 * Esto mira una ventana de semanas y propone el horario que el agente viene
 * haciendo, para corregir la causa una vez en lugar del síntoma cada semana.
 * Es una sugerencia: el horario acordado lo decide una persona.
 */
import {
  DEFAULT_MARGINS,
  blockToRange,
  minutesToTime,
  settleDays,
  unionRanges,
  type ClockObservation,
  type DayContext,
  type NormalizationMargins,
  type ScheduleSlot,
  type TimeBlock,
} from './settlement-calc.js';

export interface DriftSuggestion {
  /** Convención JS: 0 = domingo */
  day_of_week: number;
  current: TimeBlock[];
  suggested: TimeBlock[];
  /** Días con el desvío */
  occurrences: number;
  /** Días que se pudieron comparar */
  sample: number;
  dates: string[];
  /** Mediana del corrimiento del primer ingreso contra el inicio del plan, en minutos */
  startShiftMinutes: number;
  /** Mediana del corrimiento del último egreso contra el fin del plan, en minutos */
  endShiftMinutes: number;
  /** Horas semanales que cambia el esquema si se acepta */
  hoursDelta: number;
  /** Días de la muestra que hoy hay que normalizar, y los que quedarían */
  reviewBefore: number;
  reviewAfter: number;
}

export interface DetectDriftInput {
  days: DayContext[];
  schedulesByDate: (date: string) => ScheduleSlot[];
  observations: Map<string, ClockObservation>;
  margins?: Partial<NormalizationMargins>;
  /** Mínimo de días con el mismo desvío. Por defecto 3. */
  minOccurrences?: number;
  /** Proporción mínima de días comparables que tienen que mostrarlo. Por defecto 0,75. */
  minShare?: number;
  /** Días ya resueltos por un supervisor: no cuentan, la decisión ya está tomada */
  correctedDates?: Set<string>;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** Redondea a los 15 minutos más cercanos: los esquemas se acuerdan así. */
const toQuarter = (min: number) => Math.round(min / 15) * 15;

export function detectScheduleDrift(input: DetectDriftInput): DriftSuggestion[] {
  const m = { ...DEFAULT_MARGINS, ...input.margins };
  const minOccurrences = input.minOccurrences ?? 3;
  const minShare = input.minShare ?? 0.75;

  // Agrupar por día de la semana los días comparables: con esquema, sin
  // feriado ni excepción, y con marcación completa
  type Muestra = { date: string; startDelta: number; endDelta: number; first: number; last: number; plan: TimeBlock[] };
  const porDia = new Map<number, Muestra[]>();

  for (const day of input.days) {
    if (day.isHoliday || day.exception) continue;
    if (input.correctedDates?.has(day.date)) continue;

    const slots = input.schedulesByDate(day.date);
    if (slots.length === 0) continue;
    const obs = input.observations.get(day.date);
    if (!obs || obs.incomplete || !obs.segments?.length) continue;

    const plan = slots
      .map((s) => ({ start_time: s.start_time, end_time: s.end_time }))
      .sort((a, b) => blockToRange(a)[0] - blockToRange(b)[0]);
    const planR = unionRanges(plan.map(blockToRange));
    const markR = unionRanges(obs.segments.map((s) => blockToRange({ start_time: s.clockIn, end_time: s.clockOut })));
    if (markR.length === 0) continue;

    const first = markR[0][0];
    const last = markR[markR.length - 1][1];
    const dow = new Date(day.date + 'T12:00:00').getDay();
    const list = porDia.get(dow) ?? [];
    list.push({
      date: day.date,
      startDelta: first - planR[0][0],
      endDelta: last - planR[planR.length - 1][1],
      first,
      last,
      plan,
    });
    porDia.set(dow, list);
  }

  const out: DriftSuggestion[] = [];

  // Cuántos de estos días habría que normalizar con un plan dado. Se usa para
  // validar la sugerencia: si con el horario propuesto no cierran más días
  // solos, no es una buena sugerencia, por más que sea "lo que marca".
  const aRevisar = (dow: number, plan: TimeBlock[], fechas: string[]) => {
    const slots: ScheduleSlot[] = plan.map((b) => ({ day_of_week: dow, start_time: b.start_time, end_time: b.end_time, client_id: null }));
    const r = settleDays({
      days: fechas.map((date) => ({ date, isHoliday: false, exception: null })),
      schedulesByDate: () => slots,
      overtime: [],
      observations: input.observations,
      margins: m,
    });
    return r.days.filter((d) => d.status === 'needs_review').length;
  };

  for (const [dow, muestras] of porDia) {
    // Sólo cuentan los corrimientos que mueven la plata o el plan: llegar tarde,
    // irse antes, quedarse de más, o empezar mucho antes. Llegar diez minutos
    // antes no es un esquema viejo.
    const desviados = muestras.filter(
      (x) =>
        x.startDelta > m.lateArrivalMinutes ||
        x.startDelta < -m.additionalThresholdMinutes ||
        x.endDelta > m.additionalThresholdMinutes ||
        x.endDelta < -m.earlyDepartureMinutes
    );
    if (desviados.length < minOccurrences) continue;
    if (desviados.length / muestras.length < minShare) continue;

    // El horario típico, respetando los tramos: la cantidad de tramos más
    // frecuente, y la mediana de cada corte entre los días que tienen esa
    // cantidad. Fundir dos tramos con almuerzo en uno solo generaría un desvío
    // "en medio de la jornada" todas las semanas.
    const tramosDe = (date: string) =>
      unionRanges(
        (input.observations.get(date)?.segments ?? []).map((sg) =>
          blockToRange({ start_time: sg.clockIn, end_time: sg.clockOut })
        )
      );
    const conteo = new Map<number, string[]>();
    for (const x of desviados) {
      const n = tramosDe(x.date).length;
      conteo.set(n, [...(conteo.get(n) ?? []), x.date]);
    }
    const [cantidad, fechasTipo] = [...conteo.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    if (fechasTipo.length < minOccurrences) continue;

    const suggested: TimeBlock[] = [];
    for (let i = 0; i < cantidad; i++) {
      const inicios = fechasTipo.map((f) => tramosDe(f)[i][0]);
      const fines = fechasTipo.map((f) => tramosDe(f)[i][1]);
      suggested.push({
        start_time: minutesToTime(toQuarter(median(inicios))),
        end_time: minutesToTime(toQuarter(median(fines))),
      });
    }

    const current = muestras[muestras.length - 1].plan;
    if (
      suggested.length === current.length &&
      suggested.every((b, i) => b.start_time === current[i].start_time && b.end_time === current[i].end_time)
    ) {
      continue;
    }

    // Validación: con el horario sugerido tienen que cerrar solos claramente
    // más días de los que cierran hoy
    const fechas = muestras.map((x) => x.date);
    const reviewBefore = aRevisar(dow, current, fechas);
    const reviewAfter = aRevisar(dow, suggested, fechas);
    if (reviewBefore - reviewAfter < Math.max(2, Math.ceil(reviewBefore / 2))) continue;

    const horas = (bs: TimeBlock[]) =>
      bs.reduce((acc, b) => {
        const [a, c] = blockToRange(b);
        return acc + (c - a) / 60;
      }, 0);

    out.push({
      day_of_week: dow,
      current,
      suggested,
      occurrences: desviados.length,
      sample: muestras.length,
      dates: desviados.map((x) => x.date),
      startShiftMinutes: Math.round(median(desviados.map((x) => x.startDelta))),
      endShiftMinutes: Math.round(median(desviados.map((x) => x.endDelta))),
      hoursDelta: Math.round((horas(suggested) - horas(current)) * 100) / 100,
      reviewBefore,
      reviewAfter,
    });
  }

  return out.sort((a, b) => a.day_of_week - b.day_of_week);
}
