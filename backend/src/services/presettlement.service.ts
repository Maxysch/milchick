import { supabaseAdmin } from '../config/supabase.js';
import { localToday } from '../config/time.js';
import {
  computeAdjustments,
  computeConcepts,
  computeItemAmount,
  computeRate,
  roundCents,
  settleDays,
  settlementPeriod,
  suggestResolution,
  timeToMinutes,
  DEFAULT_MARGINS,
  DEFAULT_RATE_FACTORS,
  DEFAULT_SETTLEMENT_PARAMS,
  type Band,
  type ClockObservation,
  type CorrectionLine,
  type CorrectionResolution,
  type DailyLine,
  type DayContext,
  type DayCorrection,
  type DayExceptionType,
  type DayResult,
  type ItemKind,
  type NormalizationMargins,
  type OvertimeRecord,
  type RateFactors,
  type ScheduleSlot,
  type SettlementParams,
  type SettlementWarning,
  type SettleDaysResult,
  type SuggestedResolution,
  type Tier,
  type TimeBlock,
} from './settlement-calc.js';

export { settlementPeriod };

// ─── Tipos ──────────────────────────────────────────────────────────

interface AgentRate {
  amount_per_hour: number;
  effective_from: string;
}

interface ScheduleRow extends ScheduleSlot {
  effective_from: string;
  effective_until: string | null;
}

interface PersistedDailyLine {
  date: string;
  band: string;
  tier: string;
  hours: number;
  rate_per_hour: number;
  amount: number;
  is_projected: boolean;
  client_id: string | null;
  source: string;
}

interface SettlementItem {
  concept: string;
  description: string | null;
  amount: number;
  is_percentage: boolean;
  percentage_base: string | null;
  /** Forma de cálculo: los percentage y hourly se recomponen solos */
  kind?: ItemKind;
  percentage?: number | null;
  quantity?: number | null;
  band?: Band | null;
  tier?: Tier | null;
  factor?: number | null;
  unit_minutes?: number | null;
  days?: number | null;
}

/** Un aviso con la resolución que se sugiere para su día. */
export interface ComputedWarning extends SettlementWarning {
  suggestion: SuggestedResolution | null;
}

/** Lo que se le muestra a un error de negocio, no de sistema. */
export class BusinessError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
    this.name = 'BusinessError';
  }
}

/** Conceptos que calcula el motor, en el orden en que se muestran. */
export const CONCEPT_ORDER = [
  'reg',
  'super_reg',
  'seniority',
  'equipment',
  'holiday_compensation',
  'vacation_plus',
  'monotributo',
] as const;

const AUTO_CONCEPTS = new Set<string>(CONCEPT_ORDER);

// ─── Utilidades ─────────────────────────────────────────────────────

/** Tarifa vigente a la fecha: la más reciente con `effective_from` anterior o igual. */
function findBaseRate(rates: AgentRate[], date: string): number {
  const matching = rates
    .filter((r) => r.effective_from <= date)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  return Number(matching[0]?.amount_per_hour ?? 0);
}

function enumerateDates(from: string, to: string): string[] {
  const dates: string[] = [];
  const current = new Date(from + 'T12:00:00Z');
  const end = new Date(to + 'T12:00:00Z');
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

/** Día de la semana en convención JS (0 = domingo), que es la que usa `schedules`. */
function jsDayOfWeek(date: string): number {
  return new Date(date + 'T12:00:00').getDay();
}

// Hoy en Buenos Aires: desde hoy en adelante los días son proyectados
const todayIso = () => localToday();
const hhmm = (t: string) => t.slice(0, 5);

// ─── Configuración ──────────────────────────────────────────────────

async function fetchRateFactors(): Promise<RateFactors> {
  const { data } = await supabaseAdmin.from('rate_factors').select('factor_key, factor_value');
  const factors: RateFactors = { ...DEFAULT_RATE_FACTORS };
  for (const f of (data ?? []) as { factor_key: string; factor_value: number }[]) {
    if (f.factor_key in factors) {
      factors[f.factor_key as keyof RateFactors] = Number(f.factor_value);
    }
  }
  return factors;
}

/**
 * Parámetros con los que se liquida un período.
 *
 * El REG y el SUPER REG dependen de cómo performó el agente ese mes, así que se
 * leen de `agent_period_params`. El resto (equipos, antigüedad, factores) es
 * estable y vive en el perfil.
 *
 * `periodParamsLoaded` dice si alguien cargó la evaluación de ese mes. Si no, se
 * usan los valores por defecto del perfil, y la preliquidación no se puede
 * confirmar hasta que se cargue: liquidar con el REG del mes pasado es un error
 * silencioso.
 */
async function fetchSettlementParams(
  profileId: string,
  periodTo: string
): Promise<{ params: SettlementParams; periodParamsLoaded: boolean }> {
  const [year, month] = periodTo.split('-').map(Number);

  const [{ data: profileRaw }, { data: periodRaw }] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select(
        'reg_people_pct, reg_quantitative_pct, reg_qualitative_pct, super_reg_pct, ' +
          'equipment_pct, seniority_months, holiday_compensation_factor, vacation_plus_factor'
      )
      .eq('id', profileId)
      .single(),
    supabaseAdmin
      .from('agent_period_params')
      .select(
        'reg_people_pct, reg_quantitative_pct, reg_qualitative_pct, super_reg_pct, ' +
          'monotributo_reimbursement'
      )
      .eq('profile_id', profileId)
      .eq('year', year)
      .eq('month', month)
      .maybeSingle(),
  ]);

  const profile = profileRaw as Record<keyof SettlementParams, number | null> | null;
  if (!profile) {
    return { params: { ...DEFAULT_SETTLEMENT_PARAMS }, periodParamsLoaded: false };
  }

  const period = periodRaw as Record<string, number | null> | null;
  const perf = period ?? profile;

  return {
    params: {
      reg_people_pct: Number(perf.reg_people_pct ?? 0),
      reg_quantitative_pct: Number(perf.reg_quantitative_pct ?? 0),
      reg_qualitative_pct: Number(perf.reg_qualitative_pct ?? 0),
      super_reg_pct: Number(perf.super_reg_pct ?? 0),
      equipment_pct: Number(profile.equipment_pct ?? 0),
      seniority_months: Number(profile.seniority_months ?? 0),
      holiday_compensation_factor: Number(profile.holiday_compensation_factor ?? 0),
      vacation_plus_factor: Number(profile.vacation_plus_factor ?? 0),
      // Sólo existe a nivel período: no tiene valor por defecto en el perfil
      monotributo_reimbursement: Number(period?.monotributo_reimbursement ?? 0),
    },
    periodParamsLoaded: period !== null,
  };
}

/**
 * Excedente mínimo, en horas, para que las horas autorizadas se liquiden. Por
 * debajo de eso unos minutos de más no habilitan una hora entera.
 */
export async function fetchAdditionalThreshold(): Promise<number> {
  return (await fetchMargins()).additionalThresholdMinutes / 60;
}

/** Día de inicio del período de liquidación. 1 = mes calendario. */
export async function fetchPeriodStartDay(): Promise<number> {
  const { data } = await supabaseAdmin
    .from('settlement_settings')
    .select('period_start_day')
    .limit(1)
    .maybeSingle();
  return Number(data?.period_start_day ?? 1);
}

