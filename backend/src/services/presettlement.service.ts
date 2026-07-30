import { supabaseAdmin } from '../config/supabase.js';

interface NormalizedEntry {
  id: string;
  profile_id: string;
  date: string;
  normalized_in: string;
  normalized_out: string;
  daytime_hours: number;
  nighttime_hours: number;
  clock_entries?: { client_id: string | null };
}

interface OvertimeEntry {
  id: string;
  date: string;
  hours: number;
  start_time: string | null;
  end_time: string | null;
  client_id: string | null;
}

interface AgentRate {
  amount_per_hour: number;
  effective_from: string;
}

interface RateFactors {
  nighttime: number;
  overtime: number;
  holiday: number;
  weekend: number;
}

interface ScheduleEntry {
  day_of_week: number;
  start_time: string;
  end_time: string;
  client_id: string;
  effective_from: string;
  effective_until: string | null;
}

interface DailyLine {
  date: string;
  hour_type: string;
  hours: number;
  rate_per_hour: number;
  amount: number;
  is_projected: boolean;
  client_id: string | null;
}

interface SettlementItem {
  concept: string;
  description: string | null;
  amount: number;
  is_percentage: boolean;
  percentage_base: string | null;
}

const NIGHTTIME_START_MIN = 22 * 60; // 22:00
const NIGHTTIME_END_MIN = 6 * 60;   // 06:00

function timeToMinutes(time: string): number {
  const parts = time.split(':');
  return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

/**
 * Get the base rate for a profile (most recent effective_from <= date)
 */
function findBaseRate(
  rates: AgentRate[],
  date: string,
): number {
  const matching = rates
    .filter(r => r.effective_from <= date)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from));

  return matching[0]?.amount_per_hour || 0;
}

/**
 * Compute the effective rate by applying global factors to the base rate.
 * Factors are multiplicative when combined (e.g., overtime + nighttime = base × overtime × nighttime).
 */
function computeRate(
  baseRate: number,
  factors: RateFactors,
  options: { isNighttime?: boolean; isOvertime?: boolean; isHoliday?: boolean; isWeekend?: boolean }
): number {
  let rate = baseRate;
  if (options.isHoliday) rate *= factors.holiday;
  if (options.isWeekend) rate *= factors.weekend;
  if (options.isOvertime) rate *= factors.overtime;
  if (options.isNighttime) rate *= factors.nighttime;
  return Math.round(rate * 100) / 100;
}

/**
 * Check if a date is a holiday
 */
async function isHoliday(date: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('holidays')
    .select('id')
    .eq('date', date)
    .limit(1);

  return (data?.length || 0) > 0;
}

/**
 * Get active schedules for a profile on a date
 */
async function getSchedulesForDate(
  profileId: string,
  date: string
): Promise<ScheduleEntry[]> {
  const dayOfWeek = new Date(date + 'T12:00:00').getDay();

  const { data } = await supabaseAdmin
    .from('schedules')
    .select('*')
    .eq('profile_id', profileId)
    .eq('day_of_week', dayOfWeek)
    .lte('effective_from', date)
    .or(`effective_until.is.null,effective_until.gte.${date}`)
    .order('start_time');

  return (data as ScheduleEntry[]) || [];
}

/**
 * Calculate projected hours from schedule for a date
 */
function projectFromSchedule(schedule: ScheduleEntry): { daytime: number; nighttime: number } {
  const start = timeToMinutes(schedule.start_time);
  const end = timeToMinutes(schedule.end_time);
  const totalMin = end - start;
  if (totalMin <= 0) return { daytime: 0, nighttime: 0 };

  let nightMin = 0;
  if (start < NIGHTTIME_END_MIN) {
    nightMin += Math.min(end, NIGHTTIME_END_MIN) - start;
  }
  if (end > NIGHTTIME_START_MIN) {
    nightMin += end - Math.max(start, NIGHTTIME_START_MIN);
  }

  const dayMin = totalMin - nightMin;
  return {
    daytime: Math.round((dayMin / 60) * 100) / 100,
    nighttime: Math.round((nightMin / 60) * 100) / 100,
  };
}

