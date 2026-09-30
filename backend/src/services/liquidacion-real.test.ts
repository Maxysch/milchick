/**
 * El motor contra lo que efectivamente se liquidó en julio y agosto 2026, con
 * las marcaciones reales del presentismo.
 *
 * Los fixtures salen de validacion/generar_fixture.py: el esquema de cada
 * agente, sus marcaciones día por día, las horas que la planilla pagó con
 * recargo (que acá entran como horas autorizadas) y lo liquidado día por día,
 * banda por banda.
 *
 * Qué se prueba:
 *   1. Cuánto se resuelve solo.
 *   2. Que ningún día se pague distinto de la planilla sin avisar, salvo los
 *      que dependen de un dato que el sistema no tiene.
 *   3. Que cada decisión que tomó el liquidador se pueda expresar con las
 *      acciones del sistema, y que aplicándolas el neto dé el de la planilla.
 *   4. Qué tan seguido la sugerencia del sistema coincide con esa decisión.
 */
import { describe, it, expect } from 'vitest';
import {
  computeConcepts,
  computeItemAmount,
  computeRate,
  roundCents,
  settleDays,
  suggestResolution,
  DEFAULT_RATE_FACTORS,
  type Band,
  type ClockObservation,
  type CorrectionLine,
  type DayContext,
  type DayCorrection,
  type DailyLine,
  type OvertimeRecord,
  type ResolutionAction,
  type ScheduleSlot,
  type SettleDaysResult,
  type SettlementParams,
  type Tier,
} from './settlement-calc.js';
import { detectScheduleDrift } from './schedule-drift.js';
import julio from './__fixtures__/julio-2026.json' with { type: 'json' };
import agosto from './__fixtures__/agosto-2026.json' with { type: 'json' };

type Fixture = typeof agosto;
type Agente = Fixture['agents'][number];

// ─── Datos que el sistema tendría cargados y la planilla no guarda ────────────

/** Los cinco ingresos de agosto hicieron la inducción el 07/08. */
const FECHA_DE_INGRESO: Record<string, string> = Object.fromEntries(
  ['Di Mario Norberto', 'Menéndez Lourdes', 'Noverazco Pamela', 'Papaianni Sabrina', 'Rodriguez Gabriela']
    .map((n) => [n, '2026-08-07'])
);

/** Compensación especial: 45 minutos por día trabajado. */
const COMPENSACION: Record<string, number> = { 'Paola Farías': 45 };

/**
 * Micaela es el único cambio deliberado: su hoja liquida el Adicional al 20% y
 * el resto al 25%. El motor usa 25% para todos.
 */
const CORRECCION_ADICIONAL: Record<string, Record<string, number>> = {
  julio: { 'Micaela Abraham': 246.45 },
  agosto: { 'Micaela Abraham': 1034.95 },
};

/**
 * Lo que la planilla sumó por fuera de las horas y del cálculo de conceptos,
 * y que el fixture no recoge porque está metido adentro de una fórmula.
 */
const ITEMS_POR_HORA: Record<string, Record<string, number>> = {
  // '=(9*E43*D59)+(E43*0,66)': el ajuste de 40 minutos junto a la compensación
  agosto: { 'Paola Farías': 0.66 },
};

/**
 * Esquemas desactualizados, corregidos al horario acordado.
 *
 * El detector los marca (ver el test de abajo). Lo que carga el supervisor es
 * el horario que efectivamente se acordó, que no siempre es el que sugiere: la
 * sugerencia sale de lo marcado y se redondea al cuarto de hora.
 *
 *   Walter, jueves: 08:00–13:00. Es lo que sugiere el detector, y las 5 h que
 *   paga la planilla. Además hace que el feriado del jueves 9 se compense con 5.
 *   Ascona, lunes y martes: el esquema de julio. El archivo de presentismo se
 *   editó después, y hoy dice lunes 13–19 y martes 14–19.
 */
const ESQUEMA_ACORDADO: Record<string, Record<string, Record<number, [string, string][]>>> = {
  julio: {
    'Walter Palavecino': { 4: [['08:00', '13:00']] },
    'Ascona Gonzalo': { 1: [['12:00', '19:00']], 2: [['15:00', '19:00']] },
  },
  agosto: {
    // El jueves de Walter no volvió a cambiar
    'Walter Palavecino': { 4: [['08:00', '13:00']] },
  },
};

