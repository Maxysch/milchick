import { supabaseAdmin } from '../config/supabase.js';
import {
  buildDailyLines,
  compareAgainstClockIns,
  computeAdjustments,
  computeItemAmount,
  reviewOvertimeOutcomes,
  computeConcepts,
  computeRate,
  roundCents,
  settlementPeriod,
  timeToMinutes,
  DEFAULT_RATE_FACTORS,
  DEFAULT_SETTLEMENT_PARAMS,
  type Band,
  type ClockObservation,
  type DailyLine,
  type DayContext,
  type DayExceptionType,
  type OvertimeRecord,
  type RateFactors,
  type ItemKind,
  type ScheduleSlot,
  type SettlementParams,
  type Tier,
  type SettlementWarning,
} from './settlement-calc.js';

export { settlementPeriod };

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

/** Tarifa vigente a la fecha: la más reciente con `effective_from` anterior o igual. */
function findBaseRate(rates: AgentRate[], date: string): number {
  const matching = rates
    .filter((r) => r.effective_from <= date)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from));

  return matching[0]?.amount_per_hour ?? 0;
}

function enumerateDates(from: string, to: string): string[] {
  const dates: string[] = [];
  const current = new Date(from + 'T12:00:00');
  const end = new Date(to + 'T12:00:00');
  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

/** Día de la semana en convención JS (0 = domingo), que es la que usa `schedules`. */
function jsDayOfWeek(date: string): number {
  return new Date(date + 'T12:00:00').getDay();
}

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
 * usan los valores por defecto del perfil y se avisa: liquidar con el REG del
 * mes pasado es un error silencioso.
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
 * Excedente mínimo, en horas, para que las horas cargadas por el supervisor se
 * liquiden. Por debajo de eso unos minutos de más no habilitan una hora entera.
 */
export async function fetchAdditionalThreshold(): Promise<number> {
  const { data } = await supabaseAdmin
    .from('settlement_settings')
    .select('additional_threshold_minutes')
    .limit(1)
    .maybeSingle();
  return Number(data?.additional_threshold_minutes ?? 30) / 60;
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

interface RangeInputs {
  built: ReturnType<typeof buildDailyLines>;
  days: DayContext[];
  schedulesByDate: (date: string) => ScheduleSlot[];
  observations: Map<string, ClockObservation>;
}

/**
 * Arma el desglose de un rango de fechas a partir del esquema, las excepciones,
 * los feriados y las horas extra. Lo usan tanto la generación del período como
 * la conciliación del período anterior.
 */
async function buildRange(
  profileId: string,
  from: string,
  to: string,
  additionalThresholdHours?: number
): Promise<RangeInputs> {
  const dates = enumerateDates(from, to);

  const [
    { data: schedulesRaw },
    { data: exceptionsRaw },
    { data: holidaysRaw },
    { data: overtimeRaw },
    { data: clockRaw },
  ] = await Promise.all([
    supabaseAdmin
      .from('schedules')
      .select('day_of_week, start_time, end_time, client_id, effective_from, effective_until')
      .eq('profile_id', profileId)
      .lte('effective_from', to)
      .or(`effective_until.is.null,effective_until.gte.${from}`)
      .order('start_time'),
    supabaseAdmin
      .from('exceptions')
      .select('exception_type, date_from, date_to')
      .eq('profile_id', profileId)
      .lte('date_from', to)
      .gte('date_to', from),
    supabaseAdmin.from('holidays').select('date').gte('date', from).lte('date', to),
    supabaseAdmin
      .from('overtime')
      .select('date, hours, start_time, end_time, tier, client_id')
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
  ]);

  const schedules = (schedulesRaw as ScheduleRow[]) ?? [];
  const holidays = new Set(((holidaysRaw as { date: string }[]) ?? []).map((h) => h.date));

  const exceptionByDate = new Map<string, DayExceptionType>();
  for (const e of ((exceptionsRaw as { exception_type: DayExceptionType; date_from: string; date_to: string }[]) ?? [])) {
    for (const d of enumerateDates(e.date_from, e.date_to)) {
      if (d >= from && d <= to) exceptionByDate.set(d, e.exception_type);
    }
  }

  const schedulesByDate = (date: string): ScheduleSlot[] =>
    schedules.filter(
      (s) =>
        s.day_of_week === jsDayOfWeek(date) &&
        s.effective_from <= date &&
        (s.effective_until === null || s.effective_until >= date)
    );

  const days: DayContext[] = dates.map((date) => ({
    date,
    isHoliday: holidays.has(date),
    exception: exceptionByDate.get(date) ?? null,
  }));

  const overtime: OvertimeRecord[] = ((overtimeRaw as OvertimeRecord[]) ?? []).map((ot) => ({
    ...ot,
    hours: Number(ot.hours),
  }));

  // Un día puede tener varias marcaciones (turno partido): se acumulan.
  const observations = new Map<string, ClockObservation>();
  for (const ce of ((clockRaw as { date: string; clock_in: string; clock_out: string | null }[]) ?? [])) {
    const prev = observations.get(ce.date);
    const spanHours =
      ce.clock_out === null
        ? null
        : (((timeToMinutes(ce.clock_out) - timeToMinutes(ce.clock_in) + 1440) % 1440) || 1440) / 60;

    const accumulated =
      spanHours === null ? prev?.clockedHours ?? null : (prev?.clockedHours ?? 0) + spanHours;

    observations.set(ce.date, {
      date: ce.date,
      clockIn: prev?.clockIn ?? ce.clock_in,
      // Nos quedamos con el último egreso conocido del día
      clockOut: ce.clock_out ?? prev?.clockOut ?? null,
      clockedHours: accumulated,
    });
  }

  return {
    built: buildDailyLines({
      days,
      schedulesByDate,
      overtime,
      observations,
      additionalThresholdHours,
    }),
    days,
    schedulesByDate,
    observations,
  };
}

/**
 * Conciliación del período anterior.
 *
 * La liquidación se prepara antes de que termine el mes, así que los últimos
 * días se pagaron proyectados desde el esquema. Si después la realidad fue otra
 * —una ausencia, una licencia cargada tarde, horas extra— la diferencia se
 * arrastra acá en vez de corregirse a mano en la planilla del mes pasado.
 *
 * Sólo mira los días que estaban en el futuro cuando se generó, y saltea los que
 * alguien ya editó a mano: ahí la decisión está tomada.
 */
async function buildPreviousPeriodAdjustments(
  profileId: string,
  periodFrom: string
): Promise<DailyLine[]> {
  const { data: previousRaw } = await supabaseAdmin
    .from('pre_settlements')
    .select('id, period_from, period_to, created_at')
    .eq('profile_id', profileId)
    .lt('period_to', periodFrom)
    .neq('status', 'cancelled')
    .order('period_to', { ascending: false })
    .limit(1)
    .maybeSingle();

  const previous = previousRaw as
    | { id: string; period_from: string; period_to: string; created_at: string }
    | null;
  if (!previous) return [];

  const { data: linesRaw } = await supabaseAdmin
    .from('pre_settlement_daily')
    .select('date, band, tier, hours, client_id, source')
    .eq('pre_settlement_id', previous.id);

  const paidLines = (linesRaw ?? []) as {
    date: string;
    band: Band;
    tier: Tier;
    hours: number;
    client_id: string | null;
    source: string;
  }[];

  // Días que todavía no habían ocurrido cuando se generó la preliquidación
  const generatedOn = previous.created_at.slice(0, 10);
  const projectedDates = [
    ...new Set(
      paidLines.filter((l) => l.source !== 'adjustment' && l.date > generatedOn).map((l) => l.date)
    ),
  ].sort();

  if (projectedDates.length === 0) return [];

  // Si alguien tocó las horas de un día a mano, esa decisión manda
  const editedByHand = new Set(
    paidLines.filter((l) => l.source === 'manual').map((l) => l.date)
  );
  const toCheck = projectedDates.filter((d) => !editedByHand.has(d));
  if (toCheck.length === 0) return [];

  // Qué dicen hoy los datos para esos días
  const { built } = await buildRange(profileId, toCheck[0], toCheck[toCheck.length - 1]);

  return computeAdjustments(paidLines, built.lines, toCheck);
}

/**
 * Genera la preliquidación de un agente para un período.
 *
 * Las horas salen del ESQUEMA vigente, no de las marcaciones. Las marcaciones se
 * contrastan aparte y producen desvíos para que quien liquida revise y corrija
 * los días que no cerraron. Los importes nunca se tocan solos.
 *
 * Los días que todavía no ocurrieron se pagan proyectados y se concilian en el
 * período siguiente si la realidad terminó siendo otra.
 */
export async function generatePreSettlement(
  profileId: string,
  periodFrom: string,
  periodTo: string,
  createdBy: string
): Promise<{
  preSettlement: Record<string, unknown>;
  dailyLines: PersistedDailyLine[];
  items: SettlementItem[];
  warnings: SettlementWarning[];
  adjustments: DailyLine[];
}> {
  const threshold = await fetchAdditionalThreshold();

  const [{ data: ratesRaw }, factors, settlementParams, range, adjustments] = await Promise.all([
    supabaseAdmin
      .from('agent_rates')
      .select('amount_per_hour, effective_from')
      .eq('profile_id', profileId)
      .order('effective_from', { ascending: false }),
    fetchRateFactors(),
    fetchSettlementParams(profileId, periodTo),
    buildRange(profileId, periodFrom, periodTo, threshold),
    buildPreviousPeriodAdjustments(profileId, periodFrom),
  ]);

  const agentRates = (ratesRaw as AgentRate[]) ?? [];
  const { params, periodParamsLoaded } = settlementParams;
  const { built, days, schedulesByDate, observations } = range;

  // ── Importes ──
  const today = new Date().toISOString().split('T')[0];
  const dailyLines: PersistedDailyLine[] = [...built.lines, ...adjustments].map((line) => {
    const baseRate = findBaseRate(agentRates, line.date);
    const rate = computeRate(baseRate, line.band, line.tier, factors);
    return {
      date: line.date,
      band: line.band,
      tier: line.tier,
      hours: line.hours,
      rate_per_hour: rate,
      amount: line.hours * rate,
      // Proyectado = todavía no ocurrió. Se concilia el mes que viene si la
      // realidad terminó siendo otra (ver buildPreviousPeriodAdjustments).
      is_projected: line.source !== 'adjustment' && line.date > today,
      client_id: line.client_id,
      source: line.source,
    };
  });

  const subtotal = dailyLines.reduce((sum, l) => sum + l.amount, 0);

  // La tarifa base de referencia para los conceptos es la vigente al cierre
  const baseRateAtClose = findBaseRate(agentRates, periodTo);

  const concepts = computeConcepts({
    subtotal,
    baseRate: baseRateAtClose,
    unworkedHolidayHours: built.unworkedHolidayHours,
    vacationHours: built.vacationHours,
    params,
  });

  const items: SettlementItem[] = concepts.map((c) => ({
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

  // ── Desvíos contra las marcaciones ──
  const warnings = [
    ...compareAgainstClockIns(days, schedulesByDate, observations),
    // Recortes y excedentes sin cubrir de las horas cargadas por el supervisor
    ...reviewOvertimeOutcomes(built.overtimeOutcomes, threshold),
  ];
  for (const date of built.absenceDates) {
    warnings.push({ date, code: 'absence', detail: 'Ausencia registrada: no se liquidan horas' });
  }

  // El REG depende de la performance del mes. Si nadie la cargó, se liquidó con
  // el valor por defecto del perfil, que puede no tener nada que ver.
  if (!periodParamsLoaded) {
    warnings.push({
      date: periodTo,
      code: 'missing_period_params',
      detail:
        'Sin evaluación mensual cargada: el REG y el SUPER REG salieron del valor ' +
        'por defecto del agente',
    });
  }

  const totalAmount = roundCents(subtotal + items.reduce((s, i) => s + i.amount, 0));

  // ── Persistencia ──
  const { data: preSettlement, error: psError } = await supabaseAdmin
    .from('pre_settlements')
    .insert({
      profile_id: profileId,
      period_from: periodFrom,
      period_to: periodTo,
      status: 'draft',
      total_amount: totalAmount,
      created_by: createdBy,
    })
    .select()
    .single();

  if (psError) throw new Error(`Failed to create pre-settlement: ${psError.message}`);

  if (dailyLines.length > 0) {
    const { error } = await supabaseAdmin
      .from('pre_settlement_daily')
      .insert(dailyLines.map((l) => ({ ...l, pre_settlement_id: preSettlement.id })));
    if (error) throw new Error(`Failed to insert daily lines: ${error.message}`);
  }

  if (items.length > 0) {
    const { error } = await supabaseAdmin
      .from('pre_settlement_items')
      .insert(items.map((i) => ({ ...i, pre_settlement_id: preSettlement.id })));
    if (error) throw new Error(`Failed to insert items: ${error.message}`);
  }

  // Los desvíos se guardan: son el control de que lo pagado por esquema
  // efectivamente ocurrió. Si se quedaran en la respuesta, se perderían.
  if (warnings.length > 0) {
    const { error } = await supabaseAdmin
      .from('pre_settlement_warnings')
      .insert(warnings.map((w) => ({
        pre_settlement_id: preSettlement.id,
        date: w.date,
        code: w.code,
        detail: w.detail,
      })));
    if (error) throw new Error(`Failed to insert warnings: ${error.message}`);
  }

  return { preSettlement, dailyLines, items, warnings, adjustments };
}

/**
 * Preliquidación con todo el detalle: líneas diarias, ítems, totales por
 * banda/tramo y los días donde la marcación no acompaña al esquema pagado.
 */
export async function getPreSettlementDetail(preSettlementId: string) {
  const { data: ps, error: psError } = await supabaseAdmin
    .from('pre_settlements')
    .select('*, profiles!pre_settlements_profile_id_fkey(first_name, last_name, employee_id)')
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
  ] = await Promise.all([
    supabaseAdmin
      .from('pre_settlement_daily')
      .select('*, clients(name), corrector:corrected_by(first_name, last_name)')
      .eq('pre_settlement_id', preSettlementId)
      .order('date'),
    supabaseAdmin
      .from('pre_settlement_items')
      .select('*')
      .eq('pre_settlement_id', preSettlementId)
      .order('created_at'),
    supabaseAdmin
      .from('clock_entries')
      .select('date, clock_in, clock_out')
      .eq('profile_id', ps.profile_id)
      .gte('date', ps.period_from)
      .lte('date', ps.period_to)
      .order('date')
      .order('clock_in'),
    supabaseAdmin
      .from('pre_settlement_warnings')
      .select('*')
      .eq('pre_settlement_id', preSettlementId)
      .order('date'),
    supabaseAdmin
      .from('exceptions')
      .select('exception_type, date_from, date_to, notes')
      .eq('profile_id', ps.profile_id)
      .lte('date_from', ps.period_to)
      .gte('date_to', ps.period_from),
    supabaseAdmin
      .from('overtime')
      .select('date, hours, tier, start_time, end_time, notes')
      .eq('profile_id', ps.profile_id)
      .gte('date', ps.period_from)
      .lte('date', ps.period_to)
      .order('date'),
  ]);

  // Dentro de un día, las líneas van de menor a mayor recargo y de la banda más
  // habitual a la menos. Postgres ordenaría por texto y dejaría "additional"
  // antes que "normal", que se lee al revés de como se piensa.
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

  // Excepciones expandidas por fecha, para poder colgarlas de cada línea
  const exceptionByDate: Record<string, { exception_type: string; notes: string | null }> = {};
  for (const e of ((exceptions ?? []) as {
    exception_type: string;
    date_from: string;
    date_to: string;
    notes: string | null;
  }[])) {
    const current = new Date(e.date_from + 'T12:00:00');
    const end = new Date(e.date_to + 'T12:00:00');
    while (current <= end) {
      exceptionByDate[current.toISOString().split('T')[0]] = {
        exception_type: e.exception_type,
        notes: e.notes,
      };
      current.setDate(current.getDate() + 1);
    }
  }

  const overtimeByDate: Record<string, Record<string, unknown>[]> = {};
  for (const ot of (overtimeEntries ?? []) as Record<string, unknown>[]) {
    (overtimeByDate[ot.date as string] ??= []).push(ot);
  }

  const enrichedDaily = sortedDaily.map((line: Record<string, unknown>) => ({
    ...line,
    clock_times: clockByDate[line.date as string] ?? null,
    day_exception: exceptionByDate[line.date as string] ?? null,
    day_overtime: overtimeByDate[line.date as string] ?? null,
  }));

  // Totales por banda × tramo
  const totalsByType: Record<string, { hours: number; amount: number }> = {};
  for (const line of daily ?? []) {
    const key = `${line.band}:${line.tier}`;
    (totalsByType[key] ??= { hours: 0, amount: 0 });
    totalsByType[key].hours += Number(line.hours);
    totalsByType[key].amount += Number(line.amount);
  }

  // Cada desvío se acompaña de las líneas diarias de esa fecha, para poder
  // corregir las horas sin salir de la pantalla de revisión.
  const linesByDate: Record<string, Record<string, unknown>[]> = {};
  for (const line of sortedDaily) {
    (linesByDate[line.date as string] ??= []).push(line);
  }

  const enrichedWarnings = (warnings ?? []).map((w: Record<string, unknown>) => ({
    ...w,
    daily_lines: linesByDate[w.date as string] ?? [],
    clock_times: clockByDate[w.date as string] ?? null,
  }));

  const pendingCount = (warnings ?? []).filter(
    (w: Record<string, unknown>) => w.status === 'pending'
  ).length;

  return {
    ...ps,
    daily: enrichedDaily,
    items: items ?? [],
    totals_by_type: totalsByType,
    settlement_warnings: enrichedWarnings,
    pending_warnings: pendingCount,
    warnings: {
      has_projected: (daily ?? []).some((l: Record<string, unknown>) => l.is_projected),
    },
  };
}

/**
 * Marca un desvío como revisado. `accepted` = está bien así (salida autorizada,
 * marcación olvidada); `corrected` = se ajustaron las horas.
 */
export async function reviewWarning(
  warningId: string,
  updates: { status: 'pending' | 'accepted' | 'corrected'; note?: string | null },
  reviewedBy: string
) {
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

/** Edita horas y/o tarifa de una línea diaria y recalcula el importe. */
export async function updateDailyLine(
  lineId: string,
  updates: { hours?: number; rate_per_hour?: number },
  correctedBy?: string
) {
  const { data: current } = await supabaseAdmin
    .from('pre_settlement_daily')
    .select('*')
    .eq('id', lineId)
    .single();

  if (!current) throw new Error('Daily line not found');

  const hours = updates.hours ?? Number(current.hours);
  const rate = updates.rate_per_hour ?? Number(current.rate_per_hour);

  const { data, error } = await supabaseAdmin
    .from('pre_settlement_daily')
    .update({
      hours,
      rate_per_hour: rate,
      amount: hours * rate,
      source: 'manual',
      // Sólo en la primera corrección: si se edita de nuevo, el original sigue
      // siendo lo que había calculado el motor.
      original_hours: current.original_hours ?? Number(current.hours),
      corrected_by: correctedBy ?? current.corrected_by ?? null,
      corrected_at: new Date().toISOString(),
    })
    .eq('id', lineId)
    .select()
    .single();

  if (error) throw new Error(error.message);

  // Corregir las horas de un día ES la revisión del desvío de ese día: no hace
  // falta además marcarlo a mano.
  await supabaseAdmin
    .from('pre_settlement_warnings')
    .update({ status: 'corrected', reviewed_at: new Date().toISOString() })
    .eq('pre_settlement_id', current.pre_settlement_id)
    .eq('date', current.date)
    .eq('status', 'pending');

  await recalculateTotal(current.pre_settlement_id);

  return data;
}

/**
 * Agrega una línea diaria a mano.
 *
 * Hace falta para los días que el motor no puede generar solo: uno que el agente
 * cubrió sin tenerlo en su esquema, o cualquier hueco que el liquidador detecte.
 * Queda con `source = 'manual'`, así que la conciliación del mes siguiente no la
 * pisa y el desvío de ese día queda resuelto.
 */
export async function addDailyLine(
  preSettlementId: string,
  line: { date: string; band: Band; tier: Tier; hours: number; client_id: string | null }
) {
  const { data: ps } = await supabaseAdmin
    .from('pre_settlements')
    .select('profile_id')
    .eq('id', preSettlementId)
    .single();

  if (!ps) throw new Error('Pre-settlement not found');

  const [{ data: ratesRaw }, factors] = await Promise.all([
    supabaseAdmin
      .from('agent_rates')
      .select('amount_per_hour, effective_from')
      .eq('profile_id', ps.profile_id)
      .order('effective_from', { ascending: false }),
    fetchRateFactors(),
  ]);

  const baseRate = findBaseRate((ratesRaw as AgentRate[]) ?? [], line.date);
  const rate = computeRate(baseRate, line.band, line.tier, factors);

  const { data, error } = await supabaseAdmin
    .from('pre_settlement_daily')
    .insert({
      pre_settlement_id: preSettlementId,
      date: line.date,
      band: line.band,
      tier: line.tier,
      hours: line.hours,
      rate_per_hour: rate,
      amount: line.hours * rate,
      is_projected: false,
      client_id: line.client_id,
      source: 'manual',
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  // Agregar el día que faltaba también resuelve su desvío
  await supabaseAdmin
    .from('pre_settlement_warnings')
    .update({ status: 'corrected', reviewed_at: new Date().toISOString() })
    .eq('pre_settlement_id', preSettlementId)
    .eq('date', line.date)
    .eq('status', 'pending');

  await recalculateTotal(preSettlementId);

  return data;
}

/** Borra una línea diaria agregada a mano. */
export async function deleteDailyLine(lineId: string) {
  const { data: current } = await supabaseAdmin
    .from('pre_settlement_daily')
    .select('pre_settlement_id, source')
    .eq('id', lineId)
    .single();

  if (!current) throw new Error('Daily line not found');
  if (current.source !== 'manual') {
    throw new Error('Sólo se pueden borrar las líneas agregadas a mano');
  }

  const { error } = await supabaseAdmin.from('pre_settlement_daily').delete().eq('id', lineId);
  if (error) throw new Error(error.message);

  await recalculateTotal(current.pre_settlement_id);
}

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
 * subtotal. Antes quedaban con el importe del momento de la generación: se
 * pagaba un REG calculado sobre horas que ya no eran las liquidadas.
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
        await supabaseAdmin
          .from('pre_settlement_items')
          .update({ amount: recomputed })
          .eq('id', row.id as string);
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

export async function updatePreSettlementStatus(
  preSettlementId: string,
  status: 'draft' | 'confirmed' | 'cancelled'
) {
  const { data, error } = await supabaseAdmin
    .from('pre_settlements')
    .update({ status })
    .eq('id', preSettlementId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

// ─── Generación masiva ──────────────────────────────────────────────

export interface BulkResult {
  profile_id: string;
  name: string;
  status: 'generated' | 'skipped' | 'failed';
  pre_settlement_id?: string;
  total_amount?: number;
  warnings?: number;
  reason?: string;
}

/**
 * Genera la preliquidación del período para varios agentes de una.
 *
 * Liquidar 13 agentes de a uno son 13 vueltas por el mismo modal. Se saltean los
 * que ya tienen una preliquidación viva para ese mismo período, para no duplicar
 * por un doble click.
 */
export async function generatePreSettlementsBulk(
  profileIds: string[] | null,
  periodFrom: string,
  periodTo: string,
  createdBy: string
): Promise<BulkResult[]> {
  let targets = profileIds ?? [];

  if (targets.length === 0) {
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('role', 'agent')
      .eq('is_active', true);
    targets = ((data ?? []) as { id: string }[]).map((p) => p.id);
  }

  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('id, first_name, last_name')
    .in('id', targets);

  const nameById = new Map(
    ((profiles ?? []) as { id: string; first_name: string; last_name: string }[]).map((p) => [
      p.id,
      `${p.last_name}, ${p.first_name}`,
    ])
  );

  const { data: existing } = await supabaseAdmin
    .from('pre_settlements')
    .select('profile_id')
    .in('profile_id', targets)
    .eq('period_from', periodFrom)
    .eq('period_to', periodTo)
    .neq('status', 'cancelled');

  const alreadyDone = new Set(
    ((existing ?? []) as { profile_id: string }[]).map((p) => p.profile_id)
  );

  const results: BulkResult[] = [];

  for (const profileId of targets) {
    const name = nameById.get(profileId) ?? profileId;

    if (alreadyDone.has(profileId)) {
      results.push({
        profile_id: profileId,
        name,
        status: 'skipped',
        reason: 'Ya tiene una preliquidación para este período',
      });
      continue;
    }

    try {
      const r = await generatePreSettlement(profileId, periodFrom, periodTo, createdBy);
      results.push({
        profile_id: profileId,
        name,
        status: 'generated',
        pre_settlement_id: r.preSettlement.id as string,
        total_amount: r.preSettlement.total_amount as number,
        warnings: r.warnings.length,
      });
    } catch (err) {
      results.push({
        profile_id: profileId,
        name,
        status: 'failed',
        reason: (err as Error).message,
      });
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

/**
 * Una fila por agente con el desglose del período: es el "resumen a pagar" que
 * hoy se copia a mano de la planilla al banco.
 */
export async function getPeriodSummary(
  periodFrom: string,
  periodTo: string
): Promise<PeriodSummaryRow[]> {
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
    supabaseAdmin
      .from('pre_settlement_daily')
      .select('pre_settlement_id, hours, amount')
      .in('pre_settlement_id', ids),
    supabaseAdmin
      .from('pre_settlement_items')
      .select('pre_settlement_id, concept, amount')
      .in('pre_settlement_id', ids),
    supabaseAdmin
      .from('pre_settlement_warnings')
      .select('pre_settlement_id')
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
  const known = new Set<string>(CONCEPT_ORDER);
  for (const i of (items ?? []) as Record<string, unknown>[]) {
    const key = i.pre_settlement_id as string;
    const concept = i.concept as string;
    const amount = Number(i.amount);
    if (known.has(concept)) {
      const c = byConcept.get(key) ?? {};
      c[concept] = (c[concept] ?? 0) + amount;
      byConcept.set(key, c);
    } else {
      manual.set(key, (manual.get(key) ?? 0) + amount);
    }
  }

  const pending = new Map<string, number>();
  for (const w of (warnings ?? []) as Record<string, unknown>[]) {
    const key = w.pre_settlement_id as string;
    pending.set(key, (pending.get(key) ?? 0) + 1);
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
