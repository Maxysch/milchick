import { supabaseAdmin } from '../config/supabase.js';
import {
  buildDailyLines,
  compareAgainstClockIns,
  computeConcepts,
  computeRate,
  roundCents,
  settlementPeriod,
  timeToMinutes,
  DEFAULT_RATE_FACTORS,
  DEFAULT_SETTLEMENT_PARAMS,
  type ClockObservation,
  type DayContext,
  type DayExceptionType,
  type OvertimeRecord,
  type RateFactors,
  type ScheduleSlot,
  type SettlementParams,
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

async function fetchSettlementParams(profileId: string): Promise<SettlementParams> {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select(
      'reg_people_pct, reg_quantitative_pct, reg_qualitative_pct, super_reg_pct, ' +
        'equipment_pct, seniority_months, holiday_compensation_factor, vacation_plus_factor'
    )
    .eq('id', profileId)
    .single();

  const row = data as Record<keyof SettlementParams, number | null> | null;
  if (!row) return { ...DEFAULT_SETTLEMENT_PARAMS };

  return {
    reg_people_pct: Number(row.reg_people_pct ?? 0),
    reg_quantitative_pct: Number(row.reg_quantitative_pct ?? 0),
    reg_qualitative_pct: Number(row.reg_qualitative_pct ?? 0),
    super_reg_pct: Number(row.super_reg_pct ?? 0),
    equipment_pct: Number(row.equipment_pct ?? 0),
    seniority_months: Number(row.seniority_months ?? 0),
    holiday_compensation_factor: Number(row.holiday_compensation_factor ?? 0),
    vacation_plus_factor: Number(row.vacation_plus_factor ?? 0),
  };
}

/** Día de inicio del período de liquidación (26 por defecto). */
export async function fetchPeriodStartDay(): Promise<number> {
  const { data } = await supabaseAdmin
    .from('settlement_settings')
    .select('period_start_day')
    .limit(1)
    .maybeSingle();
  return Number(data?.period_start_day ?? 26);
}

/**
 * Genera la preliquidación de un agente para un período.
 *
 * Las horas salen del ESQUEMA vigente, no de las marcaciones. Las marcaciones se
 * contrastan aparte y producen advertencias para que quien liquida revise y
 * corrija los días que se desviaron. Los importes nunca se tocan solos.
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
}> {
  const dates = enumerateDates(periodFrom, periodTo);

  const [
    { data: ratesRaw },
    factors,
    params,
    { data: schedulesRaw },
    { data: exceptionsRaw },
    { data: holidaysRaw },
    { data: overtimeRaw },
    { data: clockRaw },
  ] = await Promise.all([
    supabaseAdmin
      .from('agent_rates')
      .select('amount_per_hour, effective_from')
      .eq('profile_id', profileId)
      .order('effective_from', { ascending: false }),
    fetchRateFactors(),
    fetchSettlementParams(profileId),
    supabaseAdmin
      .from('schedules')
      .select('day_of_week, start_time, end_time, client_id, effective_from, effective_until')
      .eq('profile_id', profileId)
      .lte('effective_from', periodTo)
      .or(`effective_until.is.null,effective_until.gte.${periodFrom}`)
      .order('start_time'),
    supabaseAdmin
      .from('exceptions')
      .select('exception_type, date_from, date_to')
      .eq('profile_id', profileId)
      .lte('date_from', periodTo)
      .gte('date_to', periodFrom),
    supabaseAdmin.from('holidays').select('date').gte('date', periodFrom).lte('date', periodTo),
    supabaseAdmin
      .from('overtime')
      .select('date, hours, start_time, end_time, tier, client_id')
      .eq('profile_id', profileId)
      .gte('date', periodFrom)
      .lte('date', periodTo),
    supabaseAdmin
      .from('clock_entries')
      .select('date, clock_in, clock_out')
      .eq('profile_id', profileId)
      .gte('date', periodFrom)
      .lte('date', periodTo)
      .order('date')
      .order('clock_in'),
  ]);

  const agentRates = (ratesRaw as AgentRate[]) ?? [];
  const schedules = (schedulesRaw as ScheduleRow[]) ?? [];
  const holidays = new Set(((holidaysRaw as { date: string }[]) ?? []).map((h) => h.date));

  // Excepciones indexadas por fecha
  const exceptionByDate = new Map<string, DayExceptionType>();
  for (const e of ((exceptionsRaw as { exception_type: DayExceptionType; date_from: string; date_to: string }[]) ?? [])) {
    for (const d of enumerateDates(e.date_from, e.date_to)) {
      if (d >= periodFrom && d <= periodTo) exceptionByDate.set(d, e.exception_type);
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

  const built = buildDailyLines({ days, schedulesByDate, overtime });

  // ── Importes ──
  const today = new Date().toISOString().split('T')[0];
  const dailyLines: PersistedDailyLine[] = built.lines.map((line) => {
    const baseRate = findBaseRate(agentRates, line.date);
    const rate = computeRate(baseRate, line.band, line.tier, factors);
    return {
      date: line.date,
      band: line.band,
      tier: line.tier,
      hours: line.hours,
      rate_per_hour: rate,
      amount: line.hours * rate,
      // Proyectado = todavía no ocurrió, o se pagó sin marcación de respaldo
      is_projected: line.date > today || line.source === 'exception',
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
    is_percentage: false,
    percentage_base: null,
  }));

  // ── Advertencias contra las marcaciones ──
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

  const warnings = compareAgainstClockIns(days, schedulesByDate, observations);
  for (const date of built.absenceDates) {
    warnings.push({ date, code: 'no_clock_in', detail: 'Ausencia: no se liquidan horas' });
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

  return { preSettlement, dailyLines, items, warnings };
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

  const [{ data: daily }, { data: items }, { data: clockEntries }] = await Promise.all([
    supabaseAdmin
      .from('pre_settlement_daily')
      .select('*, clients(name)')
      .eq('pre_settlement_id', preSettlementId)
      .order('date')
      .order('band'),
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
  ]);

  const clockByDate: Record<string, { clock_in: string; clock_out: string | null }[]> = {};
  for (const ce of clockEntries ?? []) {
    (clockByDate[ce.date] ??= []).push({ clock_in: ce.clock_in, clock_out: ce.clock_out });
  }

  const enrichedDaily = (daily ?? []).map((line: Record<string, unknown>) => ({
    ...line,
    clock_times: clockByDate[line.date as string] ?? null,
  }));

  // Totales por banda × tramo
  const totalsByType: Record<string, { hours: number; amount: number }> = {};
  for (const line of daily ?? []) {
    const key = `${line.band}:${line.tier}`;
    (totalsByType[key] ??= { hours: 0, amount: 0 });
    totalsByType[key].hours += Number(line.hours);
    totalsByType[key].amount += Number(line.amount);
  }

  // Días pagados por esquema sin marcación de respaldo
  const today = new Date().toISOString().split('T')[0];
  const datesWithoutClockIn = [...new Set((daily ?? []).map((l) => l.date as string))]
    .filter((date) => date <= today && !clockByDate[date]?.length);

  return {
    ...ps,
    daily: enrichedDaily,
    items: items ?? [],
    totals_by_type: totalsByType,
    warnings: {
      has_projected: (daily ?? []).some((l: Record<string, unknown>) => l.is_projected),
      dates_without_clock_in: datesWithoutClockIn,
    },
  };
}

/** Edita horas y/o tarifa de una línea diaria y recalcula el importe. */
export async function updateDailyLine(
  lineId: string,
  updates: { hours?: number; rate_per_hour?: number }
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
    .update({ hours, rate_per_hour: rate, amount: hours * rate, source: 'manual' })
    .eq('id', lineId)
    .select()
    .single();

  if (error) throw new Error(error.message);

  await recalculateTotal(current.pre_settlement_id);

  return data;
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

async function recalculateTotal(preSettlementId: string) {
  const [{ data: daily }, { data: items }] = await Promise.all([
    supabaseAdmin.from('pre_settlement_daily').select('amount').eq('pre_settlement_id', preSettlementId),
    supabaseAdmin.from('pre_settlement_items').select('amount').eq('pre_settlement_id', preSettlementId),
  ]);

  const dailyTotal = (daily ?? []).reduce((sum, d: { amount: number }) => sum + Number(d.amount), 0);
  const itemsTotal = (items ?? []).reduce((sum, i: { amount: number }) => sum + Number(i.amount), 0);

  await supabaseAdmin
    .from('pre_settlements')
    .update({ total_amount: roundCents(dailyTotal + itemsTotal) })
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