function esquemaDe(mes: string, a: Agente): ScheduleSlot[] {
  const base = a.schedule as ScheduleSlot[];
  const fijo = ESQUEMA_ACORDADO[mes]?.[a.agent];
  if (!fijo) return base;
  return [
    ...base.filter((s) => !(s.day_of_week in fijo)),
    ...Object.entries(fijo).flatMap(([dow, tramos]) =>
      tramos.map(([start_time, end_time]) => ({ day_of_week: Number(dow), start_time, end_time, client_id: null }))
    ),
  ];
}

// ─── Correr un mes ──────────────────────────────────────────────────────────

const MESES: [string, Fixture][] = [
  ['julio', julio as unknown as Fixture],
  ['agosto', agosto],
];

function diasDelMes(fx: Fixture): DayContext[] {
  const feriados = new Set(fx.holidays);
  const [y, m] = fx.gridPeriod.from.split('-').map(Number);
  const n = new Date(y, m, 0).getDate();
  return Array.from({ length: n }, (_, i) => {
    const date = `${fx.gridPeriod.from.slice(0, 7)}-${String(i + 1).padStart(2, '0')}`;
    return { date, isHoliday: feriados.has(date), exception: null };
  });
}

interface Entradas {
  corrections?: Map<string, DayCorrection>;
  overtime?: OvertimeRecord[];
  /** Con el esquema tal cual está en el archivo, sin corregir */
  esquemaOriginal?: boolean;
}

function correr(fx: Fixture, a: Agente, extra: Entradas = {}): SettleDaysResult {
  const mes = fx === (julio as unknown as Fixture) ? 'julio' : 'agosto';
  const slots = extra.esquemaOriginal ? (a.schedule as ScheduleSlot[]) : esquemaDe(mes, a);
  return settleDays({
    days: diasDelMes(fx),
    schedulesByDate: (d) => slots.filter((s) => s.day_of_week === new Date(d + 'T12:00:00').getDay()),
    overtime: extra.overtime ?? (a.overtime as OvertimeRecord[]),
    observations: new Map((a.observations as ClockObservation[]).map((o) => [o.date, o])),
    corrections: extra.corrections,
    hireDate: FECHA_DE_INGRESO[a.agent] ?? null,
    compensation: COMPENSACION[a.agent] ? { minutes: COMPENSACION[a.agent], band: 'day_ld' } : null,
  });
}

const conEsquema = (fx: Fixture) => fx.agents.filter((a) => a.schedule !== null);

// ─── Comparar contra la planilla ────────────────────────────────────────────

type Clave = `${Band}|${Tier}`;

function porBandaTramo(lines: { band: string; tier: string; hours: number }[]): Map<Clave, number> {
  const m = new Map<Clave, number>();
  for (const l of lines) {
    const k = `${l.band}|${l.tier}` as Clave;
    m.set(k, (m.get(k) ?? 0) + l.hours);
  }
  return m;
}

function coinciden(a: Map<Clave, number>, b: Map<Clave, number>): boolean {
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    if (Math.abs((a.get(k) ?? 0) - (b.get(k) ?? 0)) > 0.01) return false;
  }
  return true;
}

const lineasDelDia = (r: SettleDaysResult, date: string) => r.lines.filter((l) => l.date === date);
const planillaDelDia = (a: Agente, date: string) =>
  ((a.paidBySheet as Record<string, CorrectionLine[]>)[date] ?? []) as CorrectionLine[];

function neto(fx: Fixture, mes: string, a: Agente, r: SettleDaysResult): number {
  const subtotal = r.lines.reduce(
    (s, l: DailyLine) => s + l.hours * computeRate(a.baseRate, l.band, l.tier, DEFAULT_RATE_FACTORS),
    0
  );
  const conceptos = computeConcepts({
    subtotal,
    baseRate: a.baseRate,
    unworkedHolidayHours: r.unworkedHolidayHours,
    vacationHours: r.vacationHours,
    params: a.params as SettlementParams,
  });
  const itemHoras = ITEMS_POR_HORA[mes]?.[a.agent];
  const item = itemHoras
    ? computeItemAmount(
        { kind: 'hourly', quantity: itemHoras, band: 'day_ld', tier: 'normal', factor: 1 },
        { subtotal, baseRate: a.baseRate, factors: DEFAULT_RATE_FACTORS }
      )
    : 0;
  return roundCents(subtotal + conceptos.reduce((s, c) => s + c.amount, 0) + a.manualItemsTotal + item);
}