/** Cuándo un día se paga solo y cuándo hay que normalizarlo. */
export async function fetchMargins(): Promise<NormalizationMargins> {
  const { data } = await supabaseAdmin.from('settlement_settings').select('*').limit(1).maybeSingle();
  const s = (data ?? {}) as Record<string, unknown>;
  const num = (k: string, d: number) => (s[k] === undefined || s[k] === null ? d : Number(s[k]));
  const bool = (k: string, d: boolean) => (s[k] === undefined || s[k] === null ? d : Boolean(s[k]));
  return {
    lateArrivalMinutes: num('late_arrival_margin_minutes', DEFAULT_MARGINS.lateArrivalMinutes),
    earlyDepartureMinutes: num('early_departure_margin_minutes', DEFAULT_MARGINS.earlyDepartureMinutes),
    additionalThresholdMinutes: num('additional_threshold_minutes', DEFAULT_MARGINS.additionalThresholdMinutes),
    missingClockBlocks: bool('missing_clock_blocks', DEFAULT_MARGINS.missingClockBlocks),
    incompleteClockBlocks: bool('incomplete_clock_blocks', DEFAULT_MARGINS.incompleteClockBlocks),
    newHireReviewDays: num('new_hire_review_days', DEFAULT_MARGINS.newHireReviewDays),
  };
}

// ─── Entradas de un agente ──────────────────────────────────────────

/**
 * Cuando un mismo día tiene más de una excepción, manda la que más cambia lo
 * que se paga. El horario, si lo hay, sale de las del tipo elegido.
 */
const EXCEPTION_PRIORITY: DayExceptionType[] = [
  'absence', 'vacation', 'paid_leave', 'extraordinary_coverage', 'schedule_change',
];

export interface AgentInputs {
  profile: {
    id: string;
    first_name: string;
    last_name: string;
    hire_date: string | null;
    daily_compensation_minutes: number;
    daily_compensation_band: Band;
  };
  days: DayContext[];
  schedulesByDate: (date: string) => ScheduleSlot[];
  overtime: (OvertimeRecord & { id: string })[];
  observations: Map<string, ClockObservation>;
  corrections: Map<string, DayCorrection & { id: string; effects: Record<string, unknown> | null }>;
  margins: NormalizationMargins;
}

/** Todo lo que el cálculo necesita saber de un agente en un rango de fechas. */
export async function loadAgentInputs(profileId: string, from: string, to: string): Promise<AgentInputs> {
  const [
    { data: profileRaw, error: profileError },
    { data: schedulesRaw },
    { data: exceptionsRaw },
    { data: holidaysRaw },
    { data: overtimeRaw },
    { data: clockRaw },
    { data: correctionsRaw },
    margins,
  ] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('id, first_name, last_name, hire_date, daily_compensation_minutes, daily_compensation_band')
      .eq('id', profileId)
      .single(),
    supabaseAdmin
      .from('schedules')
      .select('day_of_week, start_time, end_time, client_id, effective_from, effective_until')
      .eq('profile_id', profileId)
      .lte('effective_from', to)
      .or(`effective_until.is.null,effective_until.gte.${from}`)
      .order('start_time'),
    supabaseAdmin
      .from('exceptions')
      .select('exception_type, date_from, date_to, blocks, client_id')
      .eq('profile_id', profileId)
      .lte('date_from', to)
      .gte('date_to', from),
    supabaseAdmin.from('holidays').select('date').gte('date', from).lte('date', to),
    supabaseAdmin
      .from('overtime')
      .select('id, date, hours, start_time, end_time, tier, client_id, uncapped')
      .eq('profile_id', profileId)
      .gte('date', from)
      .lte('date', to),
    supabaseAdmin
      .from('clock_entries')
      .select('date, clock_in, clock_out')
      .eq('profile_id', profileId)
      .gte('date', from)
      .lte('date', to)
      .order('date')
      .order('clock_in'),
    supabaseAdmin
      .from('day_corrections')
      .select('id, date, resolution, blocks, lines, client_id, effects')
      .eq('profile_id', profileId)
      .gte('date', from)
      .lte('date', to),
    fetchMargins(),
  ]);

  if (profileError || !profileRaw) throw new Error(`Agente no encontrado: ${profileError?.message ?? profileId}`);
  const p = profileRaw as Record<string, unknown>;

  const schedules = ((schedulesRaw ?? []) as ScheduleRow[]).map((s) => ({
    ...s,
    start_time: hhmm(s.start_time),
    end_time: hhmm(s.end_time),
  }));
  const schedulesByDate = (date: string): ScheduleSlot[] =>
    schedules.filter(
      (s) =>
        s.day_of_week === jsDayOfWeek(date) &&
        s.effective_from <= date &&
        (s.effective_until === null || s.effective_until >= date)
    );

  const holidays = new Set(((holidaysRaw ?? []) as { date: string }[]).map((h) => h.date));

  // Excepciones expandidas por fecha
  type Ex = { exception_type: DayExceptionType; date_from: string; date_to: string; blocks: TimeBlock[] | null; client_id: string | null };
  const exByDate = new Map<string, Ex[]>();
  for (const e of (exceptionsRaw ?? []) as Ex[]) {
    for (const d of enumerateDates(e.date_from > from ? e.date_from : from, e.date_to < to ? e.date_to : to)) {
      exByDate.set(d, [...(exByDate.get(d) ?? []), e]);
    }
  }

  const days: DayContext[] = enumerateDates(from, to).map((date) => {
    const exs = exByDate.get(date) ?? [];
    const type = EXCEPTION_PRIORITY.find((t) => exs.some((e) => e.exception_type === t)) ?? null;
    const ofType = exs.filter((e) => e.exception_type === type);
    const blocks = ofType.flatMap((e) => e.blocks ?? []);
    return {
      date,
      isHoliday: holidays.has(date),
      exception: type,
      exceptionBlocks: blocks.length ? blocks : null,
      exceptionClientId: ofType.find((e) => e.client_id)?.client_id ?? null,
    };
  });

  const overtime = ((overtimeRaw ?? []) as (OvertimeRecord & { id: string })[]).map((ot) => ({
    ...ot,
    hours: Number(ot.hours),
    start_time: ot.start_time ? hhmm(ot.start_time) : null,
    end_time: ot.end_time ? hhmm(ot.end_time) : null,
    uncapped: Boolean(ot.uncapped),
  }));

  // Cada fila de clock_entries es un tramo marcado. Una fila sin egreso deja el
  // día incompleto: no se sabe hasta cuándo trabajó.
  const observations = new Map<string, ClockObservation>();
  for (const ce of (clockRaw ?? []) as { date: string; clock_in: string; clock_out: string | null }[]) {
    const obs = observations.get(ce.date) ?? {
      date: ce.date, clockIn: null, clockOut: null, clockedHours: null, segments: [], incomplete: false,
    };
    obs.clockIn ??= hhmm(ce.clock_in);
    if (ce.clock_out) {
      // Entrada y salida en el mismo minuto es un doble toque: no suma horas
      const span = ((timeToMinutes(ce.clock_out) - timeToMinutes(ce.clock_in) + 1440) % 1440) / 60;
      obs.segments!.push({ clockIn: hhmm(ce.clock_in), clockOut: hhmm(ce.clock_out) });
      obs.clockOut = hhmm(ce.clock_out);
      obs.clockedHours = (obs.clockedHours ?? 0) + span;
    } else {
      obs.incomplete = true;
    }
    observations.set(ce.date, obs);
  }

  const corrections = new Map<string, DayCorrection & { id: string; effects: Record<string, unknown> | null }>();
  for (const c of (correctionsRaw ?? []) as Record<string, unknown>[]) {
    corrections.set(c.date as string, {
      id: c.id as string,
      date: c.date as string,
      resolution: c.resolution as CorrectionResolution,
      blocks: (c.blocks as TimeBlock[] | null) ?? null,
      lines: ((c.lines as CorrectionLine[] | null) ?? null)?.map((l) => ({ ...l, hours: Number(l.hours) })) ?? null,
      client_id: (c.client_id as string | null) ?? null,
      effects: (c.effects as Record<string, unknown> | null) ?? null,
    });
  }

  return {
    profile: {
      id: p.id as string,
      first_name: p.first_name as string,
      last_name: p.last_name as string,
      hire_date: (p.hire_date as string | null) ?? null,
      daily_compensation_minutes: Number(p.daily_compensation_minutes ?? 0),
      daily_compensation_band: ((p.daily_compensation_band as Band | null) ?? 'day_ld'),
    },
    days,
    schedulesByDate,
    overtime,
    observations,
    corrections,
    margins,
  };
}

