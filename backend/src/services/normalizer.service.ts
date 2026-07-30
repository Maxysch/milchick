import { supabaseAdmin } from '../config/supabase.js';

interface ClockEntry {
  id: string;
  profile_id: string;
  date: string;
  clock_in: string;
  clock_out: string | null;
  client_id: string | null;
}

interface ScheduleEntry {
  id: string;
  profile_id: string;
  client_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  effective_from: string;
  effective_until: string | null;
}

interface NormalizationResult {
  clock_entry_id: string;
  profile_id: string;
  date: string;
  normalized_in: string;
  normalized_out: string;
  daytime_hours: number;
  nighttime_hours: number;
  adjustments: Record<string, unknown>[];
  previously_normalized?: boolean;
  id?: string;
}

// Configurable boundary between daytime and nighttime (24h format)
const NIGHTTIME_START = '22:00';
const NIGHTTIME_END = '06:00';

/**
 * Parse "HH:mm" or "HH:mm:ss" to minutes since midnight
 */
function timeToMinutes(time: string): number {
  const parts = time.split(':');
  return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

/**
 * Convert minutes since midnight back to "HH:mm"
 */
function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

/**
 * Calculate daytime and nighttime hours between two times on the same day.
 * Nighttime: 22:00 to 06:00 (next day handled as same-day boundary)
 */
function splitDaytimeNighttime(
  startMin: number,
  endMin: number
): { daytime: number; nighttime: number } {
  const nightStart = timeToMinutes(NIGHTTIME_START);
  const nightEnd = timeToMinutes(NIGHTTIME_END);
  const totalMinutes = endMin - startMin;

  if (totalMinutes <= 0) return { daytime: 0, nighttime: 0 };

  let nighttimeMinutes = 0;

  // Night period 1: 00:00 to NIGHTTIME_END (early morning)
  if (startMin < nightEnd) {
    const overlapEnd = Math.min(endMin, nightEnd);
    nighttimeMinutes += Math.max(0, overlapEnd - startMin);
  }

  // Night period 2: NIGHTTIME_START to 24:00
  if (endMin > nightStart) {
    const overlapStart = Math.max(startMin, nightStart);
    nighttimeMinutes += Math.max(0, endMin - overlapStart);
  }

  const daytimeMinutes = totalMinutes - nighttimeMinutes;

  return {
    daytime: Math.round((daytimeMinutes / 60) * 100) / 100,
    nighttime: Math.round((nighttimeMinutes / 60) * 100) / 100,
  };
}

/**
 * Find the active schedule entries for a profile on a given date
 */
async function getActiveSchedules(
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
 * Normalize a single clock entry against the schedule.
 *
 * Rules applied:
 * 1. If clock_in is before schedule start (setup time), adjust to schedule start
 * 2. If clock_out is after schedule end (lingering), adjust to schedule end
 * 3. If no matching schedule, keep original times but flag as unmatched
 */
function normalizeAgainstSchedule(
  entry: ClockEntry,
  schedules: ScheduleEntry[]
): NormalizationResult {
  const adjustments: Record<string, unknown>[] = [];
  let normalizedIn = entry.clock_in;
  let normalizedOut = entry.clock_out || entry.clock_in;

  const entryInMin = timeToMinutes(entry.clock_in);
  const entryOutMin = entry.clock_out ? timeToMinutes(entry.clock_out) : entryInMin;

  // Find the best matching schedule (by client or by time overlap)
  const matchingSchedule = schedules.find(s =>
    entry.client_id ? s.client_id === entry.client_id : true
  ) || schedules[0];

  if (matchingSchedule) {
    const schedStart = timeToMinutes(matchingSchedule.start_time);
    const schedEnd = timeToMinutes(matchingSchedule.end_time);

    // Rule 1: Trim early clock-in (setup time)
    if (entryInMin < schedStart) {
      const diff = schedStart - entryInMin;
      normalizedIn = matchingSchedule.start_time;
      adjustments.push({
        type: 'early_clockin_trimmed',
        original: entry.clock_in,
        adjusted: normalizedIn,
        minutes_trimmed: diff,
        reason: 'Clock-in before schedule start (setup time)',
      });
    }

    // Rule 2: Trim late clock-out
    if (entryOutMin > schedEnd && schedEnd > schedStart) {
      const diff = entryOutMin - schedEnd;
      normalizedOut = matchingSchedule.end_time;
      adjustments.push({
        type: 'late_clockout_trimmed',
        original: entry.clock_out,
        adjusted: normalizedOut,
        minutes_trimmed: diff,
        reason: 'Clock-out after schedule end',
      });
    }
  } else {
    adjustments.push({
      type: 'no_matching_schedule',
      reason: 'No active schedule found for this date/client',
    });
  }

  const normInMin = timeToMinutes(normalizedIn);
  const normOutMin = timeToMinutes(normalizedOut);
  const { daytime, nighttime } = splitDaytimeNighttime(normInMin, normOutMin);

  return {
    clock_entry_id: entry.id,
    profile_id: entry.profile_id,
    date: entry.date,
    normalized_in: normalizedIn,
    normalized_out: normalizedOut,
    daytime_hours: daytime,
    nighttime_hours: nighttime,
    adjustments,
  };
}

/**
 * Normalize all clock entries for a profile in a date range.
 * If there are already persisted normalized entries for some dates,
 * those are returned as-is (marked previously_normalized) and not recalculated.
 */
export async function normalizeEntries(
  profileId: string,
  dateFrom: string,
  dateTo: string
): Promise<NormalizationResult[]> {
  // Fetch existing persisted entries for this range
  const { data: existingRaw } = await supabaseAdmin
    .from('normalized_entries')
    .select('*')
    .eq('profile_id', profileId)
    .gte('date', dateFrom)
    .lte('date', dateTo)
    .order('date')
    .order('normalized_in');

  const existing = (existingRaw || []) as Array<NormalizationResult & { id: string }>;
  const existingDates = new Set(existing.map(e => e.date));

  // Fetch clock entries
  const { data: entries } = await supabaseAdmin
    .from('clock_entries')
    .select('*')
    .eq('profile_id', profileId)
    .gte('date', dateFrom)
    .lte('date', dateTo)
    .order('date')
    .order('clock_in');

  const results: NormalizationResult[] = [];

  // Add previously normalized entries first
  for (const entry of existing) {
    results.push({ ...entry, previously_normalized: true });
  }

  // Normalize only clock entries for dates without existing normalization
  for (const entry of (entries as ClockEntry[]) || []) {
    if (existingDates.has(entry.date)) continue;

    const schedules = await getActiveSchedules(profileId, entry.date);
    const normalized = normalizeAgainstSchedule(entry, schedules);
    results.push({ ...normalized, previously_normalized: false });
  }

  // Sort by date then time
  results.sort((a, b) => a.date.localeCompare(b.date) || a.normalized_in.localeCompare(b.normalized_in));

  return results;
}

/**
 * Normalize and persist results.
 * Only recalculates and persists days that don't already have normalized entries.
 * Previously normalized days are returned as-is.
 */
export async function normalizeAndPersist(
  profileId: string,
  dateFrom: string,
  dateTo: string
): Promise<NormalizationResult[]> {
  const results = await normalizeEntries(profileId, dateFrom, dateTo);

  if (results.length === 0) return [];

  // Split into previously persisted vs new
  const newEntries = results.filter(r => !r.previously_normalized);

  if (newEntries.length > 0) {
    // Collect dates of new entries to delete any partial leftovers
    const newDates = [...new Set(newEntries.map(r => r.date))];

    for (const date of newDates) {
      await supabaseAdmin
        .from('normalized_entries')
        .delete()
        .eq('profile_id', profileId)
        .eq('date', date);
    }

    // Strip the previously_normalized flag before inserting
    const toInsert = newEntries.map(({ previously_normalized, ...rest }) => rest);

    const { data: inserted, error } = await supabaseAdmin
      .from('normalized_entries')
      .insert(toInsert)
      .select();

    if (error) throw new Error(`Failed to persist normalized entries: ${error.message}`);

    // Build a map of inserted entries by date+clock_entry_id for merging IDs back
    const insertedMap = new Map<string, NormalizationResult>();
    for (const row of (inserted || []) as NormalizationResult[]) {
      insertedMap.set(`${row.date}|${row.clock_entry_id}`, row);
    }

    // Merge IDs into the results
    return results.map(r => {
      if (r.previously_normalized) return r;
      const key = `${r.date}|${r.clock_entry_id}`;
      const persisted = insertedMap.get(key);
      return persisted ? { ...persisted, previously_normalized: false } : r;
    });
  }

  // All entries were previously normalized
  return results;
}

/**
 * Get persisted normalized entries for a profile and date range
 */
export async function getNormalizedEntries(
  profileId: string,
  dateFrom: string,
  dateTo: string
) {
  const { data, error } = await supabaseAdmin
    .from('normalized_entries')
    .select('*, clock_entries(clock_in, clock_out, client_id)')
    .eq('profile_id', profileId)
    .gte('date', dateFrom)
    .lte('date', dateTo)
    .order('date')
    .order('normalized_in');

  if (error) throw new Error(error.message);
  return data;
}

/**
 * Update a persisted normalized entry's times and recalculate hours
 */
export async function updateNormalizedEntry(
  entryId: string,
  updates: { normalized_in?: string; normalized_out?: string }
) {
  const { data: current, error: fetchError } = await supabaseAdmin
    .from('normalized_entries')
    .select('*')
    .eq('id', entryId)
    .single();

  if (fetchError || !current) throw new Error('Normalized entry not found');

  const normIn = updates.normalized_in ?? current.normalized_in;
  const normOut = updates.normalized_out ?? current.normalized_out;
  const normInMin = timeToMinutes(normIn);
  const normOutMin = timeToMinutes(normOut);
  const { daytime, nighttime } = splitDaytimeNighttime(normInMin, normOutMin);

  const adjustments = [...(current.adjustments ?? [])];
  // Track manual edit
  if (updates.normalized_in && updates.normalized_in !== current.normalized_in) {
    adjustments.push({
      type: 'manual_edit_in',
      original: current.normalized_in,
      adjusted: updates.normalized_in,
      reason: 'Manual correction by supervisor',
    });
  }
  if (updates.normalized_out && updates.normalized_out !== current.normalized_out) {
    adjustments.push({
      type: 'manual_edit_out',
      original: current.normalized_out,
      adjusted: updates.normalized_out,
      reason: 'Manual correction by supervisor',
    });
  }

  const { data, error } = await supabaseAdmin
    .from('normalized_entries')
    .update({
      normalized_in: normIn,
      normalized_out: normOut,
      daytime_hours: daytime,
      nighttime_hours: nighttime,
      adjustments,
    })
    .eq('id', entryId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update normalized entry: ${error.message}`);
  return data;
}