// ─── Reconstruir la decisión del liquidador con las acciones del sistema ──────

/**
 * Para un día que difiere de la planilla, prueba las acciones del sistema de la
 * más simple a la más trabajosa y devuelve la primera que reproduce exactamente
 * lo que pagó la planilla ese día.
 *
 * `manual` —cargar las horas a mano, banda por banda— siempre funciona, así que
 * no dice nada del sistema. Lo que importa es cuántos días hacen falta resolver
 * así y cuántos salen con un click.
 */
function reconstruir(fx: Fixture, a: Agente, date: string, previas: Entradas) {
  const objetivo = porBandaTramo(planillaDelDia(a, date));
  const base = correr(fx, a, previas);
  const dia = base.days.find((d) => d.date === date)!;

  const probar = (accion: ResolutionAction, entradas: Entradas) => {
    const r = correr(fx, a, entradas);
    return coinciden(porBandaTramo(lineasDelDia(r, date)), objetivo) ? { accion, entradas } : null;
  };

  const corr = (c: Omit<DayCorrection, 'date'>) => {
    const m = new Map(previas.corrections ?? []);
    m.set(date, { date, ...c });
    return { ...previas, corrections: m };
  };

  const overtime = previas.overtime ?? (a.overtime as OvertimeRecord[]);
  const extrasPlanilla = planillaDelDia(a, date).filter((l) => l.tier !== 'normal');

  // Normalizar un día es una sola decisión. Las acciones sobre horas
  // autorizadas también lo dejan revisado: si no, un día con dos motivos
  // —llegó tarde y además tenía horas cargadas— quedaría a medio resolver.
  const revisado = corr({ resolution: 'plan', blocks: dia.plan });

  return (
    probar('plan', revisado) ??
    probar('pay_authorized', {
      ...revisado,
      overtime: overtime.map((o) => (o.date === date ? { ...o, uncapped: true } : o)),
    }) ??
    probar('marks', corr({ resolution: 'marks', blocks: dia.marked })) ??
    (extrasPlanilla.length > 0
      ? probar('authorize', {
          ...revisado,
          overtime: [
            ...overtime.filter((o) => o.date !== date),
            ...extrasPlanilla.map((l) => ({
              date, hours: l.hours, tier: l.tier, start_time: null, end_time: null, client_id: null,
            })),
          ],
        })
      : null) ??
    { accion: 'manual' as ResolutionAction, entradas: corr({ resolution: 'manual', lines: planillaDelDia(a, date) }) }
  );
}

// ─── Lo que la planilla pagó sin ningún dato que lo respalde ──────────────────

/**
 * Días que el sistema paga distinto de la planilla SIN avisar. Son todos días
 * donde la planilla pagó algo que no está en ningún dato de entrada: ni en el
 * esquema, ni en la marcación, ni en una autorización. El sistema no tiene cómo
 * enterarse.
 */
const SIN_DATO_EN_EL_SISTEMA: Record<string, string> = {
  'julio · María Sol Olaviaga 2026-07-23':
    'la planilla pagó 8 h; marcó 6,31 contra un esquema de 6, y nadie autorizó las otras 2',
  'julio · Moreno Laura 2026-07-02':
    'la planilla pagó 6 h; marcó 5,03 contra un esquema de 5, y nadie autorizó la otra',
  'julio · Bissuti Stefano 2026-07-04':
    'sábado de franco sin marcación, con la nota "horas del 30/06": un arrastre',
  'julio · Paola Farías 2026-07-22': 'la planilla pagó 25 minutos de compensación en vez de 45',
  'julio · Paola Farías 2026-07-29': 'la planilla pagó 25 minutos de compensación en vez de 45',
  'agosto · Vidal Bárbara 2026-08-01': 'capacitación un sábado sin esquema ni marcación',
};

// ─────────────────────────────────────────────────────────────────────────────

