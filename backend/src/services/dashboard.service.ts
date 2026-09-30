import { supabaseAdmin } from '../config/supabase.js';
import { localToday } from '../config/time.js';
import { addDays } from './settlement-calc.js';

/**
 * Lo que hay pendiente de hacer, para que la pantalla de inicio diga algo en vez
 * de repetir el menú lateral.
 */
export interface DashboardSummary {
  active_agents: number;
  draft_settlements: number;
  /** Días que no cierran contra el plan, en borradores. Un día con dos motivos cuenta una vez */
  days_to_normalize: number;
  /** Los mismos días por mes (YYYY-MM), del más viejo al más nuevo */
  to_normalize_by_month: { month: string; days: number }[];
  /** Agentes con esquema hoy que todavía no marcaron ingreso */
  missing_clock_in_today: { profile_id: string; name: string; starts_at: string }[];
  /** Marcaciones abiertas: entraron y nunca marcaron la salida */
  open_clock_entries: { profile_id: string; name: string; date: string; clock_in: string }[];
  /** Configuración incompleta que va a romper la preliquidación */
  agents_without_schedule: { profile_id: string; name: string }[];
  agents_without_rate: { profile_id: string; name: string }[];
}

interface ProfileRow {
  id: string;
  first_name: string;
  last_name: string;
}

const fullName = (p: ProfileRow) => `${p.last_name}, ${p.first_name}`;

export async function getDashboardSummary(): Promise<DashboardSummary> {
  // Hoy en Buenos Aires, no en la zona del servidor
  const today = localToday();
  const dayOfWeek = new Date(today + 'T12:00:00').getDay();

  // Ventana corta para las marcaciones abiertas: más atrás que esto ya no es
  // "se olvidó de marcar", es historia que hay que corregir desde Marcaciones.
  const since = addDays(today, -14);

  const [
    { data: agents },
    { count: draftCount },
    { data: blockingWarnings },
    { data: schedulesToday },
    { data: clockToday },
    { data: openEntries },
    { data: allSchedules },
    { data: allRates },
  ] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('id, first_name, last_name')
      .eq('role', 'agent')
      .eq('is_active', true)
      .order('last_name'),
    supabaseAdmin
      .from('pre_settlements')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'draft'),
    supabaseAdmin
      .from('pre_settlement_warnings')
      .select('pre_settlement_id, date, pre_settlements!inner(period_to, status)')
      .eq('status', 'pending')
      // Sólo cuenta lo que hay que resolver: los informativos no frenan nada, y
      // la evaluación faltante no es un día
      .eq('blocking', true)
      .neq('code', 'missing_period_params')
      .eq('pre_settlements.status', 'draft'),
    supabaseAdmin
      .from('schedules')
      .select('profile_id, start_time')
      .eq('day_of_week', dayOfWeek)
      .lte('effective_from', today)
      .or(`effective_until.is.null,effective_until.gte.${today}`),
    supabaseAdmin.from('clock_entries').select('profile_id').eq('date', today),
    supabaseAdmin
      .from('clock_entries')
      .select('profile_id, date, clock_in')
      .is('clock_out', null)
      .gte('date', since)
      .lt('date', today)
      .order('date'),
    supabaseAdmin.from('schedules').select('profile_id'),
    supabaseAdmin.from('agent_rates').select('profile_id'),
  ]);

  const profiles = (agents ?? []) as ProfileRow[];
  const byId = new Map(profiles.map((p) => [p.id, p]));

  // ── Quién debería estar trabajando hoy y no marcó ──
  const earliestStart = new Map<string, string>();
  for (const s of ((schedulesToday ?? []) as { profile_id: string; start_time: string }[])) {
    const cur = earliestStart.get(s.profile_id);
    if (!cur || s.start_time < cur) earliestStart.set(s.profile_id, s.start_time);
  }

  const clockedToday = new Set(
    ((clockToday ?? []) as { profile_id: string }[]).map((c) => c.profile_id)
  );

  const missingClockInToday = [...earliestStart.entries()]
    .filter(([id]) => byId.has(id) && !clockedToday.has(id))
    .map(([id, startsAt]) => ({
      profile_id: id,
      name: fullName(byId.get(id)!),
      starts_at: startsAt.slice(0, 5),
    }))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  // ── Marcaciones que quedaron abiertas ──
  const openClockEntries = ((openEntries ?? []) as {
    profile_id: string;
    date: string;
    clock_in: string;
  }[])
    .filter((e) => byId.has(e.profile_id))
    .map((e) => ({
      profile_id: e.profile_id,
      name: fullName(byId.get(e.profile_id)!),
      date: e.date,
      clock_in: e.clock_in.slice(0, 5),
    }));

  // ── Días a normalizar, por mes ──
  // El mes de un período es el de su último día: con corte el 21, "octubre" va
  // del 21/09 al 20/10
  const dias = new Map<string, Set<string>>();
  for (const w of (blockingWarnings ?? []) as unknown as {
    pre_settlement_id: string;
    date: string;
    pre_settlements: { period_to: string };
  }[]) {
    const month = w.pre_settlements.period_to.slice(0, 7);
    const set = dias.get(month) ?? new Set<string>();
    set.add(`${w.pre_settlement_id}|${w.date}`);
    dias.set(month, set);
  }
  const toNormalizeByMonth = [...dias.entries()]
    .map(([month, set]) => ({ month, days: set.size }))
    .sort((a, b) => a.month.localeCompare(b.month));

  // ── Configuración incompleta ──
  const withSchedule = new Set(
    ((allSchedules ?? []) as { profile_id: string }[]).map((s) => s.profile_id)
  );
  const withRate = new Set(
    ((allRates ?? []) as { profile_id: string }[]).map((r) => r.profile_id)
  );

  return {
    active_agents: profiles.length,
    draft_settlements: draftCount ?? 0,
    days_to_normalize: toNormalizeByMonth.reduce((s, m) => s + m.days, 0),
    to_normalize_by_month: toNormalizeByMonth,
    missing_clock_in_today: missingClockInToday,
    open_clock_entries: openClockEntries,
    agents_without_schedule: profiles
      .filter((p) => !withSchedule.has(p.id))
      .map((p) => ({ profile_id: p.id, name: fullName(p) })),
    agents_without_rate: profiles
      .filter((p) => !withRate.has(p.id))
      .map((p) => ({ profile_id: p.id, name: fullName(p) })),
  };
}