/** Corre el motor con las entradas de un agente. */
export function settleInputs(inputs: AgentInputs, today: string = todayIso()): SettleDaysResult {
  return settleDays({
    days: inputs.days,
    schedulesByDate: inputs.schedulesByDate,
    overtime: inputs.overtime,
    observations: inputs.observations,
    corrections: inputs.corrections,
    margins: inputs.margins,
    hireDate: inputs.profile.hire_date,
    compensation:
      inputs.profile.daily_compensation_minutes > 0
        ? { minutes: inputs.profile.daily_compensation_minutes, band: inputs.profile.daily_compensation_band }
        : null,
    today,
  });
}

// ─── Cálculo ────────────────────────────────────────────────────────

/**
 * Conciliación del período anterior.
 *
 * La liquidación se prepara antes de que termine el mes, así que los últimos
 * días se pagaron proyectados desde el esquema. Si después la realidad fue otra
 * —una ausencia, una licencia cargada tarde, un día normalizado distinto— la
 * diferencia se arrastra acá en vez de tocar una liquidación ya cerrada.
 *
 * Saltea los días que se editaron en la tabla antes de que existieran las
 * correcciones: ahí la decisión está en la línea, no en un dato de entrada.
 */
async function buildPreviousPeriodAdjustments(profileId: string, periodFrom: string): Promise<DailyLine[]> {
  const { data: previousRaw } = await supabaseAdmin
    .from('pre_settlements')
    .select('id, period_from, period_to, created_at, recalculated_at')
    .eq('profile_id', profileId)
    .lt('period_to', periodFrom)
    .eq('status', 'confirmed')
    .order('period_to', { ascending: false })
    .limit(1)
    .maybeSingle();

  const previous = previousRaw as
    | { id: string; period_from: string; period_to: string; created_at: string; recalculated_at: string | null }
    | null;
  if (!previous) return [];

  const { data: linesRaw } = await supabaseAdmin
    .from('pre_settlement_daily')
    .select('date, band, tier, hours, client_id, source, is_projected')
    .eq('pre_settlement_id', previous.id);

  const paidLines = (linesRaw ?? []) as {
    date: string; band: Band; tier: Tier; hours: number; client_id: string | null; source: string; is_projected: boolean;
  }[];

  const projectedDates = [
    ...new Set(paidLines.filter((l) => l.source !== 'adjustment' && l.is_projected).map((l) => l.date)),
  ].sort();
  if (projectedDates.length === 0) return [];

  const editedByHand = new Set(paidLines.filter((l) => l.source === 'manual').map((l) => l.date));
  const toCheck = projectedDates.filter((d) => !editedByHand.has(d));
  if (toCheck.length === 0) return [];

  const inputs = await loadAgentInputs(profileId, toCheck[0], toCheck[toCheck.length - 1]);
  const { lines } = settleInputs(inputs);
  return computeAdjustments(paidLines, lines, toCheck);
}

export interface Computation {
  dailyLines: PersistedDailyLine[];
  conceptItems: SettlementItem[];
  warnings: ComputedWarning[];
  days: DayResult[];
  subtotal: number;
}

/**
 * Calcula la preliquidación de un agente para un período, sin escribir nada.
 *
 * Las horas salen del esquema —o del horario de la excepción, o de la
 * corrección del supervisor— y las marcaciones contrastan. Los días que no
 * cierran quedan con avisos que bloquean y una resolución sugerida.
 */
export async function computePreSettlement(
  profileId: string,
  periodFrom: string,
  periodTo: string
): Promise<Computation> {
  const [inputs, { data: ratesRaw }, factors, settlementParams, adjustments] = await Promise.all([
    loadAgentInputs(profileId, periodFrom, periodTo),
    supabaseAdmin
      .from('agent_rates')
      .select('amount_per_hour, effective_from')
      .eq('profile_id', profileId)
      .order('effective_from', { ascending: false }),
    fetchRateFactors(),
    fetchSettlementParams(profileId, periodTo),
    buildPreviousPeriodAdjustments(profileId, periodFrom),
  ]);

  const agentRates = (ratesRaw as AgentRate[]) ?? [];
  const { params, periodParamsLoaded } = settlementParams;
  const today = todayIso();
  const result = settleInputs(inputs, today);

  const dailyLines: PersistedDailyLine[] = [...result.lines, ...adjustments].map((line) => {
    const rate = computeRate(findBaseRate(agentRates, line.date), line.band, line.tier, factors);
    return {
      date: line.date,
      band: line.band,
      tier: line.tier,
      hours: line.hours,
      rate_per_hour: rate,
      amount: line.hours * rate,
      // Proyectado = todavía no ocurrió (o está ocurriendo). Se concilia el mes
      // que viene si la realidad terminó siendo otra.
      is_projected: line.source !== 'adjustment' && line.date >= today,
      client_id: line.client_id,
      source: line.source,
    };
  });

  const subtotal = dailyLines.reduce((sum, l) => sum + l.amount, 0);

  const concepts = computeConcepts({
    subtotal,
    baseRate: findBaseRate(agentRates, periodTo),
    unworkedHolidayHours: result.unworkedHolidayHours,
    vacationHours: result.vacationHours,
    params,
  });

  const conceptItems: SettlementItem[] = concepts.map((c) => ({
    concept: c.concept,
    description: `${c.description} (${c.basis})`,
    amount: roundCents(c.amount),
    is_percentage: c.kind === 'percentage',
    percentage_base: c.kind === 'percentage' ? 'subtotal' : null,
    kind: c.kind,
    percentage: c.percentage ?? null,
    quantity: c.quantity ?? null,
    band: c.band ?? null,
    tier: c.tier ?? null,
    factor: c.factor ?? null,
  }));

  // La sugerencia es por día: todos los avisos que bloquean ese día la comparten
  const byDate = new Map<string, SettlementWarning[]>();
  for (const w of result.warnings) byDate.set(w.date, [...(byDate.get(w.date) ?? []), w]);
  const suggestionByDate = new Map<string, SuggestedResolution | null>();
  for (const d of result.days) {
    if (d.status === 'needs_review') suggestionByDate.set(d.date, suggestResolution(d, byDate.get(d.date) ?? []));
  }

  const warnings: ComputedWarning[] = result.warnings.map((w) => ({
    ...w,
    blocking: !!w.blocking,
    suggestion: w.blocking ? suggestionByDate.get(w.date) ?? null : null,
  }));

  for (const date of result.absenceDates) {
    warnings.push({
      date, code: 'absence', blocking: false, suggestion: null,
      detail: 'Ausencia registrada: no se liquidan horas',
    });
  }

  // El REG depende de la performance del mes. Sin la evaluación cargada, se
  // liquidaría con el valor por defecto del perfil: no se deja confirmar así.
  if (!periodParamsLoaded) {
    warnings.push({
      date: periodTo,
      code: 'missing_period_params',
      blocking: true,
      suggestion: null,
      detail:
        'Falta la evaluación mensual: el REG y el SUPER REG salieron del valor por defecto ' +
        'del agente. Cargala en Evaluación mensual.',
    });
  }

  return { dailyLines, conceptItems, warnings, days: result.days, subtotal };
}

