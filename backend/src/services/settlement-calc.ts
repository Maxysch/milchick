/**
 * Núcleo de cálculo de honorarios. Funciones puras, sin acceso a base de datos,
 * para que se puedan testear contra liquidaciones reales.
 *
 * El modelo replica el que se venía usando en planilla:
 *
 *   Subtotal = Σ por banda:  valorHora(banda) × Σ por tramo: factor(tramo) × horas
 *   Neto     = Subtotal + conceptos calculados + ítems manuales − adelantos
 *
 * Cada agente tiene UNA tarifa base. Todo lo demás son multiplicadores globales.
 */

// ─── Bandas horarias ────────────────────────────────────────────────
// LD ("laborable"): la franja habitual de lunes a viernes.
// HD: el resto — viernes desde las 20:00 hasta el domingo a medianoche.
export type Band = 'day_ld' | 'night_ld' | 'day_hd' | 'night_hd';

// ─── Tramos de recargo sobre la banda ───────────────────────────────
export type Tier = 'normal' | 'additional' | 'overtime_50' | 'overtime_100';

export interface RateFactors {
  /** Recargo nocturno sobre la banda diurna equivalente */
  nighttime: number;
  /** Recargo de la franja HD sobre la LD equivalente */
  hd: number;
  /** Horas adicionales (fuera del esquema, sin llegar a extra) */
  additional: number;
  /** Horas extra al 50% */
  overtime_50: number;
  /** Horas extra al 100% */
  overtime_100: number;
}

export const DEFAULT_RATE_FACTORS: RateFactors = {
  nighttime: 1.13,
  hd: 1.0125,
  additional: 1.25,
  overtime_50: 1.5,
  overtime_100: 2.0,
};

/** Reconocimiento por antigüedad: 0,08333% del subtotal por mes reconocido. */
export const SENIORITY_RATE_PER_MONTH = 0.0008333;

export const ALL_BANDS: Band[] = ['day_ld', 'night_ld', 'day_hd', 'night_hd'];
export const ALL_TIERS: Tier[] = ['normal', 'additional', 'overtime_50', 'overtime_100'];

// ─── Tarifas ────────────────────────────────────────────────────────

export function bandMultiplier(band: Band, factors: RateFactors): number {
  switch (band) {
    case 'day_ld': return 1;
    case 'night_ld': return factors.nighttime;
    case 'day_hd': return factors.hd;
    case 'night_hd': return factors.nighttime * factors.hd;
  }
}

export function tierMultiplier(tier: Tier, factors: RateFactors): number {
  switch (tier) {
    case 'normal': return 1;
    case 'additional': return factors.additional;
    case 'overtime_50': return factors.overtime_50;
    case 'overtime_100': return factors.overtime_100;
  }
}

/**
 * Valor de la hora para una combinación banda × tramo.
 * No se redondea: el redondeo se aplica una sola vez sobre el total.
 */
export function computeRate(
  baseRate: number,
  band: Band,
  tier: Tier,
  factors: RateFactors = DEFAULT_RATE_FACTORS
): number {
  return baseRate * bandMultiplier(band, factors) * tierMultiplier(tier, factors);
}

// ─── Clasificación horaria ──────────────────────────────────────────

const MIN_05 = 5 * 60;
const MIN_06 = 6 * 60;
const MIN_20 = 20 * 60;
const MIN_21 = 21 * 60;
const MIN_24 = 24 * 60;

/** Cortes donde puede cambiar la banda dentro de un día. */
const BREAKPOINTS = [0, MIN_05, MIN_06, MIN_20, MIN_21, MIN_24];

/**
 * Banda que corresponde a un instante dado.
 * @param isoDow día de la semana ISO: 1 = lunes … 7 = domingo
 * @param minuteOfDay minutos desde la medianoche
 */
export function bandAt(isoDow: number, minuteOfDay: number): Band {
  const ldDayEnd = isoDow <= 4 ? MIN_21 : isoDow === 5 ? MIN_20 : -1;

  // Diurna LD: de 06:00 al cierre de la franja (21:00 lun-jue, 20:00 viernes)
  if (minuteOfDay >= MIN_06 && minuteOfDay < ldDayEnd) return 'day_ld';

  // Nocturna LD: el continuo que va del lunes 21:00 al viernes 05:00
  if (isoDow <= 4 && minuteOfDay >= MIN_21) return 'night_ld';
  if (isoDow >= 2 && isoDow <= 5 && minuteOfDay < MIN_05) return 'night_ld';

  // Todo lo demás cae en HD, con el mismo corte día/noche
  return minuteOfDay >= MIN_21 || minuteOfDay < MIN_06 ? 'night_hd' : 'day_hd';
}