/**
 * Classify overtime hours into daytime/nighttime based on start_time
 */
function classifyOvertimeHours(ot: OvertimeEntry): { daytime: number; nighttime: number } {
  if (ot.start_time && ot.end_time) {
    const start = timeToMinutes(ot.start_time);
    const end = timeToMinutes(ot.end_time);
    const totalMin = end - start;
    if (totalMin <= 0) return { daytime: ot.hours, nighttime: 0 };

    let nightMin = 0;
    if (start < NIGHTTIME_END_MIN) nightMin += Math.min(end, NIGHTTIME_END_MIN) - start;
    if (end > NIGHTTIME_START_MIN) nightMin += end - Math.max(start, NIGHTTIME_START_MIN);

    const nightRatio = nightMin / totalMin;
    return {
      daytime: Math.round(ot.hours * (1 - nightRatio) * 100) / 100,
      nighttime: Math.round(ot.hours * nightRatio * 100) / 100,
    };
  }

  // If no times provided, assume all daytime
  return { daytime: ot.hours, nighttime: 0 };
}

/**
 * Get exception for a profile and date
 */
async function getExceptionForDate(
  profileId: string,
  date: string
): Promise<{ exception_type: string; client_id: string | null } | null> {
  const { data } = await supabaseAdmin
    .from('exceptions')
    .select('exception_type, client_id')
    .eq('profile_id', profileId)
    .lte('date_from', date)
    .gte('date_to', date)
    .limit(1);

  return data?.[0] || null;
}

/**
 * Generate pre-settlement for a profile and period
 */