// ─── Persistencia ───────────────────────────────────────────────────

/**
 * Escribe un cálculo sobre una preliquidación existente.
 *
 * Reemplaza las líneas, los conceptos automáticos y los avisos. Conserva los
 * ítems cargados a mano y la revisión de los avisos informativos. Los que
 * bloquean no se conservan: se resuelven normalizando el día, y si el día quedó
 * resuelto, el aviso ya no aparece.
 */
async function writeComputation(preSettlementId: string, comp: Computation) {
  const { data: prevWarnings } = await supabaseAdmin
    .from('pre_settlement_warnings')
    .select('date, code, status, note, reviewed_by, reviewed_at')
    .eq('pre_settlement_id', preSettlementId)
    .eq('blocking', false)
    .neq('status', 'pending');
  const reviewed = new Map(
    ((prevWarnings ?? []) as Record<string, unknown>[]).map((w) => [`${w.date}|${w.code}`, w])
  );

  const del = await Promise.all([
    supabaseAdmin.from('pre_settlement_daily').delete().eq('pre_settlement_id', preSettlementId),
    supabaseAdmin
      .from('pre_settlement_items')
      .delete()
      .eq('pre_settlement_id', preSettlementId)
      .in('concept', [...AUTO_CONCEPTS]),
    supabaseAdmin.from('pre_settlement_warnings').delete().eq('pre_settlement_id', preSettlementId),
  ]);
  for (const r of del) if (r.error) throw new Error(`No se pudo recalcular: ${r.error.message}`);

  if (comp.dailyLines.length > 0) {
    const { error } = await supabaseAdmin
      .from('pre_settlement_daily')
      .insert(comp.dailyLines.map((l) => ({ ...l, pre_settlement_id: preSettlementId })));
    if (error) throw new Error(`No se pudieron guardar las líneas: ${error.message}`);
  }

  if (comp.conceptItems.length > 0) {
    const { error } = await supabaseAdmin
      .from('pre_settlement_items')
      .insert(comp.conceptItems.map((i) => ({ ...i, pre_settlement_id: preSettlementId })));
    if (error) throw new Error(`No se pudieron guardar los conceptos: ${error.message}`);
  }

  if (comp.warnings.length > 0) {
    const { error } = await supabaseAdmin.from('pre_settlement_warnings').insert(
      comp.warnings.map((w) => {
        const prev = w.blocking ? undefined : reviewed.get(`${w.date}|${w.code}`);
        return {
          pre_settlement_id: preSettlementId,
          date: w.date,
          code: w.code,
          detail: w.detail,
          blocking: !!w.blocking,
          context: w.context ?? null,
          suggestion: w.suggestion ?? null,
          status: (prev?.status as string) ?? 'pending',
          note: (prev?.note as string | null) ?? null,
          reviewed_by: (prev?.reviewed_by as string | null) ?? null,
          reviewed_at: (prev?.reviewed_at as string | null) ?? null,
        };
      })
    );
    if (error) throw new Error(`No se pudieron guardar los avisos: ${error.message}`);
  }

  await supabaseAdmin
    .from('pre_settlements')
    .update({ day_summary: comp.days, recalculated_at: new Date().toISOString() })
    .eq('id', preSettlementId);

  await recalculateTotal(preSettlementId);
}

/**
 * Las correcciones de antes vivían en las líneas: se editaban las horas en la
 * tabla y la línea pasaba a `source = 'manual'`. Recalcular las borraría. La
 * primera vez que se recalcula una preliquidación así, cada día editado se
 * convierte en una corrección —las horas quedan exactamente como estaban— y a
 * partir de ahí es un dato de entrada más.
 */
async function migrateLegacyManualLines(ps: { id: string; profile_id: string; created_by: string }) {
  const { data: manual } = await supabaseAdmin
    .from('pre_settlement_daily')
    .select('date')
    .eq('pre_settlement_id', ps.id)
    .eq('source', 'manual');
  const dates = [...new Set(((manual ?? []) as { date: string }[]).map((l) => l.date))];
  if (dates.length === 0) return;

  const { data: existing } = await supabaseAdmin
    .from('day_corrections')
    .select('date')
    .eq('profile_id', ps.profile_id)
    .in('date', dates);
  const already = new Set(((existing ?? []) as { date: string }[]).map((c) => c.date));

  for (const date of dates.filter((d) => !already.has(d))) {
    const { data: lines } = await supabaseAdmin
      .from('pre_settlement_daily')
      .select('band, tier, hours, source')
      .eq('pre_settlement_id', ps.id)
      .eq('date', date)
      .neq('source', 'adjustment');
    await supabaseAdmin.from('day_corrections').insert({
      profile_id: ps.profile_id,
      date,
      resolution: 'manual',
      lines: ((lines ?? []) as Record<string, unknown>[]).map((l) => ({
        band: l.band, tier: l.tier, hours: Number(l.hours),
      })),
      note: 'Corrección hecha en la tabla antes de que existiera la normalización',
      created_by: ps.created_by,
    });
  }
}

/** Recalcula una preliquidación en el lugar. Sólo mientras es borrador. */
export async function recalculatePreSettlement(preSettlementId: string): Promise<void> {
  const { data: ps, error } = await supabaseAdmin
    .from('pre_settlements')
    .select('id, profile_id, period_from, period_to, status, created_by')
    .eq('id', preSettlementId)
    .single();
  if (error || !ps) throw new Error(`Preliquidación no encontrada: ${error?.message ?? preSettlementId}`);
  if (ps.status !== 'draft') {
    throw new BusinessError('Sólo se recalculan las preliquidaciones en borrador. Esta ya está ' +
      (ps.status === 'confirmed' ? 'confirmada' : 'cancelada') + '.');
  }

  await migrateLegacyManualLines(ps);
  const comp = await computePreSettlement(ps.profile_id, ps.period_from, ps.period_to);
  await writeComputation(ps.id, comp);
}

/**
 * Recalcula los borradores afectados por un cambio en los datos de entrada.
 *
 * Se llama después de cargar una excepción, una autorización, una corrección,
 * un esquema: así la preliquidación y la bandeja de normalización están siempre
 * al día sin que nadie tenga que acordarse de regenerar nada. Incluye los
 * borradores de períodos posteriores, que pueden arrastrar ajustes del día que
 * cambió.
 */