/** "HH:mm" o "HH:mm:ss" → minutos desde medianoche */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':');
  return parseInt(h, 10) * 60 + parseInt(m, 10);
}

/** ISO date "YYYY-MM-DD" → día de la semana ISO (1 = lunes … 7 = domingo) */
export function isoDayOfWeek(date: string): number {
  const jsDay = new Date(date + 'T12:00:00').getDay(); // 0 = domingo
  return jsDay === 0 ? 7 : jsDay;
}

export type BandHours = Record<Band, number>;

export function emptyBandHours(): BandHours {
  return { day_ld: 0, night_ld: 0, day_hd: 0, night_hd: 0 };
}

/**
 * Reparte un tramo horario entre las cuatro bandas.
 * Si `endTime` es menor o igual que `startTime`, se asume que cruza la medianoche.
 */
export function splitIntoBands(date: string, startTime: string, endTime: string): BandHours {
  const start = timeToMinutes(startTime);
  const rawEnd = timeToMinutes(endTime);
  const end = rawEnd > start ? rawEnd : rawEnd + MIN_24;

  const result = emptyBandHours();
  const startDow = isoDayOfWeek(date);

  // Recorremos los segmentos delimitados por los cortes de banda de cada día tocado
  const cuts: number[] = [start, end];
  for (let dayOffset = 0; dayOffset <= Math.floor(end / MIN_24); dayOffset++) {
    for (const bp of BREAKPOINTS) {
      const abs = dayOffset * MIN_24 + bp;
      if (abs > start && abs < end) cuts.push(abs);
    }
  }
  cuts.sort((a, b) => a - b);

  for (let i = 0; i < cuts.length - 1; i++) {
    const from = cuts[i];
    const to = cuts[i + 1];
    if (to <= from) continue;
    const dayOffset = Math.floor(from / MIN_24);
    const dow = ((startDow - 1 + dayOffset) % 7) + 1;
    result[bandAt(dow, from - dayOffset * MIN_24)] += (to - from) / 60;
  }

  return result;
}

// ─── Subtotal ───────────────────────────────────────────────────────

export interface HourBucket {
  band: Band;
  tier: Tier;
  hours: number;
}

export function subtotalFromBuckets(
  buckets: HourBucket[],
  baseRate: number,
  factors: RateFactors = DEFAULT_RATE_FACTORS
): number {
  return buckets.reduce(
    (sum, b) => sum + b.hours * computeRate(baseRate, b.band, b.tier, factors),
    0
  );
}

// ─── Conceptos calculados ───────────────────────────────────────────

/**
 * Parámetros de liquidación propios de cada agente.
 * Viven en `profiles` y los mantiene quien liquida.
 */
export interface SettlementParams {
  /** Los tres componentes del Premio a la Excelencia (REG). Se suman. */
  reg_people_pct: number;
  reg_quantitative_pct: number;
  reg_qualitative_pct: number;
  /** SUPER REG, sobre el subtotal */
  super_reg_pct: number;
  /** Reintegro por uso de equipos, sobre el subtotal */
  equipment_pct: number;
  /** Meses reconocidos de antigüedad */
  seniority_months: number;
  /** Proporción del valor hora que se compensa por feriado no trabajado */
  holiday_compensation_factor: number;
  /** Proporción del valor hora que se paga como plus vacacional */
  vacation_plus_factor: number;
  /** Reintegro de monotributo del mes. Importe fijo, no un porcentaje. */
  monotributo_reimbursement: number;
}

export const DEFAULT_SETTLEMENT_PARAMS: SettlementParams = {
  reg_people_pct: 0,
  reg_quantitative_pct: 0,
  reg_qualitative_pct: 0,
  super_reg_pct: 0,
  equipment_pct: 0.05,
  seniority_months: 0,
  holiday_compensation_factor: 0.5,
  vacation_plus_factor: 0,
  monotributo_reimbursement: 0,
};

export type ConceptCode =
  | 'reg'
  | 'super_reg'
  | 'seniority'
  | 'equipment'
  | 'holiday_compensation'
  | 'vacation_plus'
  | 'monotributo';

/** Cómo se calcula el importe de un ítem. */
export type ItemKind = 'fixed' | 'percentage' | 'hourly';