export async function generatePreSettlement(
  profileId: string,
  periodFrom: string,
  periodTo: string,
  createdBy: string
): Promise<{ preSettlement: Record<string, unknown>; dailyLines: DailyLine[]; items: SettlementItem[] }> {
  // Fetch all rates for this profile
  const { data: rates } = await supabaseAdmin
    .from('agent_rates')
    .select('amount_per_hour, effective_from')
    .eq('profile_id', profileId)
    .order('effective_from', { ascending: false });

  const agentRates = (rates as AgentRate[]) || [];

  // Fetch global rate factors
  const { data: factorsRaw } = await supabaseAdmin
    .from('rate_factors')
    .select('factor_key, factor_value');

  const factors: RateFactors = { nighttime: 1.06, overtime: 1.5, holiday: 2.0, weekend: 1.0 };
  for (const f of (factorsRaw || []) as { factor_key: string; factor_value: number }[]) {
    if (f.factor_key in factors) {
      factors[f.factor_key as keyof RateFactors] = Number(f.factor_value);
    }
  }

  // Fetch normalized entries
  const { data: normalizedRaw } = await supabaseAdmin
    .from('normalized_entries')
    .select('*, clock_entries(client_id)')
    .eq('profile_id', profileId)
    .gte('date', periodFrom)
    .lte('date', periodTo)
    .order('date');

  const normalized = (normalizedRaw as NormalizedEntry[]) || [];

  // Fetch overtime entries
  const { data: overtimeRaw } = await supabaseAdmin
    .from('overtime')
    .select('*')
    .eq('profile_id', profileId)
    .gte('date', periodFrom)
    .lte('date', periodTo);

  const overtimeEntries = (overtimeRaw as OvertimeEntry[]) || [];

  // Build date range
  const today = new Date().toISOString().split('T')[0];
  const dates: string[] = [];
  const current = new Date(periodFrom + 'T12:00:00');
  const end = new Date(periodTo + 'T12:00:00');
  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }

  const dailyLines: DailyLine[] = [];
  let vacationDaytimeHours = 0;
  let vacationNighttimeHours = 0;

  for (const date of dates) {
    const dayOfWeek = new Date(date + 'T12:00:00').getDay();
    const holiday = await isHoliday(date);
    const exception = await getExceptionForDate(profileId, date);
    const isProjected = date > today;

    // Skip if absence
    if (exception?.exception_type === 'absence') continue;

    // Handle vacation: calculate as if worked normally
    const isVacation = exception?.exception_type === 'vacation';

    // Get normalized entries for this date (actual work)
    const dayNormalized = normalized.filter(n => n.date === date);

    let daytimeHours = 0;
    let nighttimeHours = 0;
    let clientId: string | null = null;

    if (!isProjected && dayNormalized.length > 0 && !isVacation) {
      // Use actual normalized data
      for (const entry of dayNormalized) {
        daytimeHours += entry.daytime_hours;
        nighttimeHours += entry.nighttime_hours;
        clientId = entry.clock_entries?.client_id || clientId;
      }
    } else {
      // Project from schedule (future dates, vacations, or no clock data)
      const schedules = await getSchedulesForDate(profileId, date);
      for (const sched of schedules) {
        const projected = projectFromSchedule(sched);
        daytimeHours += projected.daytime;
        nighttimeHours += projected.nighttime;
        clientId = sched.client_id || clientId;
      }
    }

    if (isVacation) {
      vacationDaytimeHours += daytimeHours;
      vacationNighttimeHours += nighttimeHours;
    }

    // Determine hour type prefix based on holiday
    const typePrefix = holiday ? 'holiday' : 'regular';
    const baseRate = findBaseRate(agentRates, date);
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    // Add daytime line
    if (daytimeHours > 0) {
      const rate = computeRate(baseRate, factors, { isHoliday: holiday, isWeekend });
      dailyLines.push({
        date,
        hour_type: `${typePrefix}_daytime`,
        hours: daytimeHours,
        rate_per_hour: rate,
        amount: Math.round(daytimeHours * rate * 100) / 100,
        is_projected: isProjected || isVacation,
        client_id: clientId,
      });
    }

    // Add nighttime line
    if (nighttimeHours > 0) {
      const rate = computeRate(baseRate, factors, { isNighttime: true, isHoliday: holiday, isWeekend });
      dailyLines.push({
        date,
        hour_type: `${typePrefix}_nighttime`,
        hours: nighttimeHours,
        rate_per_hour: rate,
        amount: Math.round(nighttimeHours * rate * 100) / 100,
        is_projected: isProjected || isVacation,
        client_id: clientId,
      });
    }

    // Add overtime lines for this date
    const dayOvertime = overtimeEntries.filter(ot => ot.date === date);
    for (const ot of dayOvertime) {
      const classified = classifyOvertimeHours(ot);

      if (classified.daytime > 0) {
        const otRate = computeRate(baseRate, factors, { isOvertime: true, isHoliday: holiday, isWeekend });
        dailyLines.push({
          date,
          hour_type: 'overtime_daytime',
          hours: classified.daytime,
          rate_per_hour: otRate,
          amount: Math.round(classified.daytime * otRate * 100) / 100,
          is_projected: false,
          client_id: ot.client_id,
        });
      }

      if (classified.nighttime > 0) {
        const otRate = computeRate(baseRate, factors, { isOvertime: true, isNighttime: true, isHoliday: holiday, isWeekend });
        dailyLines.push({
          date,
          hour_type: 'overtime_nighttime',
          hours: classified.nighttime,
          rate_per_hour: otRate,
          amount: Math.round(classified.nighttime * otRate * 100) / 100,
          is_projected: false,
          client_id: ot.client_id,
        });
      }
    }
  }

  // Calculate total from daily lines
  const subtotal = dailyLines.reduce((sum, l) => sum + l.amount, 0);

  // Build standard items
  const items: SettlementItem[] = [];

  // Fetch active settlement rules to generate items
  const { data: rules } = await supabaseAdmin
    .from('settlement_rules')
    .select('*')
    .eq('is_active', true);

  // Add vacation plus if there are vacation hours
  if (vacationDaytimeHours > 0 || vacationNighttimeHours > 0) {
    const vacationTotal = dailyLines
      .filter(l => l.is_projected) // vacation lines are marked as projected
      .reduce((sum, l) => sum + l.amount, 0);

    // Check if there's a rule for vacation plus
    const vacRule = (rules || []).find((r: Record<string, unknown>) =>
      (r.name as string).toLowerCase().includes('vacacion') ||
      (r.name as string).toLowerCase().includes('vacation')
    );

    if (vacRule) {
      items.push({
        concept: 'plus_vacacional',
        description: `Plus vacacional - ${vacRule.description || ''}`,
        amount: 0, // To be set by liquidator or rule
        is_percentage: true,
        percentage_base: 'vacation_hours',
      });
    }
  }

  // Add presentismo item
  items.push({
    concept: 'presentismo',
    description: 'Premio por presentismo',
    amount: 0, // To be configured
    is_percentage: false,
    percentage_base: null,
  });

  const totalAmount = Math.round((subtotal + items.reduce((s, i) => s + i.amount, 0)) * 100) / 100;

  // Create the pre-settlement record
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

  // Insert daily lines
  if (dailyLines.length > 0) {
    const dailyWithId = dailyLines.map(l => ({
      ...l,
      pre_settlement_id: preSettlement.id,
    }));

    const { error: dlError } = await supabaseAdmin
      .from('pre_settlement_daily')
      .insert(dailyWithId);

    if (dlError) throw new Error(`Failed to insert daily lines: ${dlError.message}`);
  }

  // Insert items
  if (items.length > 0) {
    const itemsWithId = items.map(i => ({
      ...i,
      pre_settlement_id: preSettlement.id,
    }));

    const { error: itemError } = await supabaseAdmin
      .from('pre_settlement_items')
      .insert(itemsWithId);

    if (itemError) throw new Error(`Failed to insert items: ${itemError.message}`);
  }

  return { preSettlement, dailyLines, items };
}