export async function refreshDrafts(filter: { profileId?: string; from?: string } = {}): Promise<number> {
  let query = supabaseAdmin.from('pre_settlements').select('id').eq('status', 'draft');
  if (filter.profileId) query = query.eq('profile_id', filter.profileId);
  if (filter.from) query = query.gte('period_to', filter.from);

  const { data } = await query;
  let n = 0;
  for (const { id } of (data ?? []) as { id: string }[]) {
    try {
      await recalculatePreSettlement(id);
      n++;
    } catch (err) {
      console.error(`No se pudo recalcular ${id}:`, (err as Error).message);
    }
  }
  return n;
}

/**
 * Genera la preliquidación de un agente para un período, o la actualiza si ya
 * hay un borrador. Nunca duplica: generar dos veces es recalcular.
 */
export async function generatePreSettlement(
  profileId: string,
  periodFrom: string,
  periodTo: string,
  createdBy: string
): Promise<{ preSettlement: Record<string, unknown>; created: boolean; blocking: number; warnings: number }> {
  const { data: existing } = await supabaseAdmin
    .from('pre_settlements')
    .select('id, status')
    .eq('profile_id', profileId)
    .eq('period_from', periodFrom)
    .eq('period_to', periodTo)
    .neq('status', 'cancelled')
    .maybeSingle();

  let id: string;
  let created = false;

  if (existing) {
    if (existing.status === 'confirmed') {
      throw new BusinessError('La preliquidación de este período ya está confirmada. Para cambiarla, volvela a borrador.');
    }
    id = existing.id as string;
    await recalculatePreSettlement(id);
  } else {
    const { data: ps, error } = await supabaseAdmin
      .from('pre_settlements')
      .insert({
        profile_id: profileId,
        period_from: periodFrom,
        period_to: periodTo,
        status: 'draft',
        total_amount: 0,
        created_by: createdBy,
      })
      .select('id')
      .single();
    if (error || !ps) throw new Error(`No se pudo crear la preliquidación: ${error?.message}`);
    id = ps.id as string;
    created = true;
    await writeComputation(id, await computePreSettlement(profileId, periodFrom, periodTo));
  }

  const [{ data: preSettlement }, counts] = await Promise.all([
    supabaseAdmin.from('pre_settlements').select('*').eq('id', id).single(),
    warningCounts(id),
  ]);
  return { preSettlement: preSettlement as Record<string, unknown>, created, ...counts };
}

async function warningCounts(preSettlementId: string) {
  const { data } = await supabaseAdmin
    .from('pre_settlement_warnings')
    .select('blocking, status')
    .eq('pre_settlement_id', preSettlementId);
  const rows = (data ?? []) as { blocking: boolean; status: string }[];
  return {
    blocking: rows.filter((w) => w.blocking && w.status === 'pending').length,
    warnings: rows.filter((w) => w.status === 'pending').length,
  };
}

// ─── Detalle ────────────────────────────────────────────────────────

/**
 * Preliquidación con todo el detalle: líneas diarias, ítems, qué pasó cada día,
 * los avisos con su resolución sugerida y las correcciones aplicadas.
 */
export async function getPreSettlementDetail(preSettlementId: string) {
  const { data: ps, error: psError } = await supabaseAdmin
    .from('pre_settlements')
    .select('*, profiles!pre_settlements_profile_id_fkey(first_name, last_name, employee_id, hire_date)')
    .eq('id', preSettlementId)
    .single();

  if (psError) throw new Error(psError.message);

  const [
    { data: daily },
    { data: items },
    { data: clockEntries },
    { data: warnings },
    { data: exceptions },
    { data: overtimeEntries },
    { data: corrections },
  ] = await Promise.all([
    supabaseAdmin
      .from('pre_settlement_daily')
      .select('*, clients(name), corrector:corrected_by(first_name, last_name)')
      .eq('pre_settlement_id', preSettlementId)
      .order('date'),
    supabaseAdmin.from('pre_settlement_items').select('*').eq('pre_settlement_id', preSettlementId).order('created_at'),
    supabaseAdmin
      .from('clock_entries')
      .select('date, clock_in, clock_out')
      .eq('profile_id', ps.profile_id)
      .gte('date', ps.period_from)
      .lte('date', ps.period_to)
      .order('date')
      .order('clock_in'),
    supabaseAdmin.from('pre_settlement_warnings').select('*').eq('pre_settlement_id', preSettlementId).order('date'),
    supabaseAdmin
      .from('exceptions')
      .select('exception_type, date_from, date_to, notes, blocks')
      .eq('profile_id', ps.profile_id)
      .lte('date_from', ps.period_to)
      .gte('date_to', ps.period_from),
    supabaseAdmin
      .from('overtime')
      .select('id, date, hours, tier, start_time, end_time, notes, uncapped')
      .eq('profile_id', ps.profile_id)
      .gte('date', ps.period_from)
      .lte('date', ps.period_to)
      .order('date'),
    supabaseAdmin
      .from('day_corrections')
      .select('*, creator:created_by(first_name, last_name)')
      .eq('profile_id', ps.profile_id)
      .gte('date', ps.period_from)
      .lte('date', ps.period_to),
  ]);

  // Dentro de un día, las líneas van de menor a mayor recargo y de la banda más
  // habitual a la menos
  const BAND_ORDER = ['day_ld', 'night_ld', 'day_hd', 'night_hd'];
  const TIER_ORDER = ['normal', 'additional', 'overtime_50', 'overtime_100'];
  const sortedDaily = [...(daily ?? [])].sort(
    (a, b) =>
      String(a.date).localeCompare(String(b.date)) ||
      TIER_ORDER.indexOf(String(a.tier)) - TIER_ORDER.indexOf(String(b.tier)) ||
      BAND_ORDER.indexOf(String(a.band)) - BAND_ORDER.indexOf(String(b.band))
  );

  const clockByDate: Record<string, { clock_in: string; clock_out: string | null }[]> = {};
  for (const ce of clockEntries ?? []) {
    (clockByDate[ce.date] ??= []).push({ clock_in: ce.clock_in, clock_out: ce.clock_out });
  }

  const exceptionByDate: Record<string, { exception_type: string; notes: string | null; blocks: TimeBlock[] | null }> = {};
  for (const e of ((exceptions ?? []) as {
    exception_type: string; date_from: string; date_to: string; notes: string | null; blocks: TimeBlock[] | null;
  }[])) {
    for (const d of enumerateDates(e.date_from, e.date_to)) {
      exceptionByDate[d] = { exception_type: e.exception_type, notes: e.notes, blocks: e.blocks };
    }
  }

  const overtimeByDate: Record<string, Record<string, unknown>[]> = {};
  for (const ot of (overtimeEntries ?? []) as Record<string, unknown>[]) {
    (overtimeByDate[ot.date as string] ??= []).push(ot);
  }

  const correctionByDate: Record<string, Record<string, unknown>> = {};
  for (const c of (corrections ?? []) as Record<string, unknown>[]) correctionByDate[c.date as string] = c;

  const daySummary = ((ps.day_summary ?? []) as DayResult[]);
  const dayByDate: Record<string, DayResult> = {};
  for (const d of daySummary) dayByDate[d.date] = d;

  const enrichedDaily = sortedDaily.map((line: Record<string, unknown>) => ({
    ...line,
    clock_times: clockByDate[line.date as string] ?? null,
    day_exception: exceptionByDate[line.date as string] ?? null,
    day_overtime: overtimeByDate[line.date as string] ?? null,
    day_correction: correctionByDate[line.date as string] ?? null,
    day_status: dayByDate[line.date as string]?.status ?? null,
  }));

  const totalsByType: Record<string, { hours: number; amount: number }> = {};
  for (const line of daily ?? []) {
    const key = `${line.band}:${line.tier}`;
    (totalsByType[key] ??= { hours: 0, amount: 0 });
    totalsByType[key].hours += Number(line.hours);
    totalsByType[key].amount += Number(line.amount);
  }

  const linesByDate: Record<string, Record<string, unknown>[]> = {};
  for (const line of sortedDaily) (linesByDate[line.date as string] ??= []).push(line);

  const enrichedWarnings = (warnings ?? []).map((w: Record<string, unknown>) => ({
    ...w,
    daily_lines: linesByDate[w.date as string] ?? [],
    clock_times: clockByDate[w.date as string] ?? null,
    day: dayByDate[w.date as string] ?? null,
  }));

  const pending = (warnings ?? []).filter((w: Record<string, unknown>) => w.status === 'pending');
  const blockingPending = pending.filter((w: Record<string, unknown>) => w.blocking);
  const blockingDates = [...new Set(blockingPending.map((w: Record<string, unknown>) => w.date as string))];

  const statusCount: Record<string, number> = {};
  for (const d of daySummary) statusCount[d.status] = (statusCount[d.status] ?? 0) + 1;

  return {
    ...ps,
    daily: enrichedDaily,
    items: items ?? [],
    totals_by_type: totalsByType,
    settlement_warnings: enrichedWarnings,
    pending_warnings: pending.length,
    blocking_pending: blockingDates.length,
    blocking_dates: blockingDates,
    corrections: corrections ?? [],
    day_summary: daySummary,
    day_status_count: statusCount,
    can_confirm: ps.status === 'draft' && blockingDates.length === 0,
    warnings: {
      has_projected: (daily ?? []).some((l: Record<string, unknown>) => l.is_projected),
    },
  };
}