/**
 * Un ítem que se calcula, no que se carga.
 *
 * `percentage` y `hourly` se recomponen cada vez que cambia el subtotal, así que
 * corregir las horas de un día arrastra los conceptos que dependen de él.
 */
export interface ComputableItem {
  kind: ItemKind;
  /** kind = 'fixed' */
  amount?: number;
  /** kind = 'percentage': tanto por uno sobre el subtotal */
  percentage?: number | null;
  /** kind = 'hourly': cantidad de horas */
  quantity?: number | null;
  band?: Band | null;
  tier?: Tier | null;
  /** Multiplicador extra sobre el valor hora (0,5 en el feriado no trabajado) */
  factor?: number | null;
}

export interface ItemContext {
  /** Subtotal de horas del período */
  subtotal: number;
  /** Tarifa base del agente al cierre del período */
  baseRate: number;
  factors?: RateFactors;
}

/**
 * Importe de un ítem según su forma de cálculo.
 *
 *   fixed      -> el importe cargado
 *   percentage -> subtotal × porcentaje
 *   hourly     -> horas × valor hora (banda × tramo) × factor
 */
export function computeItemAmount(item: ComputableItem, ctx: ItemContext): number {
  switch (item.kind) {
    case 'percentage':
      return ctx.subtotal * (item.percentage ?? 0);

    case 'hourly': {
      const rate = computeRate(
        ctx.baseRate,
        item.band ?? 'day_ld',
        item.tier ?? 'normal',
        ctx.factors ?? DEFAULT_RATE_FACTORS
      );
      return (item.quantity ?? 0) * rate * (item.factor ?? 1);
    }

    case 'fixed':
    default:
      return item.amount ?? 0;
  }
}

/** Horas equivalentes a `minutes` minutos por día durante `days` días. */
export function hoursFromMinutesPerDay(minutes: number, days: number): number {
  return Math.round(((minutes * days) / 60) * 10000) / 10000;
}

export interface ConceptLine extends ComputableItem {
  concept: ConceptCode;
  description: string;
  amount: number;
  /** Base sobre la que se calculó, para que se pueda auditar desde la UI */
  basis: string;
}

export interface ConceptInput {
  subtotal: number;
  baseRate: number;
  /** Horas de esquema caídas en feriado no trabajado */
  unworkedHolidayHours: number;
  /** Horas de esquema caídas en licencia por vacaciones */
  vacationHours: number;
  params: SettlementParams;
}

/**
 * Los seis conceptos que se calculan solos. Todo lo demás (adelantos, reintegros
 * de monotributo, comisiones, bonos) entra como ítem manual.
 */
export function computeConcepts(input: ConceptInput): ConceptLine[] {
  const { subtotal, baseRate, unworkedHolidayHours, vacationHours, params } = input;
  const lines: ConceptLine[] = [];

  const regPct =
    params.reg_people_pct + params.reg_quantitative_pct + params.reg_qualitative_pct;
  if (regPct > 0) {
    lines.push({
      concept: 'reg',
      description: 'Premio Variable No Habitual a la Excelencia',
      amount: subtotal * regPct,
      basis: `subtotal × ${(regPct * 100).toFixed(2)}%`,
      kind: 'percentage',
      percentage: regPct,
    });
  }

  if (params.super_reg_pct > 0) {
    lines.push({
      concept: 'super_reg',
      description: 'SUPER REG Variable No Habitual a la Excelencia',
      amount: subtotal * params.super_reg_pct,
      basis: `subtotal × ${(params.super_reg_pct * 100).toFixed(2)}%`,
      kind: 'percentage',
      percentage: params.super_reg_pct,
    });
  }

  if (params.seniority_months > 0) {
    const pct = SENIORITY_RATE_PER_MONTH * params.seniority_months;
    lines.push({
      concept: 'seniority',
      description: 'Reconocimiento Variable Habitual por Antigüedad',
      amount: subtotal * pct,
      basis: `subtotal × 0,08333% × ${params.seniority_months} meses`,
      kind: 'percentage',
      percentage: pct,
    });
  }

  if (params.equipment_pct > 0) {
    lines.push({
      concept: 'equipment',
      description: 'Reintegro por uso de Equipos',
      amount: subtotal * params.equipment_pct,
      basis: `subtotal × ${(params.equipment_pct * 100).toFixed(2)}%`,
      kind: 'percentage',
      percentage: params.equipment_pct,
    });
  }

  if (unworkedHolidayHours > 0 && params.holiday_compensation_factor > 0) {
    lines.push({
      concept: 'holiday_compensation',
      description: 'Compensación por feriado no trabajado',
      amount: unworkedHolidayHours * baseRate * params.holiday_compensation_factor,
      basis: `${unworkedHolidayHours} h × valor hora × ${params.holiday_compensation_factor}`,
      kind: 'hourly',
      quantity: unworkedHolidayHours,
      band: 'day_ld',
      tier: 'normal',
      factor: params.holiday_compensation_factor,
    });
  }

  if (vacationHours > 0 && params.vacation_plus_factor > 0) {
    lines.push({
      concept: 'vacation_plus',
      description: 'Plus vacacional No Habitual',
      amount: vacationHours * baseRate * params.vacation_plus_factor,
      basis: `${vacationHours} h × valor hora × ${params.vacation_plus_factor}`,
      kind: 'hourly',
      quantity: vacationHours,
      band: 'day_ld',
      tier: 'normal',
      factor: params.vacation_plus_factor,
    });
  }

  // No depende del subtotal: es el importe que se carga para ese mes
  if (params.monotributo_reimbursement > 0) {
    lines.push({
      concept: 'monotributo',
      description: 'Reintegro de monotributo',
      amount: params.monotributo_reimbursement,
      basis: 'importe del mes',
      kind: 'fixed',
    });
  }

  return lines;
}