describe.each(MESES)('%s 2026 con las marcaciones reales', (mes, fx) => {
  const agentes = conEsquema(fx);
  const resultados = new Map(agentes.map((a) => [a.agent, correr(fx, a)]));

  const dias = () =>
    agentes.flatMap((a) =>
      resultados.get(a.agent)!.days
        // los días sin plan ni pago no le interesan a nadie
        .filter((d) => d.status !== 'off' || planillaDelDia(a, d.date).length > 0)
        .map((d) => ({ a, d }))
    );

  it('cuánto se resuelve solo', () => {
    const todos = dias();
    const cuenta = (s: string[]) => todos.filter(({ d }) => s.includes(d.status)).length;
    const solos = cuenta(['auto', 'unverified', 'holiday', 'leave', 'off', 'projected']);
    const aRevisar = cuenta(['needs_review']);

    expect(solos + aRevisar).toBe(todos.length);
    // Fijados con los datos reales. Si un cambio del motor los mueve, tiene que
    // ser a propósito.
    expect({ mes, dias: todos.length, solos, aRevisar }).toMatchSnapshot();
  });

  it('ningún día se paga distinto de la planilla sin avisar, salvo los que no tienen dato', () => {
    const silenciosos: string[] = [];
    for (const { a, d } of dias()) {
      const motor = porBandaTramo(lineasDelDia(resultados.get(a.agent)!, d.date));
      const planilla = porBandaTramo(planillaDelDia(a, d.date));
      if (!coinciden(motor, planilla) && d.status !== 'needs_review') {
        silenciosos.push(`${mes} · ${a.agent} ${d.date}`);
      }
    }
    const esperados = Object.keys(SIN_DATO_EN_EL_SISTEMA).filter((k) => k.startsWith(`${mes} ·`));
    expect(silenciosos.sort()).toEqual(esperados.sort());
  });

  it('las decisiones del liquidador se expresan con las acciones del sistema y el neto cierra', () => {
    const acciones: Record<string, number> = {};
    const aciertos = { total: 0, sugerencia: 0 };

    for (const a of agentes) {
      let entradas: Entradas = {};
      const r0 = resultados.get(a.agent)!;

      // Los días que hay que tocar: los que difieren de la planilla, estén o no
      // marcados, más los marcados que coinciden (hay que confirmarlos igual)
      const aTocar = r0.days.filter((d) => {
        const difiere = !coinciden(
          porBandaTramo(lineasDelDia(r0, d.date)),
          porBandaTramo(planillaDelDia(a, d.date))
        );
        return difiere || d.status === 'needs_review';
      });

      for (const d of aTocar) {
        const { accion, entradas: nuevas } = reconstruir(fx, a, d.date, entradas);
        entradas = nuevas;
        acciones[accion] = (acciones[accion] ?? 0) + 1;

        if (d.status === 'needs_review') {
          const sug = suggestResolution(d, r0.warnings.filter((w) => w.date === d.date));
          if (sug && !d.newHire) {
            aciertos.total++;
            if (sug.action === accion) aciertos.sugerencia++;
          }
        }
      }

      const r = correr(fx, a, entradas);
      // Con todo normalizado, no queda nada que bloquee
      expect(r.days.filter((d) => d.status === 'needs_review').map((d) => d.date)).toEqual([]);
      // Y el neto es el de la planilla, al centavo
      expect(neto(fx, mes, a, r)).toBeCloseTo(
        a.expected.net + (CORRECCION_ADICIONAL[mes]?.[a.agent] ?? 0),
        2
      );
    }

    expect({ mes, acciones, sugerencias: aciertos }).toMatchSnapshot();
  });
});

describe('esquemas desactualizados', () => {
  const sugerencias = (fx: Fixture) =>
    conEsquema(fx)
      .filter((a) => !FECHA_DE_INGRESO[a.agent])
      .flatMap((a) => {
        const slots = a.schedule as ScheduleSlot[];
        return detectScheduleDrift({
          days: diasDelMes(fx),
          schedulesByDate: (d) => slots.filter((s) => s.day_of_week === new Date(d + 'T12:00:00').getDay()),
          observations: new Map((a.observations as ClockObservation[]).map((o) => [o.date, o])),
        }).map((s) => `${a.agent} · ${['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'][s.day_of_week]} → ` +
          s.suggested.map((b) => `${b.start_time}–${b.end_time}`).join(' + '));
      });

  it('en julio encuentra los tres que conocemos', () => {
    expect(sugerencias(julio as unknown as Fixture)).toEqual([
      'Walter Palavecino · jue → 08:00–13:00',
      'Ascona Gonzalo · lun → 11:45–19:00',
      'Ascona Gonzalo · mar → 14:45–19:00',
    ]);
  });

  it('en agosto no inventa ninguno: los desvíos cambian de semana a semana', () => {
    // Walter, Liliana, Giuliana y Micaela marcan distinto casi todas las semanas,
    // pero ningún horario único los haría cerrar solos. El detector sólo sugiere
    // un esquema si con él cierran claramente más días.
    expect(sugerencias(agosto)).toEqual([]);
  });

  it('corregir el esquema también corrige el feriado', () => {
    const walter = julio.agents.find((a) => a.agent === 'Walter Palavecino')! as unknown as Agente;
    const fx = julio as unknown as Fixture;
    expect(correr(fx, walter, { esquemaOriginal: true }).unworkedHolidayHours).toBe(8);
    expect(correr(fx, walter).unworkedHolidayHours).toBe(9);
    expect(walter.unworkedHolidayHours).toBe(9); // lo que compensó la planilla
  });
});