/**
 * Marca un aviso informativo como revisado. Los que bloquean no se pueden
 * "aceptar" así: se resuelven normalizando el día, que es lo que deja una
 * decisión que sobrevive al recálculo.
 */
export async function reviewWarning(
  warningId: string,
  updates: { status: 'pending' | 'accepted' | 'corrected'; note?: string | null },
  reviewedBy: string
) {
  const { data: w } = await supabaseAdmin
    .from('pre_settlement_warnings')
    .select('blocking')
    .eq('id', warningId)
    .single();
  if (w?.blocking) {
    throw new BusinessError('Este aviso se resuelve normalizando el día: elegí qué se paga ese día.');
  }

  const { data, error } = await supabaseAdmin
    .from('pre_settlement_warnings')
    .update({
      status: updates.status,
      note: updates.note ?? null,
      reviewed_by: updates.status === 'pending' ? null : reviewedBy,
      reviewed_at: updates.status === 'pending' ? null : new Date().toISOString(),
    })
    .eq('id', warningId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

// ─── Correcciones desde la tabla ────────────────────────────────────

/**
 * Fija lo que se paga un día, banda por banda.
 *
 * Es lo que hace la edición en la tabla. Antes cambiaba la línea misma y se
 * perdía al regenerar; ahora deja una corrección `manual` —un dato de entrada—
 * y recalcula. Si el día ya tenía una corrección con efectos (una autorización
 * creada al normalizarlo), se deshacen primero.
 */
export async function setDayLines(
  profileId: string,
  date: string,
  lines: CorrectionLine[],
  userId: string,
  note: string | null = null
) {
  const { data: existing } = await supabaseAdmin
    .from('day_corrections')
    .select('id, effects')
    .eq('profile_id', profileId)
    .eq('date', date)
    .maybeSingle();

  if (existing?.effects) await revertEffects(existing.effects as Record<string, unknown>);

  const payload = {
    profile_id: profileId,
    date,
    resolution: 'manual',
    blocks: null,
    lines: lines.filter((l) => l.hours > 0).map((l) => ({ band: l.band, tier: l.tier, hours: Number(l.hours) })),
    note,
    effects: null,
    created_by: userId,
  };

  const { error } = existing
    ? await supabaseAdmin.from('day_corrections').update(payload).eq('id', existing.id)
    : await supabaseAdmin.from('day_corrections').insert(payload);
  if (error) throw new Error(error.message);

  await refreshDrafts({ profileId, from: date });
}

/** Deshace lo que una normalización tocó además de la corrección. */
export async function revertEffects(effects: Record<string, unknown>) {
  const created = (effects.overtime_created as string[] | undefined) ?? [];
  const uncapped = (effects.overtime_uncapped as string[] | undefined) ?? [];
  if (created.length) await supabaseAdmin.from('overtime').delete().in('id', created);
  if (uncapped.length) await supabaseAdmin.from('overtime').update({ uncapped: false }).in('id', uncapped);
}

async function dayLinesOf(preSettlementId: string, date: string) {
  const { data } = await supabaseAdmin
    .from('pre_settlement_daily')
    .select('id, band, tier, hours, source')
    .eq('pre_settlement_id', preSettlementId)
    .eq('date', date);
  // Los ajustes vienen del período anterior: no son parte de lo que se paga por ese día acá
  return ((data ?? []) as { id: string; band: Band; tier: Tier; hours: number; source: string }[])
    .filter((l) => l.source !== 'adjustment');
}

async function draftOfLine(lineId: string) {
  const { data: line } = await supabaseAdmin
    .from('pre_settlement_daily')
    .select('id, pre_settlement_id, date, source, pre_settlements(profile_id, status)')
    .eq('id', lineId)
    .single();
  if (!line) throw new BusinessError('Línea no encontrada', 404);
  const ps = line.pre_settlements as unknown as { profile_id: string; status: string };
  if (ps.status !== 'draft') throw new BusinessError('La preliquidación ya no está en borrador');
  if (line.source === 'adjustment') {
    throw new BusinessError('Las líneas de ajuste vienen del período anterior: se corrigen allá');
  }
  return { line, profileId: ps.profile_id };
}

/** Edita las horas de una línea. Deja una corrección del día. */
export async function updateDailyLine(lineId: string, updates: { hours: number; note?: string | null }, userId: string) {
  const { line, profileId } = await draftOfLine(lineId);
  const lines = (await dayLinesOf(line.pre_settlement_id, line.date)).map((l) => ({
    band: l.band, tier: l.tier, hours: l.id === lineId ? updates.hours : Number(l.hours),
  }));
  await setDayLines(profileId, line.date, lines, userId, updates.note ?? null);
}

/** Agrega una línea a un día. Deja una corrección del día. */
export async function addDailyLine(
  preSettlementId: string,
  line: { date: string; band: Band; tier: Tier; hours: number; client_id: string | null },
  userId: string
) {
  const { data: ps } = await supabaseAdmin
    .from('pre_settlements')
    .select('profile_id, status, period_from, period_to')
    .eq('id', preSettlementId)
    .single();
  if (!ps) throw new BusinessError('Preliquidación no encontrada', 404);
  if (ps.status !== 'draft') throw new BusinessError('La preliquidación ya no está en borrador');
  if (line.date < ps.period_from || line.date > ps.period_to) {
    throw new BusinessError('La fecha está fuera del período');
  }

  const lines = (await dayLinesOf(preSettlementId, line.date)).map((l) => ({
    band: l.band, tier: l.tier, hours: Number(l.hours),
  }));
  lines.push({ band: line.band, tier: line.tier, hours: line.hours });
  await setDayLines(ps.profile_id, line.date, lines, userId);
}

/** Saca una línea de un día. Deja una corrección del día. */
export async function deleteDailyLine(lineId: string, userId: string) {
  const { line, profileId } = await draftOfLine(lineId);
  const lines = (await dayLinesOf(line.pre_settlement_id, line.date))
    .filter((l) => l.id !== lineId)
    .map((l) => ({ band: l.band, tier: l.tier, hours: Number(l.hours) }));
  await setDayLines(profileId, line.date, lines, userId);
}

// ─── Ítems ──────────────────────────────────────────────────────────

export async function addItem(preSettlementId: string, item: SettlementItem) {
  const { data, error } = await supabaseAdmin
    .from('pre_settlement_items')
    .insert({ ...item, pre_settlement_id: preSettlementId })
    .select()
    .single();

  if (error) throw new Error(error.message);

  await recalculateTotal(preSettlementId);
  return data;
}

export async function updateItem(itemId: string, updates: Partial<SettlementItem>) {
  const { data: current } = await supabaseAdmin
    .from('pre_settlement_items')
    .select('pre_settlement_id')
    .eq('id', itemId)
    .single();

  if (!current) throw new Error('Item not found');

  const { data, error } = await supabaseAdmin
    .from('pre_settlement_items')
    .update(updates)
    .eq('id', itemId)
    .select()
    .single();

  if (error) throw new Error(error.message);

  await recalculateTotal(current.pre_settlement_id);
  return data;
}

export async function deleteItem(itemId: string) {
  const { data: current } = await supabaseAdmin
    .from('pre_settlement_items')
    .select('pre_settlement_id')
    .eq('id', itemId)
    .single();

  if (!current) throw new Error('Item not found');

  const { error } = await supabaseAdmin.from('pre_settlement_items').delete().eq('id', itemId);
  if (error) throw new Error(error.message);

  await recalculateTotal(current.pre_settlement_id);
}

/**
 * Recalcula el total y, con él, los ítems que dependen del subtotal.
 *
 * Corregir las horas de un día cambia el subtotal, y con eso el REG, el SUPER
 * REG, la antigüedad y el reintegro de equipos, que son porcentajes de ese
 * subtotal.
 */
async function recalculateTotal(preSettlementId: string) {
  const { data: ps } = await supabaseAdmin
    .from('pre_settlements')
    .select('profile_id, period_to')
    .eq('id', preSettlementId)
    .single();

  const [{ data: daily }, { data: items }] = await Promise.all([
    supabaseAdmin.from('pre_settlement_daily').select('amount').eq('pre_settlement_id', preSettlementId),
    supabaseAdmin.from('pre_settlement_items').select('*').eq('pre_settlement_id', preSettlementId),
  ]);

  const subtotal = (daily ?? []).reduce((sum, d: { amount: number }) => sum + Number(d.amount), 0);

  let itemsTotal = 0;
  if (ps) {
    const [{ data: ratesRaw }, factors] = await Promise.all([
      supabaseAdmin
        .from('agent_rates')
        .select('amount_per_hour, effective_from')
        .eq('profile_id', ps.profile_id)
        .order('effective_from', { ascending: false }),
      fetchRateFactors(),
    ]);
    const baseRate = findBaseRate((ratesRaw as AgentRate[]) ?? [], ps.period_to);

    for (const row of ((items ?? []) as unknown as Record<string, unknown>[])) {
      const kind = (row.kind as ItemKind) ?? 'fixed';
      if (kind === 'fixed') {
        itemsTotal += Number(row.amount);
        continue;
      }

      const recomputed = roundCents(
        computeItemAmount(
          {
            kind,
            amount: Number(row.amount),
            percentage: row.percentage === null ? null : Number(row.percentage),
            quantity: row.quantity === null ? null : Number(row.quantity),
            band: row.band as Band | null,
            tier: row.tier as Tier | null,
            factor: row.factor === null ? null : Number(row.factor),
          },
          { subtotal, baseRate, factors }
        )
      );

      itemsTotal += recomputed;

      if (Math.abs(recomputed - Number(row.amount)) > 0.001) {
        await supabaseAdmin.from('pre_settlement_items').update({ amount: recomputed }).eq('id', row.id as string);
      }
    }
  } else {
    itemsTotal = (items ?? []).reduce((sum, i: { amount: number }) => sum + Number(i.amount), 0);
  }

  await supabaseAdmin
    .from('pre_settlements')
    .update({ total_amount: roundCents(subtotal + itemsTotal) })
    .eq('id', preSettlementId);
}

// ─── Estado ─────────────────────────────────────────────────────────

export async function listPreSettlements(profileId?: string) {
  let query = supabaseAdmin
    .from('pre_settlements')
    .select('*, profiles!pre_settlements_profile_id_fkey(first_name, last_name, employee_id)')
    .order('created_at', { ascending: false });

  if (profileId) query = query.eq('profile_id', profileId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Cambia el estado de una preliquidación.
 *
 * Confirmar exige que esté al día y sin días por normalizar. Antes de confirmar
 * se recalcula: si con los datos de este momento el total cambió respecto del
 * que se revisó, no se confirma y se avisa, para que nadie confirme un importe
 * distinto del que vio.
 */
export async function updatePreSettlementStatus(
  preSettlementId: string,
  status: 'draft' | 'confirmed' | 'cancelled'
) {
  const { data: current } = await supabaseAdmin
    .from('pre_settlements')
    .select('status, total_amount')
    .eq('id', preSettlementId)
    .single();
  if (!current) throw new BusinessError('Preliquidación no encontrada', 404);

  if (status === 'confirmed') {
    if (current.status !== 'draft') throw new BusinessError('Sólo se confirma una preliquidación en borrador');

    const antes = Number(current.total_amount);
    await recalculatePreSettlement(preSettlementId);

    const [{ data: after }, { data: blocking }] = await Promise.all([
      supabaseAdmin.from('pre_settlements').select('total_amount').eq('id', preSettlementId).single(),
      supabaseAdmin
        .from('pre_settlement_warnings')
        .select('date, code')
        .eq('pre_settlement_id', preSettlementId)
        .eq('blocking', true)
        .eq('status', 'pending'),
    ]);

    const fechas = [...new Set(((blocking ?? []) as { date: string; code: string }[]).map((w) => w.date))].sort();
    if (fechas.length > 0) {
      const faltaEvaluacion = (blocking ?? []).some((w: { code: string }) => w.code === 'missing_period_params');
      const dias = fechas.filter((f) => !faltaEvaluacion || fechas.length > 1);
      throw new BusinessError(
        'No se puede confirmar: ' +
          [
            faltaEvaluacion ? 'falta la evaluación mensual' : null,
            dias.length ? `${dias.length === 1 ? 'queda 1 día' : `quedan ${dias.length} días`} sin normalizar` : null,
          ].filter(Boolean).join(' y ') + '.'
      );
    }

    const despues = Number(after?.total_amount);
    if (Math.abs(despues - antes) > 0.005) {
      throw new BusinessError(
        `La preliquidación se actualizó con datos nuevos: pasó de $${antes.toFixed(2)} a $${despues.toFixed(2)}. ` +
          'Revisala y confirmá de nuevo.'
      );
    }
  }

  const { data, error } = await supabaseAdmin
    .from('pre_settlements')
    .update({ status })
    .eq('id', preSettlementId)
    .select()
    .single();

  if (error) throw new Error(error.message);

  // Volver a borrador la deja viva otra vez
  if (status === 'draft' && current.status !== 'draft') await recalculatePreSettlement(preSettlementId);

  return data;
}

// ─── Generación masiva ──────────────────────────────────────────────

export interface BulkResult {
  profile_id: string;
  name: string;
  status: 'generated' | 'updated' | 'skipped' | 'failed';
  pre_settlement_id?: string;
  total_amount?: number;
  warnings?: number;
  blocking?: number;
  reason?: string;
}

/**
 * Genera o actualiza la preliquidación del período para varios agentes de una.
 * Sin `profileIds`, todos los agentes activos. Las confirmadas no se tocan.
 */
export async function generatePreSettlementsBulk(
  profileIds: string[] | null,
  periodFrom: string,
  periodTo: string,
  createdBy: string
): Promise<BulkResult[]> {
  let targets = profileIds ?? [];

  if (targets.length === 0) {
    const { data } = await supabaseAdmin.from('profiles').select('id').eq('role', 'agent').eq('is_active', true);
    targets = ((data ?? []) as { id: string }[]).map((p) => p.id);
  }

  const [{ data: profiles }, { data: confirmed }] = await Promise.all([
    supabaseAdmin.from('profiles').select('id, first_name, last_name').in('id', targets),
    supabaseAdmin
      .from('pre_settlements')
      .select('profile_id')
      .in('profile_id', targets)
      .eq('period_from', periodFrom)
      .eq('period_to', periodTo)
      .eq('status', 'confirmed'),
  ]);

  const nameById = new Map(
    ((profiles ?? []) as { id: string; first_name: string; last_name: string }[]).map((p) => [
      p.id,
      `${p.last_name}, ${p.first_name}`,
    ])
  );
  const yaConfirmadas = new Set(((confirmed ?? []) as { profile_id: string }[]).map((p) => p.profile_id));

  const results: BulkResult[] = [];
  for (const profileId of targets) {
    const name = nameById.get(profileId) ?? profileId;

    if (yaConfirmadas.has(profileId)) {
      results.push({ profile_id: profileId, name, status: 'skipped', reason: 'Ya está confirmada' });
      continue;
    }

    try {
      const r = await generatePreSettlement(profileId, periodFrom, periodTo, createdBy);
      results.push({
        profile_id: profileId,
        name,
        status: r.created ? 'generated' : 'updated',
        pre_settlement_id: r.preSettlement.id as string,
        total_amount: r.preSettlement.total_amount as number,
        warnings: r.warnings,
        blocking: r.blocking,
      });
    } catch (err) {
      results.push({ profile_id: profileId, name, status: 'failed', reason: (err as Error).message });
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

// ─── Resumen del período ────────────────────────────────────────────

export interface PeriodSummaryRow {
  pre_settlement_id: string;
  profile_id: string;
  employee_id: string | null;
  name: string;
  status: string;
  hours: number;
  subtotal: number;
  concepts: Record<string, number>;
  manual_items: number;
  net: number;
  pending_warnings: number;
  /** Días que faltan normalizar */
  blocking_pending: number;
}

/**
 * Una fila por agente con el desglose del período: es el "resumen a pagar" que
 * hoy se copia a mano de la planilla al banco.
 */
export async function getPeriodSummary(periodFrom: string, periodTo: string): Promise<PeriodSummaryRow[]> {
  const { data: settlements } = await supabaseAdmin
    .from('pre_settlements')
    .select('*, profiles!pre_settlements_profile_id_fkey(first_name, last_name, employee_id)')
    .eq('period_from', periodFrom)
    .eq('period_to', periodTo)
    .neq('status', 'cancelled');

  const rows = (settlements ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id as string);

  const [{ data: daily }, { data: items }, { data: warnings }] = await Promise.all([
    supabaseAdmin.from('pre_settlement_daily').select('pre_settlement_id, hours, amount').in('pre_settlement_id', ids),
    supabaseAdmin.from('pre_settlement_items').select('pre_settlement_id, concept, amount').in('pre_settlement_id', ids),
    supabaseAdmin
      .from('pre_settlement_warnings')
      .select('pre_settlement_id, date, blocking')
      .in('pre_settlement_id', ids)
      .eq('status', 'pending'),
  ]);

  const agg = new Map<string, { hours: number; subtotal: number }>();
  for (const d of (daily ?? []) as Record<string, unknown>[]) {
    const key = d.pre_settlement_id as string;
    const cur = agg.get(key) ?? { hours: 0, subtotal: 0 };
    cur.hours += Number(d.hours);
    cur.subtotal += Number(d.amount);
    agg.set(key, cur);
  }

  const byConcept = new Map<string, Record<string, number>>();
  const manual = new Map<string, number>();
  for (const i of (items ?? []) as Record<string, unknown>[]) {
    const key = i.pre_settlement_id as string;
    const concept = i.concept as string;
    const amount = Number(i.amount);
    if (AUTO_CONCEPTS.has(concept)) {
      const c = byConcept.get(key) ?? {};
      c[concept] = (c[concept] ?? 0) + amount;
      byConcept.set(key, c);
    } else {
      manual.set(key, (manual.get(key) ?? 0) + amount);
    }
  }

  const pending = new Map<string, number>();
  const blockingDays = new Map<string, Set<string>>();
  for (const w of (warnings ?? []) as Record<string, unknown>[]) {
    const key = w.pre_settlement_id as string;
    pending.set(key, (pending.get(key) ?? 0) + 1);
    if (w.blocking) {
      const s = blockingDays.get(key) ?? new Set<string>();
      s.add(w.date as string);
      blockingDays.set(key, s);
    }
  }

  return rows
    .map((r) => {
      const id = r.id as string;
      const p = r.profiles as { first_name: string; last_name: string; employee_id: string | null };
      const a = agg.get(id) ?? { hours: 0, subtotal: 0 };
      return {
        pre_settlement_id: id,
        profile_id: r.profile_id as string,
        employee_id: p?.employee_id ?? null,
        name: p ? `${p.last_name}, ${p.first_name}` : '—',
        status: r.status as string,
        hours: roundCents(a.hours),
        subtotal: roundCents(a.subtotal),
        concepts: byConcept.get(id) ?? {},
        manual_items: roundCents(manual.get(id) ?? 0),
        net: Number(r.total_amount),
        pending_warnings: pending.get(id) ?? 0,
        blocking_pending: blockingDays.get(id)?.size ?? 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/** Períodos que ya tienen preliquidaciones, para poblar el selector. */
export async function listPeriods(): Promise<{ period_from: string; period_to: string; count: number }[]> {
  const { data } = await supabaseAdmin
    .from('pre_settlements')
    .select('period_from, period_to')
    .neq('status', 'cancelled')
    .order('period_from', { ascending: false });

  const seen = new Map<string, { period_from: string; period_to: string; count: number }>();
  for (const r of (data ?? []) as { period_from: string; period_to: string }[]) {
    const key = `${r.period_from}|${r.period_to}`;
    const cur = seen.get(key) ?? { period_from: r.period_from, period_to: r.period_to, count: 0 };
    cur.count += 1;
    seen.set(key, cur);
  }
  return [...seen.values()];
}