/** Redondeo a centavos, aplicado una sola vez sobre importes finales. */
export function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

// ─── Armado del desglose diario ─────────────────────────────────────

/** Esquema horario vigente. `day_of_week` sigue la convención JS: 0 = domingo. */
export interface ScheduleSlot {
  day_of_week: number;
  start_time: string;
  end_time: string;
  client_id: string | null;
}

export interface OvertimeRecord {
  date: string;
  hours: number;
  start_time: string | null;
  end_time: string | null;
  tier: Tier;
  client_id: string | null;
}

export type DayExceptionType =
  | 'vacation'
  | 'paid_leave'          // licencia paga (examen, duelo, enfermedad con certificado)
  | 'absence'
  | 'schedule_change'
  | 'extraordinary_coverage';

export interface DayContext {
  date: string;
  isHoliday: boolean;
  exception: DayExceptionType | null;
}

export type LineSource =
  | 'schedule'
  | 'exception'
  | 'overtime'
  | 'manual'
  | 'adjustment';   // diferencia contra lo proyectado en el período anterior

export interface DailyLine {
  date: string;
  band: Band;
  tier: Tier;
  hours: number;
  client_id: string | null;
  source: LineSource;
}

/** Umbral por defecto: por debajo de esto el excedente no habilita adicionales. */
export const ADDITIONAL_THRESHOLD_HOURS = 0.5;

export interface BuildDailyLinesInput {
  days: DayContext[];
  /** Esquemas vigentes en el período, ya filtrados por fecha de vigencia */
  schedulesByDate: (date: string) => ScheduleSlot[];
  overtime: OvertimeRecord[];
  /**
   * Marcaciones del período. Sin esto las horas cargadas por el supervisor se
   * pagan sin tope, que es el comportamiento anterior.
   */
  observations?: Map<string, ClockObservation>;
  /** Excedente mínimo para que las horas cargadas se paguen */
  additionalThresholdHours?: number;
}

/** Qué pasó con las horas cargadas por el supervisor en un día. */
export interface OvertimeOutcome {
  date: string;
  /** Horas que cargó el supervisor */
  loadedHours: number;
  /** Horas efectivamente trabajadas fuera del esquema */
  excessHours: number;
  /** Horas que se terminan pagando: min(cargado, excedente), o 0 bajo el umbral */
  paidHours: number;
}

export interface BuildDailyLinesResult {
  lines: DailyLine[];
  /** Horas de esquema que cayeron en feriado no trabajado */
  unworkedHolidayHours: number;
  /** Horas de esquema cubiertas por licencia de vacaciones */
  vacationHours: number;
  /** Días descontados por ausencia */
  absenceDates: string[];
  /** Un renglón por día con horas cargadas o con excedente, para poder auditar */
  overtimeOutcomes: OvertimeOutcome[];
}

/**
 * Horas trabajadas fuera del esquema en un día.
 *
 * Es lo marcado menos lo que se superpone con el esquema, así que cuenta tanto
 * lo de antes de entrar como lo de después de salir. Llegar 20 minutos antes y
 * salir 20 después son 40 minutos de excedente, no dos veces 20 comparados
 * contra el umbral por separado.
 */