/**
 * Get pre-settlement with full detail
 */
export async function getPreSettlementDetail(preSettlementId: string) {
  const { data: ps, error: psError } = await supabaseAdmin
    .from('pre_settlements')
    .select('*, profiles!pre_settlements_profile_id_fkey(first_name, last_name, employee_id)')
    .eq('id', preSettlementId)
    .single();

  if (psError) throw new Error(psError.message);

  const { data: daily } = await supabaseAdmin
    .from('pre_settlement_daily')
    .select('*, clients(name)')
    .eq('pre_settlement_id', preSettlementId)
    .order('date')
    .order('hour_type');

  const { data: items } = await supabaseAdmin
    .from('pre_settlement_items')
    .select('*')
    .eq('pre_settlement_id', preSettlementId)
    .order('created_at');

  // Fetch clock entries and normalized entries for the period to build time info
  const { data: clockEntries } = await supabaseAdmin
    .from('clock_entries')
    .select('date, clock_in, clock_out')
    .eq('profile_id', ps.profile_id)
    .gte('date', ps.period_from)
    .lte('date', ps.period_to)
    .order('date')
    .order('clock_in');

  const { data: normalizedEntries } = await supabaseAdmin
    .from('normalized_entries')
    .select('date, normalized_in, normalized_out')
    .eq('profile_id', ps.profile_id)
    .gte('date', ps.period_from)
    .lte('date', ps.period_to)
    .order('date')
    .order('normalized_in');

  // Build lookup maps by date
  const clockByDate: Record<string, { clock_in: string; clock_out: string | null }[]> = {};
  for (const ce of clockEntries || []) {
    if (!clockByDate[ce.date]) clockByDate[ce.date] = [];
    clockByDate[ce.date].push({ clock_in: ce.clock_in, clock_out: ce.clock_out });
  }

  const normByDate: Record<string, { normalized_in: string; normalized_out: string }[]> = {};
  for (const ne of normalizedEntries || []) {
    if (!normByDate[ne.date]) normByDate[ne.date] = [];
    normByDate[ne.date].push({ normalized_in: ne.normalized_in, normalized_out: ne.normalized_out });
  }

  // Enrich daily lines with time info
  const today = new Date().toISOString().split('T')[0];
  const uniqueDates = [...new Set((daily || []).map(l => l.date))];
  const datesWithoutNormalization: string[] = [];

  for (const date of uniqueDates) {
    const hasClock = Boolean(clockByDate[date]?.length);
    const hasNorm = Boolean(normByDate[date]?.length);
    if (hasClock && !hasNorm && date <= today) {
      datesWithoutNormalization.push(date);
    }
  }

  const enrichedDaily = (daily || []).map((line: Record<string, unknown>) => ({
    ...line,
    clock_times: clockByDate[line.date as string] || null,
    normalized_times: normByDate[line.date as string] || null,
  }));

  // Calculate totals by hour type
  const totalsByType: Record<string, { hours: number; amount: number }> = {};
  for (const line of daily || []) {
    if (!totalsByType[line.hour_type]) {
      totalsByType[line.hour_type] = { hours: 0, amount: 0 };
    }
    totalsByType[line.hour_type].hours += line.hours;
    totalsByType[line.hour_type].amount += line.amount;
  }

  const hasProjected = (daily || []).some((l: Record<string, unknown>) => l.is_projected);

  return {
    ...ps,
    daily: enrichedDaily,
    items: items || [],
    totals_by_type: totalsByType,
    warnings: {
      has_projected: hasProjected,
      dates_without_normalization: datesWithoutNormalization,
    },
  };
}

