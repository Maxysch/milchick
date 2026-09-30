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
 * Reparte un tramo en minutos —desde la medianoche de `date`, puede pasar de
 * 1440— entre las cuatro bandas.
 */
export function splitRangeIntoBands(date: string, start: number, end: number): BandHours {
  const result = emptyBandHours();
  if (end <= start) return result;
  const startDow = isoDayOfWeek(date);

  // Recorremos los segmentos delimitados por los cortes de banda de cada día tocado
  const cuts: number[] = [start, end];
  for (let dayOffset = Math.floor(start / MIN_24); dayOffset <= Math.floor(end / MIN_24); dayOffset++) {
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

/**
 * Reparte un tramo horario entre las cuatro bandas.
 * Si `endTime` es menor o igual que `startTime`, se asume que cruza la medianoche.
 */
export function splitIntoBands(date: string, startTime: string, endTime: string): BandHours {
  const start = timeToMinutes(startTime);
  return splitRangeIntoBands(date, start, endMinutes(start, timeToMinutes(endTime)));
}

/**
 * Fin de un tramo en minutos desde la medianoche del día de inicio. Si es
 * anterior al inicio, cruza la medianoche (22:00–02:00). Si es igual, el tramo
 * no dura nada: una entrada y una salida en el mismo minuto son un doble toque,
 * no 24 horas de trabajo.
 */
export function endMinutes(start: number, rawEnd: number): number {
  if (rawEnd > start) return rawEnd;
  return rawEnd === start ? start : rawEnd + MIN_24;
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
  /**
   * Pagar aunque la marcación no lo respalde. Es la forma de decir "esto se
   * trabajó y la marcación está mal", o de pagar un arrastre en un día sin
   * excedente. Sin esto, lo autorizado se topea contra lo trabajado.
   */
  uncapped?: boolean;
}

export type DayExceptionType =
  | 'vacation'
  | 'paid_leave'          // licencia paga (examen, duelo, enfermedad con certificado)
  | 'absence'
  | 'schedule_change'
  | 'extraordinary_coverage';

/**
 * Tipos de excepción que pueden traer un horario propio. Cuando lo traen, ese
 * horario REEMPLAZA al esquema del día: es la única forma de decir "este
 * miércoles fue de 17 a 23" sin que el sistema lo tome como horas de más.
 */
export const EXCEPTIONS_WITH_HOURS: DayExceptionType[] = ['schedule_change', 'extraordinary_coverage'];

export interface DayContext {
  date: string;
  isHoliday: boolean;
  exception: DayExceptionType | null;
  /** Horario de la excepción, si lo trae. Reemplaza al esquema de ese día. */
  exceptionBlocks?: TimeBlock[] | null;
  exceptionClientId?: string | null;
}

export type LineSource =
  | 'schedule'
  | 'exception'
  | 'overtime'
  | 'manual'
  | 'adjustment'     // diferencia contra lo proyectado en el período anterior
  | 'correction'     // el día lo normalizó un supervisor
  | 'compensation';  // compensación fija por día trabajado

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

// ─── Tramos en minutos ──────────────────────────────────────────────

/** Un tramo "HH:mm"–"HH:mm". Si termina antes de empezar, cruza la medianoche. */
export interface TimeBlock {
  start_time: string;
  end_time: string;
}

/** Un tramo en minutos desde la medianoche del día. Puede pasar de 1440. */
export type MinuteRange = [number, number];

export function blockToRange(b: TimeBlock): MinuteRange {
  const start = timeToMinutes(b.start_time);
  return [start, endMinutes(start, timeToMinutes(b.end_time))];
}

export function rangeToBlock([a, b]: MinuteRange): TimeBlock {
  return { start_time: minutesToTime(a), end_time: minutesToTime(b) };
}

/** Une tramos superpuestos o contiguos. */
export function unionRanges(ranges: MinuteRange[]): MinuteRange[] {
  const sorted = ranges.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: MinuteRange[] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

export function rangeMinutes(ranges: MinuteRange[]): number {
  return ranges.reduce((s, [a, b]) => s + (b - a), 0);
}

export function intersectRanges(a: MinuteRange[], b: MinuteRange[]): MinuteRange[] {
  const out: MinuteRange[] = [];
  for (const [a1, a2] of a) {
    for (const [b1, b2] of b) {
      const s = Math.max(a1, b1);
      const e = Math.min(a2, b2);
      if (e > s) out.push([s, e]);
    }
  }
  return unionRanges(out);
}

/** Lo que queda de `a` después de sacarle `b`. */
export function subtractRanges(a: MinuteRange[], b: MinuteRange[]): MinuteRange[] {
  let result = unionRanges(a);
  for (const [b1, b2] of unionRanges(b)) {
    const next: MinuteRange[] = [];
    for (const [a1, a2] of result) {
      if (b2 <= a1 || b1 >= a2) {
        next.push([a1, a2]);
        continue;
      }
      if (b1 > a1) next.push([a1, b1]);
      if (b2 < a2) next.push([b2, a2]);
    }
    result = next;
  }
  return result;
}

function bandHoursOfRanges(date: string, ranges: MinuteRange[]): BandHours {
  const acc = emptyBandHours();
  for (const [s, e] of ranges) {
    const b = splitRangeIntoBands(date, s, e);
    for (const band of ALL_BANDS) acc[band] += b[band];
  }
  return acc;
}

function totalBandHours(b: BandHours): number {
  return b.day_ld + b.night_ld + b.day_hd + b.night_hd;
}

// ─── Entradas del día ───────────────────────────────────────────────

export interface BuildDailyLinesInput {
  days: DayContext[];
  /** Esquemas vigentes en el período, ya filtrados por fecha de vigencia */
  schedulesByDate: (date: string) => ScheduleSlot[];
  overtime: OvertimeRecord[];
  /**
   * Marcaciones del período. Sin esto las horas cargadas por el supervisor se
   * pagan sin tope y no hay contra qué contrastar el plan.
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
  /** Horas trabajadas por encima de lo que se esperaba ese día */
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
 * Cómo resolvió un supervisor un día que no cerraba. Es un dato de entrada, no
 * una edición del resultado: vive aparte y el cálculo lo relee cada vez, así que
 * recalcular nunca pierde una decisión ya tomada.
 *
 *   plan   → está bien así: se paga lo planificado aunque la marcación diga otra cosa
 *   marks  → se paga lo que se marcó
 *   custom → se paga un horario que carga el supervisor
 *   none   → ese día no se paga
 *   manual → horas cargadas a mano por banda y tramo, desde la tabla
 */
export type CorrectionResolution = 'plan' | 'marks' | 'custom' | 'none' | 'manual';

export interface CorrectionLine {
  band: Band;
  tier: Tier;
  hours: number;
}

export interface DayCorrection {
  date: string;
  resolution: CorrectionResolution;
  /** Horario que se paga (plan, marks, custom). Vacío en `none`. */
  blocks?: TimeBlock[] | null;
  /** Sólo en `manual`: lo que se paga, tal cual */
  lines?: CorrectionLine[] | null;
  client_id?: string | null;
}

/**
 * Cuándo un día se paga solo y cuándo hay que mirarlo.
 *
 * Los márgenes son por punta y por dirección. Llegar antes no cuenta: el plan se
 * paga igual y no cambia nada. Lo que mueve la plata es llegar tarde, irse
 * antes o quedarse de más.
 */
export interface NormalizationMargins {
  lateArrivalMinutes: number;
  earlyDepartureMinutes: number;
  /** Excedente mínimo para pagar horas autorizadas y para avisar de las que no */
  additionalThresholdMinutes: number;
  /** Si un día con plan y sin ninguna marcación bloquea la confirmación */
  missingClockBlocks: boolean;
  /** Si un ingreso sin egreso (o un egreso sin ingreso) bloquea la confirmación */
  incompleteClockBlocks: boolean;
  /**
   * Días desde el ingreso en los que un agente nuevo, sin marcación completa,
   * se revisa igual. Es donde está el riesgo: inducción y capacitación.
   */
  newHireReviewDays: number;
}

/**
 * Por defecto, un día sin marcación completa no bloquea. En julio y agosto la
 * planilla pagó el plan en los 44 días así de agentes con antigüedad: siempre
 * fue "se olvidó de marcar". Los que no, fueron todos de agentes en sus dos
 * primeras semanas, y eso lo cubre `newHireReviewDays`.
 */
export const DEFAULT_MARGINS: NormalizationMargins = {
  lateArrivalMinutes: 20,
  earlyDepartureMinutes: 20,
  additionalThresholdMinutes: 30,
  missingClockBlocks: false,
  incompleteClockBlocks: false,
  newHireReviewDays: 14,
};

/** Minutos que se pagan por cada día trabajado, además del plan. */
export interface DailyCompensation {
  minutes: number;
  band: Band;
}

export type DayStatus =
  | 'auto'          // se pagó el plan y las marcaciones lo acompañan
  | 'unverified'    // se pagó el plan sin marcación completa, sin bloquear
  | 'needs_review'  // hay un desvío que bloquea: falta normalizarlo
  | 'corrected'     // lo normalizó un supervisor
  | 'projected'     // todavía no ocurrió
  | 'leave'         // vacaciones o licencia paga
  | 'holiday'       // feriado no trabajado
  | 'absence'
  | 'off';          // sin plan y sin trabajo

export interface DayResult {
  date: string;
  status: DayStatus;
  /** Lo que se esperaba: el esquema, o el horario de la excepción */
  plan: TimeBlock[];
  /** Lo que se marcó */
  marked: TimeBlock[];
  /** Horas regulares pagadas (sin horas autorizadas ni compensación) */
  regularHours: number;
  exception: DayExceptionType | null;
  correction: CorrectionResolution | null;
  /** Está dentro de las primeras semanas de un agente nuevo */
  newHire: boolean;
}

export interface SettleDaysInput extends BuildDailyLinesInput {
  corrections?: Map<string, DayCorrection>;
  margins?: Partial<NormalizationMargins>;
  compensation?: DailyCompensation | null;
  /** Desde esta fecha, inclusive, los días son proyectados y no se contrastan */
  today?: string;
  /** Fecha de ingreso: antes de ella el esquema no rige */
  hireDate?: string | null;
}

export interface SettleDaysResult extends BuildDailyLinesResult {
  warnings: SettlementWarning[];
  days: DayResult[];
}

// ─── Marcaciones ────────────────────────────────────────────────────

export interface ClockObservation {
  date: string;
  /** Horas efectivamente marcadas ese día, si hay marcación */
  clockedHours: number | null;
  /** Primer ingreso del día */
  clockIn: string | null;
  /** Último egreso conocido del día */
  clockOut: string | null;
  /**
   * Cada tramo marcado por separado. Hace falta para medir bien: un tramo
   * desconectado del plan no se puede detectar mirando sólo el span del primer
   * ingreso al último egreso.
   */
  segments?: { clockIn: string; clockOut: string }[];
  /** Hay al menos un ingreso sin su egreso */
  incomplete?: boolean;
}

function markedRanges(obs: ClockObservation | undefined): MinuteRange[] {
  if (!obs) return [];
  const segments =
    obs.segments && obs.segments.length > 0
      ? obs.segments
      : obs.clockIn && obs.clockOut
        ? [{ clockIn: obs.clockIn, clockOut: obs.clockOut }]
        : [];
  return unionRanges(
    segments.map((s) => blockToRange({ start_time: s.clockIn, end_time: s.clockOut }))
  );
}

function isIncomplete(obs: ClockObservation | undefined): boolean {
  if (!obs) return false;
  if (obs.incomplete !== undefined) return obs.incomplete;
  return obs.clockIn !== null && obs.clockOut === null;
}

function hasAnyMark(obs: ClockObservation | undefined): boolean {
  return (
    !!obs &&
    (obs.clockIn !== null || obs.clockOut !== null || (obs.segments?.length ?? 0) > 0 || !!obs.incomplete)
  );
}

// ─── Avisos ─────────────────────────────────────────────────────────

export type WarningCode =
  | 'no_clock_in'
  | 'no_clock_out'
  | 'left_early'
  | 'arrived_late'
  | 'worked_without_schedule'
  | 'worked_more_than_schedule'   // trabajó de más sin cubrir con horas autorizadas
  | 'worked_other_hours'          // marcó en otro horario que el del plan
  | 'worked_on_holiday'           // marcó en un feriado sin cobertura
  | 'clocked_on_leave'            // marcó un día de ausencia, vacaciones o licencia
  | 'additional_without_excess'   // se cargaron horas y no hubo excedente
  | 'additional_over_worked'      // se cargó más de lo que estuvo
  | 'additional_unverified'       // se pagó lo autorizado sin marcación completa que lo respalde
  | 'absence'
  | 'missing_period_params';      // no se cargó la evaluación del mes

/** Datos para que la pantalla muestre el caso y proponga cómo resolverlo. */
export interface WarningContext {
  plan: TimeBlock[];
  marked: TimeBlock[];
  lateMinutes?: number;
  earlyMinutes?: number;
  excessHours?: number;
  authorizedHours?: number;
  /** Horas a autorizar si se decide pagarlas, redondeadas hacia abajo a la media hora */
  suggestedHours?: number;
  /** El tramo del plan que no tiene ninguna marcación */
  missedBlock?: TimeBlock;
}

export interface SettlementWarning {
  date: string;
  code: WarningCode;
  detail: string;
  /** Bloquea la confirmación hasta que alguien normalice el día */
  blocking?: boolean;
  context?: WarningContext;
}

export const CLOCK_TOLERANCE_MINUTES = 15;

function fmtBlocks(blocks: TimeBlock[]): string {
  return blocks.length === 0 ? '—' : blocks.map((b) => `${b.start_time}–${b.end_time}`).join(' + ');
}

/** Horas para leer en un aviso: "41 min" debajo de la hora, "6,17 h" o "2 h" arriba */
function fmtH(h: number): string {
  const min = Math.round(h * 60);
  return min < 60 ? `${min} min` : `${String(Number(h.toFixed(2))).replace('.', ',')} h`;
}

/** Minutos para leer en un aviso: "45 min", "2 h", "1 h 15 min" */
function fmtMin(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
}

const floorToHalfHour = (h: number) => Math.floor(h * 2 + 1e-9) / 2;

/** "YYYY-MM-DD" + n días */
export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ─── El día, resuelto ───────────────────────────────────────────────

/**
 * Resuelve cada día del período: qué se paga y si hace falta que alguien lo mire.
 *
 * Cada día se evalúa en este orden, y el primero que aplica decide:
 *
 *   1. Corrección del supervisor  → se paga lo que dice la corrección
 *   2. Ausencia                   → no se paga
 *   3. Feriado sin cobertura      → no se paga como horas: va a la compensación
 *   4. Vacaciones / licencia      → se paga el plan, sin esperar marcación
 *   5. Día normal                 → se paga el plan
 *
 * El plan es el esquema, salvo que la excepción del día traiga su propio
 * horario: ahí lo reemplaza.
 *
 * Encima de eso van las horas autorizadas (horas fuera del esquema), que se
 * pagan hasta lo que el agente efectivamente trabajó por encima de lo esperado.
 *
 * Las marcaciones no pagan: contrastan. Un día que no cierra contra el plan más
 * allá de los márgenes queda para normalizar y bloquea la confirmación.
 */
export function settleDays(input: SettleDaysInput): SettleDaysResult {
  const {
    days,
    schedulesByDate,
    overtime,
    observations,
    corrections,
    compensation,
    today,
    hireDate,
  } = input;

  const m: NormalizationMargins = {
    ...DEFAULT_MARGINS,
    ...(input.additionalThresholdHours !== undefined
      ? { additionalThresholdMinutes: input.additionalThresholdHours * 60 }
      : {}),
    ...input.margins,
  };
  const threshold = m.additionalThresholdMinutes;
  const hasObservations = observations !== undefined;

  const lines: DailyLine[] = [];
  const warnings: SettlementWarning[] = [];
  const results: DayResult[] = [];
  const overtimeOutcomes: OvertimeOutcome[] = [];
  const absenceDates: string[] = [];
  let unworkedHolidayHours = 0;
  let vacationHours = 0;

  // Horas autorizadas por día, en orden de recargo creciente: si hay que
  // recortar, se recorta primero lo más caro y el resultado es explicable.
  const otByDate = new Map<string, OvertimeRecord[]>();
  for (const ot of [...overtime].sort(
    (a, b) => ALL_TIERS.indexOf(a.tier) - ALL_TIERS.indexOf(b.tier)
  )) {
    const list = otByDate.get(ot.date) ?? [];
    list.push(ot);
    otByDate.set(ot.date, list);
  }

  const warn = (w: SettlementWarning) => warnings.push(w);

  const reviewUntil = hireDate ? addDays(hireDate, m.newHireReviewDays) : null;

  for (const day of days) {
    const date = day.date;
    const beforeHire = !!hireDate && date < hireDate;
    const newHire = !!hireDate && !beforeHire && !!reviewUntil && date < reviewUntil;
    // Antes del ingreso el esquema no rige. Una excepción con horario sí: es la
    // forma de cargar un día de capacitación previo al alta.
    const slots = beforeHire ? [] : schedulesByDate(date);
    const scheduleHours = slots.reduce(
      (s, x) => s + totalBandHours(splitIntoBands(date, x.start_time, x.end_time)),
      0
    );

    const exBlocks =
      day.exception && EXCEPTIONS_WITH_HOURS.includes(day.exception) && day.exceptionBlocks?.length
        ? day.exceptionBlocks
        : null;

    // El plan: el esquema, o el horario de la excepción si lo trae
    const plan: TimeBlock[] = exBlocks ?? slots.map((s) => ({ start_time: s.start_time, end_time: s.end_time }));
    const planRanges = unionRanges(plan.map(blockToRange));
    const planClient = exBlocks ? (day.exceptionClientId ?? slots[0]?.client_id ?? null) : null;

    const obs = observations?.get(date);
    const markedR = markedRanges(obs);
    const marked = markedR.map(rangeToBlock);
    const workedMin = rangeMinutes(markedR);
    const incomplete = isIncomplete(obs);
    const projected = today !== undefined && date >= today;

    const correction = corrections?.get(date) ?? null;

    /** Líneas regulares desde un conjunto de tramos */
    const pushBlocks = (blocks: TimeBlock[], source: LineSource, clientId: string | null) => {
      let total = 0;
      for (const b of blocks) {
        const bands = splitIntoBands(date, b.start_time, b.end_time);
        for (const band of ALL_BANDS) {
          if (bands[band] > 0) {
            lines.push({ date, band, tier: 'normal', hours: bands[band], client_id: clientId, source });
            total += bands[band];
          }
        }
      }
      return total;
    };

    /** Líneas regulares desde el esquema, conservando el cliente de cada bloque */
    const pushSchedule = (source: LineSource) => {
      if (exBlocks) return pushBlocks(exBlocks, source, planClient);
      let total = 0;
      for (const slot of slots) {
        const bands = splitIntoBands(date, slot.start_time, slot.end_time);
        for (const band of ALL_BANDS) {
          if (bands[band] > 0) {
            lines.push({ date, band, tier: 'normal', hours: bands[band], client_id: slot.client_id, source });
            total += bands[band];
          }
        }
      }
      return total;
    };

    /**
     * Horas autorizadas del día, topeadas contra lo trabajado por encima de lo
     * esperado. `expected` son los tramos que se esperaba que trabajara: el
     * plan en un día normal, nada en un feriado o una licencia.
     *
     * El excedente es neto —lo trabajado menos lo esperado— y no "lo que cae
     * fuera del horario". Así, una jornada corrida de lugar (esperado 09-15,
     * marcado 17-23) no tiene excedente: son las mismas seis horas. Contarlas
     * como horas de más es lo que producía el doble pago.
     */
    const payOvertime = (expected: MinuteRange[], informOnly: boolean, kind: 'regular' | 'holiday' | 'leave' | 'none') => {
      const loadedRecords = otByDate.get(date) ?? [];
      const loaded = loadedRecords.reduce((s, r) => s + Number(r.hours), 0);
      const forced = loadedRecords.filter((r) => r.uncapped).reduce((s, r) => s + Number(r.hours), 0);

      // Qué tan confiable es la marcación de este día
      const evidence: 'absent' | 'none' | 'partial' | 'complete' =
        !hasObservations ? 'absent'
          : !hasAnyMark(obs) ? 'none'
            : incomplete ? 'partial'
              : 'complete';

      // Excedente neto: lo trabajado menos lo esperado. Con marcación parcial es
      // un piso: trabajó por lo menos eso.
      const excessMin =
        evidence === 'partial' || evidence === 'complete'
          ? Math.max(0, workedMin - rangeMinutes(expected))
          : null;

      // Con marcación completa lo autorizado se contrasta contra lo trabajado:
      //   - si no hubo excedente real (por debajo del umbral), no se paga
      //   - si lo trabajado está dentro del margen de lo autorizado, se paga lo
      //     autorizado: en julio y agosto la planilla lo hizo así en los 36 días
      //     de ese tipo, nunca al minuto
      //   - si trabajó claramente menos, se paga lo trabajado y se avisa
      // Sin marcación completa no hay con qué contradecirlo: no saber cuánto
      // trabajó no es lo mismo que saber que no trabajó.
      const autorizado = loaded - forced;
      const capped = evidence === 'complete'
        ? excessMin! <= threshold
          ? 0
          : excessMin! >= autorizado * 60 - threshold
            ? autorizado
            : excessMin! / 60
        : autorizado;
      const budgetHours = Math.max(0, capped) + forced;

      // Dónde cayó lo trabajado de más, para pagarlo en su banda. Se toma del
      // final hacia atrás: lo típico es quedarse, no llegar antes.
      let outside = subtractRanges(markedR, expected);
      let remaining = budgetHours;
      let paid = 0;

      // Primero lo que se paga sin tope, después el resto
      const ordered = [...loadedRecords.filter((r) => r.uncapped), ...loadedRecords.filter((r) => !r.uncapped)];
      for (const ot of ordered) {
        if (remaining <= 0.0001) break;
        const hours = Math.min(Number(ot.hours), remaining);
        remaining -= hours;
        paid += hours;

        if (ot.start_time && ot.end_time) {
          const bands = splitIntoBands(date, ot.start_time, ot.end_time);
          const total = totalBandHours(bands);
          for (const band of ALL_BANDS) {
            if (bands[band] > 0) {
              lines.push({
                date, band, tier: ot.tier,
                // Si las horas declaradas no coinciden con el horario, se
                // reparten en la misma proporción que las bandas
                hours: total > 0 ? (hours * bands[band]) / total : 0,
                client_id: ot.client_id, source: 'overtime',
              });
            }
          }
          continue;
        }

        if (outside.length === 0) {
          // Sin marcación para ubicarlas: la banda diurna habitual
          lines.push({ date, band: 'day_ld', tier: ot.tier, hours, client_id: ot.client_id, source: 'overtime' });
          continue;
        }

        // Consumir los minutos de afuera, del último hacia atrás
        let need = hours * 60;
        const taken: MinuteRange[] = [];
        const rest: MinuteRange[] = [];
        for (let i = outside.length - 1; i >= 0; i--) {
          const [a, b] = outside[i];
          if (need <= 0) { rest.unshift([a, b]); continue; }
          const len = b - a;
          if (len <= need) { taken.push([a, b]); need -= len; }
          else { taken.push([b - need, b]); rest.unshift([a, b - need]); need = 0; }
        }
        outside = rest;
        const bands = bandHoursOfRanges(date, taken);
        const placed = totalBandHours(bands);
        for (const band of ALL_BANDS) {
          if (bands[band] > 0) {
            lines.push({ date, band, tier: ot.tier, hours: bands[band], client_id: ot.client_id, source: 'overtime' });
          }
        }
        // Lo que no se pudo ubicar en la marcación va a la banda diurna
        if (hours - placed > 0.0001) {
          lines.push({ date, band: 'day_ld', tier: ot.tier, hours: hours - placed, client_id: ot.client_id, source: 'overtime' });
        }
      }

      const excessHours = excessMin === null ? loaded : excessMin / 60;
      if (loaded > 0 || (excessMin !== null && excessMin > threshold)) {
        overtimeOutcomes.push({ date, loadedHours: loaded, excessHours, paidHours: paid });
      }

      if (evidence === 'absent') return { blocking: false };

      const ctxBase: WarningContext = {
        plan, marked,
        excessHours: excessMin === null ? undefined : excessMin / 60,
        authorizedHours: loaded,
      };

      // Lo autorizado sin marcación completa: se paga, y queda dicho
      if (evidence !== 'complete' && loaded - forced > 0.0001) {
        warn({
          date, code: 'additional_unverified', blocking: false, context: ctxBase,
          detail: `Se pagan ${fmtH(loaded - forced)} de lo autorizado sin una marcación completa que lo respalde`,
        });
      }

      let blocking = false;

      // Autorizado y no trabajado. Con marcación completa, si la diferencia pasa
      // el umbral, alguien tiene que decidir: la regla dice no pagar, pero puede
      // ser un arrastre mal cargado o una marcación mal hecha.
      if (evidence === 'complete') {
        const unsupportedMin = (loaded - paid) * 60;
        if (unsupportedMin > 0.0001) {
          const bloquea = !informOnly && unsupportedMin > threshold;
          const code: WarningCode = paid < 0.0001 ? 'additional_without_excess' : 'additional_over_worked';
          warn({
            date, code, blocking: bloquea, context: ctxBase,
            detail:
              `Se autorizaron ${fmtH(loaded)} y la marcación muestra ${fmtH(excessMin! / 60)} ` +
              `por encima de lo esperado: ${paid < 0.0001 ? 'no se paga ninguna' : `se pagan ${fmtH(paid)}`}` +
              (bloquea ? `. Confirmá si ${paid < 0.0001 ? '' : 'las otras '}se pagan igual` : ''),
          });
          blocking ||= bloquea;
        }
      }

      // Trabajado y no autorizado
      if (informOnly || excessMin === null) return { blocking };
      const uncoveredMin = excessMin - paid * 60;
      if (uncoveredMin <= threshold) return { blocking };

      const code: WarningCode =
        kind === 'holiday' ? 'worked_on_holiday'
          : kind === 'leave' ? 'clocked_on_leave'
            : kind === 'none' ? 'worked_without_schedule'
              : 'worked_more_than_schedule';

      const uncoveredH = uncoveredMin / 60;
      const where = `marcó ${fmtBlocks(marked)}`;
      const detail =
        code === 'worked_more_than_schedule'
          ? loaded > 0
            ? `Trabajó ${fmtH(excessMin / 60)} más que el plan (${fmtBlocks(plan)}) y se ` +
              `autorizaron ${fmtH(loaded)}: quedan ${fmtH(uncoveredH)} sin autorizar`
            : `Trabajó ${fmtH(uncoveredH)} más que el plan (${fmtBlocks(plan)}) sin horas autorizadas: ${where}`
          : code === 'worked_on_holiday'
            ? `Feriado sin cobertura cargada, pero ${where} (${fmtH(uncoveredH)})`
            : code === 'clocked_on_leave'
              ? `Día de ${day.exception === 'absence' ? 'ausencia' : 'licencia'}, pero ${where} (${fmtH(uncoveredH)})`
              : `Sin esquema ese día, pero ${where} (${fmtH(uncoveredH)})`;

      warn({
        date, code, detail, blocking: true,
        context: { ...ctxBase, suggestedHours: floorToHalfHour(uncoveredH) },
      });
      return { blocking: true };
    };

    const addCompensation = (regular: number) => {
      if (!compensation || compensation.minutes <= 0 || regular <= 0) return;
      lines.push({
        date, band: compensation.band, tier: 'normal',
        hours: compensation.minutes / 60, client_id: null, source: 'compensation',
      });
    };

    const finish = (status: DayStatus, regular: number) => {
      results.push({
        date, status, plan, marked, regularHours: regular,
        exception: day.exception, correction: correction?.resolution ?? null,
        newHire,
      });
    };

    // ── 1. Corrección del supervisor ──
    if (correction) {
      if (correction.resolution === 'manual') {
        let regular = 0;
        for (const l of correction.lines ?? []) {
          if (l.hours === 0) continue;
          lines.push({ date, band: l.band, tier: l.tier, hours: l.hours, client_id: correction.client_id ?? null, source: 'correction' });
          if (l.tier === 'normal') regular += l.hours;
        }
        // Un feriado normalizado sin horas sigue siendo un feriado no trabajado
        if (day.isHoliday && regular === 0) unworkedHolidayHours += scheduleHours;
        finish('corrected', regular);
        continue;
      }

      const blocks = correction.resolution === 'none' ? [] : (correction.blocks ?? []);
      const regular = pushBlocks(blocks, 'correction', correction.client_id ?? planClient ?? slots[0]?.client_id ?? null);

      // Un feriado que se normalizó como no trabajado sigue compensándose
      if (day.isHoliday && regular === 0) unworkedHolidayHours += scheduleHours;
      // Mantener la licencia conserva el plus vacacional
      if (day.exception === 'vacation' && correction.resolution === 'plan') vacationHours += regular;

      if (day.exception !== 'absence') {
        payOvertime(unionRanges(blocks.map(blockToRange)), true, 'regular');
      }
      if (day.exception !== 'vacation' && day.exception !== 'paid_leave') addCompensation(regular);
      finish('corrected', regular);
      continue;
    }

    // ── 2. Ausencia ──
    if (day.exception === 'absence') {
      absenceDates.push(date);
      if (hasObservations && !projected && workedMin > threshold) {
        warn({
          date, code: 'clocked_on_leave', blocking: true,
          context: { plan, marked, excessHours: workedMin / 60, suggestedHours: floorToHalfHour(workedMin / 60) },
          detail: `Día de ausencia, pero marcó ${fmtBlocks(marked)} (${fmtH(workedMin / 60)})`,
        });
        finish('needs_review', 0);
      } else {
        finish('absence', 0);
      }
      continue;
    }

    // ── 3. Feriado sin cobertura ──
    if (day.isHoliday && day.exception !== 'extraordinary_coverage') {
      unworkedHolidayHours += scheduleHours;
      const { blocking } = projected ? { blocking: false } : payOvertime([], false, 'holiday');
      finish(blocking ? 'needs_review' : 'holiday', 0);
      continue;
    }

    // ── 4. Vacaciones y licencias ──
    if (day.exception === 'vacation' || day.exception === 'paid_leave') {
      const regular = pushSchedule('exception');
      if (day.exception === 'vacation') vacationHours += regular;
      const { blocking } = projected ? { blocking: false } : payOvertime([], false, 'leave');
      finish(blocking ? 'needs_review' : 'leave', regular);
      continue;
    }

    // ── 5. Día normal ──
    const regular = pushSchedule(day.exception ? 'exception' : 'schedule');
    addCompensation(regular);

    if (projected) {
      payOvertime(planRanges, true, 'regular');
      finish(regular > 0 ? 'projected' : 'off', regular);
      continue;
    }

    if (planRanges.length === 0) {
      const { blocking } = payOvertime([], false, 'none');
      finish(blocking ? 'needs_review' : 'off', regular);
      continue;
    }

    if (!hasObservations) {
      payOvertime(planRanges, false, 'regular');
      finish('auto', regular);
      continue;
    }

    // Contraste contra la marcación
    let blocking = false;
    let unverified = false;
    const planMin = rangeMinutes(planRanges);

    const nuevo = newHire ? ' — agente nuevo: se revisa igual' : '';
    const bloqueaFaltante = m.missingClockBlocks || newHire;
    const bloqueaIncompleta = m.incompleteClockBlocks || newHire;

    if (!hasAnyMark(obs)) {
      warn({
        date, code: 'no_clock_in', blocking: bloqueaFaltante, context: { plan, marked },
        detail: `Plan de ${fmtH(planMin / 60)} (${fmtBlocks(plan)}) sin ninguna marcación${nuevo}`,
      });
      blocking ||= bloqueaFaltante;
      unverified = true;
    } else if (incomplete && markedR.length === 0) {
      warn({
        date, code: 'no_clock_out', blocking: bloqueaIncompleta, context: { plan, marked },
        detail: (obs?.clockIn
          ? `Marcó ingreso a las ${obs.clockIn} y nunca el egreso`
          : `Marcó egreso a las ${obs?.clockOut ?? '—'} sin haber marcado el ingreso`) + nuevo,
      });
      blocking ||= bloqueaIncompleta;
      unverified = true;
    } else {
      if (incomplete) {
        warn({
          date, code: 'no_clock_out', blocking: bloqueaIncompleta, context: { plan, marked },
          detail: `Quedó un ingreso sin su egreso${nuevo}`,
        });
        blocking ||= bloqueaIncompleta;
      }

      const covered = intersectRanges(planRanges, markedR);
      const coveredMin = rangeMinutes(covered);

      // Jornada corrida de lugar: nada del plan cubierto, o casi nada y trabajó
      if (coveredMin === 0 || (coveredMin < planMin / 2 && workedMin >= planMin / 2)) {
        warn({
          date, code: 'worked_other_hours', blocking: true,
          context: { plan, marked, excessHours: (workedMin - coveredMin) / 60 },
          detail: `Marcó ${fmtBlocks(marked)} y el plan era ${fmtBlocks(plan)}`,
        });
        // Las horas autorizadas se siguen evaluando, pero el día ya bloquea
        payOvertime(planRanges, true, 'regular');
        finish('needs_review', regular);
        continue;
      }

      // Tramo por tramo: los agentes marcan cada uno, así que el ingreso y el
      // egreso se miden contra el tramo, no contra el día entero
      const split = plan.length > 1;
      const enTramo = (b: TimeBlock) => (split ? ` al tramo ${b.start_time}–${b.end_time}` : '');
      let anyCovered = false;
      for (let i = 0; i < plan.length; i++) {
        const b = plan[i];
        const B = blockToRange(b);
        const cov = intersectRanges([B], markedR);

        if (cov.length === 0) {
          const code: WarningCode = anyCovered ? 'left_early' : 'arrived_late';
          warn({
            date, code, blocking: true,
            context: { plan, marked, missedBlock: b, [anyCovered ? 'earlyMinutes' : 'lateMinutes']: B[1] - B[0] },
            detail: `No marcó el tramo ${b.start_time}–${b.end_time}: marcó ${fmtBlocks(marked)}`,
          });
          blocking = true;
          continue;
        }
        anyCovered = true;

        const late = cov[0][0] - B[0];
        const early = B[1] - cov[cov.length - 1][1];
        const gap = B[1] - B[0] - rangeMinutes(cov) - late - early;

        if (late > m.lateArrivalMinutes) {
          warn({
            date, code: 'arrived_late', blocking: true,
            context: { plan, marked, lateMinutes: late },
            detail: `Llegó ${fmtMin(late)} tarde${enTramo(b)}: marcó ${fmtBlocks(marked)}, el plan era ${fmtBlocks(plan)}`,
          });
          blocking = true;
        }
        if (early > m.earlyDepartureMinutes || gap > m.earlyDepartureMinutes) {
          const detail = early > m.earlyDepartureMinutes
            ? `Se fue ${fmtMin(early)} antes${split ? ` del tramo ${b.start_time}–${b.end_time}` : ''}`
            : `Se ausentó ${fmtMin(gap)} en medio del tramo ${b.start_time}–${b.end_time}`;
          warn({
            date, code: 'left_early', blocking: true,
            context: { plan, marked, earlyMinutes: Math.max(early, gap) },
            detail: `${detail}: marcó ${fmtBlocks(marked)}, el plan era ${fmtBlocks(plan)}`,
          });
          blocking = true;
        }
      }
    }

    const ot = payOvertime(planRanges, false, 'regular');
    blocking ||= ot.blocking;

    finish(blocking ? 'needs_review' : unverified ? 'unverified' : 'auto', regular);
  }

  return {
    lines: mergeDailyLines(lines),
    unworkedHolidayHours,
    vacationHours,
    absenceDates,
    overtimeOutcomes: overtimeOutcomes.sort((a, b) => a.date.localeCompare(b.date)),
    warnings: warnings.sort((a, b) => a.date.localeCompare(b.date)),
    days: results,
  };
}

/**
 * El desglose de horas, sin los avisos. Es `settleDays` con la interfaz de
 * antes, para quien sólo necesita las líneas.
 */
export function buildDailyLines(input: SettleDaysInput): BuildDailyLinesResult {
  const { lines, unworkedHolidayHours, vacationHours, absenceDates, overtimeOutcomes } = settleDays(input);
  return { lines, unworkedHolidayHours, vacationHours, absenceDates, overtimeOutcomes };
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

/**
 * Sólo los avisos que salen de contrastar el plan contra las marcaciones, sin
 * horas autorizadas. Se conserva por compatibilidad con quien lo usaba así.
 */
export function compareAgainstClockIns(
  days: DayContext[],
  schedulesByDate: (date: string) => ScheduleSlot[],
  observations: Map<string, ClockObservation>,
  margins?: Partial<NormalizationMargins>
): SettlementWarning[] {
  return settleDays({ days, schedulesByDate, overtime: [], observations, margins }).warnings;
}

/**
 * Qué avisar según lo que pasó con las horas cargadas. `settleDays` ya lo hace
 * día por día; esto queda para revisar resultados sueltos.
 */
export function reviewOvertimeOutcomes(
  outcomes: OvertimeOutcome[],
  thresholdHours: number = ADDITIONAL_THRESHOLD_HOURS
): SettlementWarning[] {
  const warnings: SettlementWarning[] = [];

  for (const o of outcomes) {
    const uncovered = o.excessHours - o.paidHours;

    if (uncovered > thresholdHours) {
      warnings.push({
        date: o.date,
        code: 'worked_more_than_schedule',
        blocking: true,
        detail:
          o.loadedHours > 0
            ? `Trabajó ${fmtH(o.excessHours)} fuera del esquema y sólo se cargaron ` +
              `${fmtH(o.loadedHours)}: quedan ${fmtH(uncovered)} sin autorizar`
            : `Trabajó ${fmtH(o.excessHours)} fuera del esquema sin horas cargadas`,
      });
    }

    if (o.loadedHours > 0 && o.excessHours <= thresholdHours) {
      warnings.push({
        date: o.date,
        code: 'additional_without_excess',
        blocking: false,
        detail:
          `Se cargaron ${fmtH(o.loadedHours)} pero el excedente trabajado fue de ` +
          `${fmtH(o.excessHours)}: no se liquidan`,
      });
    }

    if (o.excessHours > thresholdHours && o.loadedHours > o.paidHours + 0.0001) {
      warnings.push({
        date: o.date,
        code: 'additional_over_worked',
        blocking: false,
        detail:
          `Se cargaron ${fmtH(o.loadedHours)} y el excedente fue de ${fmtH(o.excessHours)}: ` +
          `se pagan ${fmtH(o.paidHours)}`,
      });
    }
  }

  return warnings;
}

// ─── Sugerencia de resolución ───────────────────────────────────────

/**
 * Las acciones con que se normaliza un día. Las tres primeras son correcciones;
 * las dos últimas actúan sobre las horas autorizadas.
 */
export type ResolutionAction =
  | 'plan'            // está bien así: se paga lo planificado
  | 'marks'           // se paga lo marcado
  | 'custom'          // se paga un horario que carga el supervisor
  | 'none'            // no se paga
  | 'authorize'       // autorizar las horas de más
  | 'pay_authorized'; // pagar lo autorizado aunque la marcación no lo respalde

export interface SuggestedResolution {
  action: ResolutionAction;
  hours?: number;
  tier?: Tier;
  reason: string;
}

/**
 * La resolución más probable para un día que hay que normalizar.
 *
 * Sale de lo que hizo el liquidador en julio y agosto 2026: en los días de
 * agentes con antigüedad que no cerraban contra el esquema, pagó el plan en 8
 * de cada 10. La sugerencia no se aplica sola —pagar mal es justo lo que se
 * quiere evitar— pero convierte la bandeja en una lista para revisar y
 * confirmar, en lugar de una lista para resolver de a uno.
 *
 * Donde no hay un patrón claro —agentes nuevos, feriados, licencias— no se
 * sugiere nada: ahí la decisión tiene que ser de una persona.
 */
export function suggestResolution(
  day: DayResult,
  dayWarnings: SettlementWarning[]
): SuggestedResolution | null {
  if (day.status !== 'needs_review' || day.newHire) return null;

  const codes = new Set(dayWarnings.filter((w) => w.blocking).map((w) => w.code));
  if (codes.size === 0) return null;

  const horas = (bs: TimeBlock[]) => rangeMinutes(unionRanges(bs.map(blockToRange))) / 60;

  if ([...codes].every((c) => c === 'additional_without_excess' || c === 'additional_over_worked')) {
    return {
      action: 'pay_authorized',
      reason: 'Suele ser un arrastre del mes anterior o una marcación mal hecha',
    };
  }

  if (codes.size === 1 && codes.has('worked_other_hours')) {
    // Mismas horas en otro horario: se paga lo marcado, cada hora en su banda
    if (Math.abs(horas(day.marked) - horas(day.plan)) <= 0.5) {
      return {
        action: 'marks',
        reason: 'Trabajó las mismas horas en otro horario: se paga lo marcado, cada hora en su banda',
      };
    }
    return { action: 'plan', reason: 'Lo marcado no alcanza a ser una jornada: suele ser una marcación mal hecha' };
  }

  if ([...codes].every((c) => c === 'worked_more_than_schedule' || c === 'arrived_late' || c === 'left_early')) {
    // Un tramo entero sin marcar no es un desvío chico: se sugiere lo mismo
    // —en julio y agosto se pagó el plan en esos casos— pero avisando qué mirar
    const faltaTramo = dayWarnings.some((w) => w.blocking && w.context?.missedBlock);
    return faltaTramo
      ? { action: 'plan', reason: 'Lo habitual es pagar el plan aunque falte marcar un tramo. Si ese tramo no se trabajó, va "Pagar lo marcado"' }
      : { action: 'plan', reason: 'Lo habitual: el desvío no cambia lo que se paga' };
  }

  return null;
}

/**
 * Los tramos que conviene pagar si se decide "pagar lo marcado": la marcación
 * tal cual, sin redondear.
 */
export function blocksFromObservation(obs: ClockObservation | undefined): TimeBlock[] {
  return markedRanges(obs).map(rangeToBlock);
}

export function minutesToTime(minutes: number): string {
  const normalized = ((minutes % MIN_24) + MIN_24) % MIN_24;
  const h = Math.floor(normalized / 60);
  const mm = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
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

/**
 * El mes que toca cerrar: el último período que ya terminó. Con corte el día 1
 * es el mes anterior; con corte el 21, el período "octubre" termina el 20 de
 * octubre, así que desde el 21 lo que toca cerrar es octubre.
 */
export function periodToClose(today: string, startDay: number): { year: number; month: number } {
  const [y, m, d] = today.split('-').map(Number);
  if (startDay > 1 && d >= startDay) return { year: y, month: m };
  return m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 };
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