export function excessOverSchedule(
  date: string,
  slots: ScheduleSlot[],
  obs: ClockObservation | undefined
): number {
  if (!obs || obs.clockedHours === null || obs.clockedHours <= 0) return 0;

  const scheduleRanges = slots.map((s) => {
    const start = timeToMinutes(s.start_time);
    const rawEnd = timeToMinutes(s.end_time);
    return [start, rawEnd > start ? rawEnd : rawEnd + 24 * 60] as const;
  });

  // Los tramos van uno por uno. Medir el solape sobre el span del día
  // (primer ingreso a último egreso) taparía un tramo desconectado del esquema:
  // el hueco entre bloques contaría como si estuviera cubierto.
  const segments =
    obs.segments && obs.segments.length > 0
      ? obs.segments
      : obs.clockIn && obs.clockOut
        ? [{ clockIn: obs.clockIn, clockOut: obs.clockOut }]
        : [];

  if (segments.length === 0) return 0;

  let worked = 0;
  let overlap = 0;
  for (const seg of segments) {
    const from = timeToMinutes(seg.clockIn);
    const rawTo = timeToMinutes(seg.clockOut);
    const to = rawTo > from ? rawTo : rawTo + 24 * 60;
    worked += to - from;
    for (const [a, b] of scheduleRanges) {
      overlap += Math.max(0, Math.min(to, b) - Math.max(from, a));
    }
  }

  return Math.max(0, (worked - overlap) / 60);
}

/**
 * Construye el desglose diario a partir del ESQUEMA del agente.
 *
 * Es la inversión respecto de la versión anterior del servicio: antes mandaban
 * las marcaciones y el esquema sólo se usaba para proyectar el futuro. En la
 * práctica el negocio paga el esquema, y las marcaciones sirven para detectar
 * desvíos que alguien tiene que revisar (ver `compareAgainstClockIns`).
 */