/**
 * Update a daily line (hours and/or rate), recalculate amount
 */
export async function updateDailyLine(
  lineId: string,
  updates: { hours?: number; rate_per_hour?: number }
) {
  // Get current line
  const { data: current } = await supabaseAdmin
    .from('pre_settlement_daily')
    .select('*')
    .eq('id', lineId)
    .single();

  if (!current) throw new Error('Daily line not found');

  const hours = updates.hours ?? current.hours;
  const rate = updates.rate_per_hour ?? current.rate_per_hour;
  const amount = Math.round(hours * rate * 100) / 100;

  const { data, error } = await supabaseAdmin
    .from('pre_settlement_daily')
    .update({ hours, rate_per_hour: rate, amount })
    .eq('id', lineId)
    .select()
    .single();

  if (error) throw new Error(error.message);

  // Recalculate total
  await recalculateTotal(current.pre_settlement_id);

  return data;
}

/**
 * Add, update, or delete settlement items
 */
export async function addItem(
  preSettlementId: string,
  item: SettlementItem
) {
  const { data, error } = await supabaseAdmin
    .from('pre_settlement_items')
    .insert({ ...item, pre_settlement_id: preSettlementId })
    .select()
    .single();

  if (error) throw new Error(error.message);

  await recalculateTotal(preSettlementId);
  return data;
}

export async function updateItem(
  itemId: string,
  updates: Partial<SettlementItem>
) {
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

  const { error } = await supabaseAdmin
    .from('pre_settlement_items')
    .delete()
    .eq('id', itemId);

  if (error) throw new Error(error.message);

  await recalculateTotal(current.pre_settlement_id);
}

/**
 * Recalculate the total amount for a pre-settlement
 */
async function recalculateTotal(preSettlementId: string) {
  const { data: daily } = await supabaseAdmin
    .from('pre_settlement_daily')
    .select('amount')
    .eq('pre_settlement_id', preSettlementId);

  const { data: items } = await supabaseAdmin
    .from('pre_settlement_items')
    .select('amount')
    .eq('pre_settlement_id', preSettlementId);

  const dailyTotal = (daily || []).reduce((sum: number, d: { amount: number }) => sum + d.amount, 0);
  const itemsTotal = (items || []).reduce((sum: number, i: { amount: number }) => sum + i.amount, 0);
  const total = Math.round((dailyTotal + itemsTotal) * 100) / 100;

  await supabaseAdmin
    .from('pre_settlements')
    .update({ total_amount: total })
    .eq('id', preSettlementId);
}

/**
 * List pre-settlements for a profile
 */
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
 * Update pre-settlement status
 */
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