describe('el doble pago ya no es posible', () => {
  // Miércoles 09:00–15:00; trabajó 17:00–23:00. Las mismas seis horas.
  const FECHA = '2026-10-07';
  const slots: ScheduleSlot[] = [{ day_of_week: 3, start_time: '09:00', end_time: '15:00', client_id: null }];
  const obs = new Map<string, ClockObservation>([[FECHA, {
    date: FECHA, clockIn: '17:00', clockOut: '23:00', clockedHours: 6,
    segments: [{ clockIn: '17:00', clockOut: '23:00' }],
  }]]);
  const correrDia = (overtime: OvertimeRecord[], corrections?: Map<string, DayCorrection>) =>
    settleDays({
      days: [{ date: FECHA, isHoliday: false, exception: null }],
      schedulesByDate: () => slots,
      overtime,
      observations: obs,
      corrections,
    });
  const seis: OvertimeRecord[] = [
    { date: FECHA, hours: 6, tier: 'additional', start_time: null, end_time: null, client_id: null },
  ];

  it('el aviso ya no invita a cargar las horas como adicionales', () => {
    const r = correrDia([]);
    expect(r.warnings.map((w) => w.code)).toEqual(['worked_other_hours']);
    expect(r.warnings[0].detail).toBe('Marcó 17:00–23:00 y el plan era 09:00–15:00');
    expect(r.warnings.some((w) => w.code === 'worked_more_than_schedule')).toBe(false);
  });

  it('si igual se cargan, el día queda bloqueado hasta normalizarlo', () => {
    const r = correrDia(seis);
    expect(r.days[0].status).toBe('needs_review');
  });

  it('normalizado como "pagar lo marcado", son seis horas y en sus bandas', () => {
    const r = correrDia(seis, new Map([[FECHA, {
      date: FECHA, resolution: 'marks', blocks: [{ start_time: '17:00', end_time: '23:00' }],
    }]]));
    const horas = r.lines.reduce((s, l) => s + l.hours, 0);
    expect(horas).toBe(6);
    expect(r.lines.find((l) => l.band === 'night_ld')!.hours).toBe(2); // 21 a 23
    expect(r.lines.some((l) => l.tier === 'additional')).toBe(false);
    expect(r.days[0].status).toBe('corrected');
  });

  const conCambioDeJornada = (overtime: OvertimeRecord[]) =>
    settleDays({
      days: [{
        date: FECHA, isHoliday: false, exception: 'schedule_change',
        exceptionBlocks: [{ start_time: '17:00', end_time: '23:00' }],
      }],
      schedulesByDate: () => slots,
      overtime,
      observations: obs,
    });

  it('con la excepción de cambio de jornada cargada de antemano, ni siquiera hay que normalizar', () => {
    const r = conCambioDeJornada([]);
    expect(r.days[0].status).toBe('auto');
    expect(r.warnings).toEqual([]);
    expect(r.lines.filter((l) => l.band === 'day_ld').reduce((s, l) => s + l.hours, 0)).toBe(4);
    expect(r.lines.filter((l) => l.band === 'night_ld').reduce((s, l) => s + l.hours, 0)).toBe(2);
  });

  it('y si además quedaron las seis autorizadas, no se pagan y el día pide confirmación', () => {
    const r = conCambioDeJornada(seis);
    expect(r.lines.some((l) => l.tier === 'additional')).toBe(false);
    expect(r.days[0].status).toBe('needs_review');
    expect(r.warnings.map((w) => w.code)).toEqual(['additional_without_excess']);
  });
});