export function buildDailyLines(input: BuildDailyLinesInput): BuildDailyLinesResult {
  const {
    days,
    schedulesByDate,
    overtime,
    observations,
    additionalThresholdHours = ADDITIONAL_THRESHOLD_HOURS,
  } = input;
  const lines: DailyLine[] = [];
  let unworkedHolidayHours = 0;
  let vacationHours = 0;
  const absenceDates: string[] = [];
  const overtimeOutcomes: OvertimeOutcome[] = [];

  for (const day of days) {
    const slots = schedulesByDate(day.date);
    const scheduledHours = slots.reduce((sum, s) => {
      const b = splitIntoBands(day.date, s.start_time, s.end_time);
      return sum + b.day_ld + b.night_ld + b.day_hd + b.night_hd;
    }, 0);

    if (day.exception === 'absence') {
      absenceDates.push(day.date);
      continue; // la ausencia no se paga
    }

    // Feriado no trabajado: no se pagan horas, se compensa como concepto.
    // Si hay cobertura extraordinaria cargada, el feriado sí se trabajó.
    if (day.isHoliday && day.exception !== 'extraordinary_coverage') {
      unworkedHolidayHours += scheduledHours;
      continue;
    }

    // La licencia paga se liquida igual que un día normal, pero no suma al
    // plus vacacional: eso es sólo para vacaciones.
    if (day.exception === 'vacation') vacationHours += scheduledHours;

    const source: LineSource = day.exception ? 'exception' : 'schedule';
    for (const slot of slots) {
      const bands = splitIntoBands(day.date, slot.start_time, slot.end_time);
      for (const band of ALL_BANDS) {
        if (bands[band] > 0) {
          lines.push({
            date: day.date,
            band,
            tier: 'normal',
            hours: bands[band],
            client_id: slot.client_id,
            source,
          });
        }
      }
    }
  }

  // ── Horas cargadas por el supervisor ──
  //
  // No se suman al esquema sin más: se pagan sólo en la medida en que el agente
  // efectivamente estuvo. Un día de 7 h de esquema con 1 h cargada y 8 h
  // trabajadas paga 7 normales + 1 adicional; si trabajó 7, la adicional no se
  // paga. Y por debajo del umbral no se paga nada, para que unos minutos de más
  // no habiliten una hora entera.
  const paidDates = new Set(days.filter((d) => d.exception !== 'absence').map((d) => d.date));

  // Presupuesto de horas pagables por día
  const budget = new Map<string, number>();
  const loadedByDate = new Map<string, number>();
  for (const ot of overtime) {
    if (!paidDates.has(ot.date)) continue;
    loadedByDate.set(ot.date, (loadedByDate.get(ot.date) ?? 0) + ot.hours);
  }

  for (const [date, loaded] of loadedByDate) {
    // Sin marcaciones no hay con qué topear: se paga lo cargado, como antes
    if (!observations) {
      budget.set(date, loaded);
      overtimeOutcomes.push({ date, loadedHours: loaded, excessHours: loaded, paidHours: loaded });
      continue;
    }
    const excess = excessOverSchedule(date, schedulesByDate(date), observations.get(date));
    const payable = excess > additionalThresholdHours ? Math.min(loaded, excess) : 0;
    budget.set(date, payable);
    overtimeOutcomes.push({ date, loadedHours: loaded, excessHours: excess, paidHours: payable });
  }

  // Días con excedente pero sin nada cargado: quedan registrados para el aviso
  if (observations) {
    for (const day of days) {
      if (loadedByDate.has(day.date) || !paidDates.has(day.date)) continue;
      const excess = excessOverSchedule(day.date, schedulesByDate(day.date), observations.get(day.date));
      if (excess > additionalThresholdHours) {
        overtimeOutcomes.push({ date: day.date, loadedHours: 0, excessHours: excess, paidHours: 0 });
      }
    }
  }

  // Se consumen en orden de recargo creciente, para que el recorte sea
  // determinístico y explicable cuando un día tiene más de un tramo cargado.
  const ordered = [...overtime].sort(
    (a, b) =>
      a.date.localeCompare(b.date) || ALL_TIERS.indexOf(a.tier) - ALL_TIERS.indexOf(b.tier)
  );

  for (const ot of ordered) {
    if (!paidDates.has(ot.date)) continue;

    const remaining = budget.get(ot.date) ?? 0;
    if (remaining <= 0.0001) continue;
    const hours = Math.min(ot.hours, remaining);
    budget.set(ot.date, remaining - hours);

    const bands = ot.start_time && ot.end_time
      ? splitIntoBands(ot.date, ot.start_time, ot.end_time)
      : null;

    if (bands) {
      const total = bands.day_ld + bands.night_ld + bands.day_hd + bands.night_hd;
      for (const band of ALL_BANDS) {
        if (bands[band] > 0) {
          lines.push({
            date: ot.date,
            band,
            tier: ot.tier,
            // Si las horas declaradas no coinciden con el tramo horario, se
            // reparten en la misma proporción que las bandas.
            hours: total > 0 ? (hours * bands[band]) / total : 0,
            client_id: ot.client_id,
            source: 'overtime',
          });
        }
      }
    } else {
      // Sin horario declarado se asume la banda diurna habitual
      lines.push({
        date: ot.date,
        band: 'day_ld',
        tier: ot.tier,
        hours,
        client_id: ot.client_id,
        source: 'overtime',
      });
    }
  }

  return {
    lines: mergeDailyLines(lines),
    unworkedHolidayHours,
    vacationHours,
    absenceDates,
    overtimeOutcomes: overtimeOutcomes.sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/**
 * Junta las líneas que sólo difieren en el tramo horario del que salieron.
 *
 * Un turno partido (09:00-12:00 + 15:00-19:00) produce dos entradas del mismo
 * día, banda y tramo. Como la línea diaria no guarda los horarios, dos filas
 * idénticas de 3 h y 4 h no aportan nada frente a una de 7 h, y encima obligan a
 * corregir el mismo día dos veces. Se separan sólo cuando cambia algo que sí se
 * ve: el cliente o el origen.
 */
export function mergeDailyLines(lines: DailyLine[]): DailyLine[] {
  const merged = new Map<string, DailyLine>();

  for (const line of lines) {
    const key = [line.date, line.band, line.tier, line.client_id ?? '', line.source].join('|');
    const existing = merged.get(key);
    if (existing) {
      existing.hours += line.hours;
    } else {
      merged.set(key, { ...line });
    }
  }

  return [...merged.values()];
}

// ─── Alertas: qué dicen las marcaciones ─────────────────────────────

export interface ClockObservation {
  date: string;
  /** Horas efectivamente marcadas ese día, si hay marcación */
  clockedHours: number | null;
  /** Primer ingreso del día */
  clockIn: string | null;
  /** Último egreso conocido del día */
  clockOut: string | null;
  /**
   * Cada tramo marcado por separado. Hace falta para medir el excedente: un
   * tramo desconectado del esquema (una cobertura a la noche, por ejemplo) no se
   * puede detectar mirando sólo el span del primer ingreso al último egreso.
   */
  segments?: { clockIn: string; clockOut: string }[];
}

export type WarningCode =
  | 'no_clock_in'
  | 'no_clock_out'
  | 'left_early'
  | 'arrived_late'
  | 'worked_without_schedule'
  | 'worked_more_than_schedule'   // trabajó de más sin cubrir con horas cargadas
  | 'additional_without_excess'   // se cargaron horas y no hubo excedente
  | 'additional_over_worked'      // se cargó más de lo que estuvo
  | 'absence'
  | 'missing_period_params';     // no se cargó la evaluación del mes

export interface SettlementWarning {
  date: string;
  code: WarningCode;
  detail: string;
}

/** Tolerancia por defecto antes de marcar un desvío, en minutos. */
export const CLOCK_TOLERANCE_MINUTES = 15;

/**
 * Contrasta el esquema pagado contra lo que dicen las marcaciones.
 * No cambia importes: sólo señala los días que alguien debería mirar.
 */
export function compareAgainstClockIns(
  days: DayContext[],
  schedulesByDate: (date: string) => ScheduleSlot[],
  observations: Map<string, ClockObservation>,
  toleranceMinutes: number = CLOCK_TOLERANCE_MINUTES
): SettlementWarning[] {
  const warnings: SettlementWarning[] = [];
  const tolerance = toleranceMinutes / 60;

  for (const day of days) {
    const slots = schedulesByDate(day.date);
    const obs = observations.get(day.date);

    const scheduledHours = slots.reduce((sum, s) => {
      const b = splitIntoBands(day.date, s.start_time, s.end_time);
      return sum + b.day_ld + b.night_ld + b.day_hd + b.night_hd;
    }, 0);

    if (slots.length === 0) {
      if (obs?.clockedHours) {
        warnings.push({
          date: day.date,
          code: 'worked_without_schedule',
          detail: `Marcó ${obs.clockedHours.toFixed(2)} h sin esquema asignado`,
        });
      }
      continue;
    }

    // Los días justificados no generan alerta por falta de marcación
    if (day.exception || day.isHoliday) continue;

    if (!obs || obs.clockIn === null) {
      warnings.push({
        date: day.date,
        code: 'no_clock_in',
        detail: `Esquema de ${scheduledHours.toFixed(2)} h sin marcación de ingreso`,
      });
      continue;
    }

    if (obs.clockOut === null) {
      warnings.push({
        date: day.date,
        code: 'no_clock_out',
        detail: 'Marcó ingreso pero no egreso',
      });
      continue;
    }

    const scheduledStart = Math.min(...slots.map((s) => timeToMinutes(s.start_time)));
    if (timeToMinutes(obs.clockIn) > scheduledStart + toleranceMinutes) {
      warnings.push({
        date: day.date,
        code: 'arrived_late',
        detail: `Ingresó ${obs.clockIn} y el esquema empieza ${minutesToTime(scheduledStart)}`,
      });
    }

    if (obs.clockedHours !== null && obs.clockedHours < scheduledHours - tolerance) {
      warnings.push({
        date: day.date,
        code: 'left_early',
        detail: `Marcó ${obs.clockedHours.toFixed(2)} h contra ${scheduledHours.toFixed(2)} h de esquema`,
      });
    }

    // Trabajar de más lo evalúa `reviewOvertimeOutcomes`, que además sabe si el
    // supervisor cargó horas para cubrirlo.
  }

  return warnings;
}

/**
 * Avisos sobre las horas cargadas por el supervisor.
 *
 * El motor recorta lo que se paga, pero nunca lo hace en silencio: cada recorte
 * y cada excedente sin cubrir sale acá para que alguien lo mire.
 */
export function reviewOvertimeOutcomes(
  outcomes: OvertimeOutcome[],
  thresholdHours: number = ADDITIONAL_THRESHOLD_HOURS
): SettlementWarning[] {
  const warnings: SettlementWarning[] = [];
  const fmt = (h: number) => h.toFixed(2);

  for (const o of outcomes) {
    const uncovered = o.excessHours - o.paidHours;

    // Trabajó de más y no está cubierto. Se avisa cuando lo que falta cubrir
    // supera el umbral por sí solo, para no llenar de avisos por diferencias
    // de minutos contra lo que el supervisor ya autorizó.
    if (uncovered > thresholdHours) {
      warnings.push({
        date: o.date,
        code: 'worked_more_than_schedule',
        detail:
          o.loadedHours > 0
            ? `Trabajó ${fmt(o.excessHours)} h fuera del esquema y sólo hay ` +
              `${fmt(o.loadedHours)} h cargadas: ${fmt(uncovered)} h sin autorizar`
            : `Trabajó ${fmt(o.excessHours)} h fuera del esquema sin horas cargadas`,
      });
    }

    // Cargó horas y ese día no hubo excedente: no se paga nada
    if (o.loadedHours > 0 && o.excessHours <= thresholdHours) {
      warnings.push({
        date: o.date,
        code: 'additional_without_excess',
        detail:
          `Hay ${fmt(o.loadedHours)} h cargadas pero el excedente trabajado fue de ` +
          `${fmt(o.excessHours)} h: no se liquidan`,
      });
    }

    // Autorizó más de lo que estuvo: se recorta al excedente
    if (o.excessHours > thresholdHours && o.loadedHours > o.paidHours + 0.0001) {
      warnings.push({
        date: o.date,
        code: 'additional_over_worked',
        detail:
          `Se cargaron ${fmt(o.loadedHours)} h y se liquidan ${fmt(o.paidHours)} h, ` +
          `que es lo que trabajó fuera del esquema`,
      });
    }
  }

  return warnings;
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ─── Período de liquidación ─────────────────────────────────────────

/**
 * El período no es el mes calendario: arranca el día `startDay` del mes anterior
 * y termina el día anterior del mes que se liquida.
 * Ej.: con startDay = 26, julio 2026 va del 2026-06-26 al 2026-07-25.
 *
 * El día 1 es el caso borde: la fórmula general daría "hasta el día 0 de julio",
 * o sea junio entero. Cuando alguien elige 1 lo que quiere es el mes calendario,
 * así que se resuelve aparte.
 */
export function settlementPeriod(
  year: number,
  month: number, // 1-12
  startDay: number
): { from: string; to: string } {
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  if (startDay <= 1) {
    return {
      from: iso(new Date(Date.UTC(year, month - 1, 1))),
      to: iso(new Date(Date.UTC(year, month, 0))), // día 0 del mes siguiente
    };
  }

  return {
    from: iso(new Date(Date.UTC(year, month - 2, startDay))),
    to: iso(new Date(Date.UTC(year, month - 1, startDay - 1))),
  };
}

// ─── Conciliación contra lo ya pagado ───────────────────────────────

export interface PaidLine {
  date: string;
  band: Band;
  tier: Tier;
  hours: number;
  client_id: string | null;
}

/**
 * Diferencia entre lo que se pagó y lo que hoy dicen los datos, para un conjunto
 * de fechas.
 *
 * Se usa para conciliar el cierre del período anterior: los últimos días se
 * pagaron proyectados desde el esquema, y si después apareció una ausencia o una
 * licencia, la diferencia se arrastra al período siguiente en vez de tocar una
 * liquidación ya cerrada.
 *
 * Las horas pueden dar negativas: se pagó de más y se descuenta.
 */
export function computeAdjustments(
  paid: PaidLine[],
  actual: DailyLine[],
  dates: string[]
): DailyLine[] {
  const inRange = new Set(dates);
  const key = (l: { date: string; band: string; tier: string; client_id: string | null }) =>
    [l.date, l.band, l.tier, l.client_id ?? ''].join('|');

  const totals = new Map<string, { paid: number; actual: number }>();
  const bump = (k: string, field: 'paid' | 'actual', hours: number) => {
    const cur = totals.get(k) ?? { paid: 0, actual: 0 };
    cur[field] += hours;
    totals.set(k, cur);
  };

  for (const l of paid) {
    if (inRange.has(l.date)) bump(key(l), 'paid', Number(l.hours));
  }
  for (const l of actual) {
    if (inRange.has(l.date)) bump(key(l), 'actual', l.hours);
  }

  const adjustments: DailyLine[] = [];
  for (const [k, t] of totals) {
    const delta = t.actual - t.paid;
    if (Math.abs(delta) < 0.0001) continue;

    const [date, band, tier, clientId] = k.split('|');
    adjustments.push({
      date, // la fecha original, aunque caiga fuera del período que se liquida
      band: band as Band,
      tier: tier as Tier,
      hours: Math.round(delta * 10000) / 10000,
      client_id: clientId || null,
      source: 'adjustment',
    });
  }

  return adjustments.sort(
    (a, b) => a.date.localeCompare(b.date) || a.band.localeCompare(b.band)
  );
}
