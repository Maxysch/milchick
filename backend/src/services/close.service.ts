/**
 * Cierre del mes: todo lo que tiene que estar listo antes de pagar, en un solo
 * lugar y en el orden en que conviene resolverlo.
 */
import { supabaseAdmin } from '../config/supabase.js';
import {
  BusinessError,
  fetchPeriodStartDay,
  settlementPeriod,
  updatePreSettlementStatus,
} from './presettlement.service.js';

export interface CloseAgentRow {
  profile_id: string;
  name: string;
  has_schedule: boolean;
  has_rate: boolean;
  params_loaded: boolean;
  pre_settlement_id: string | null;
  status: 'sin_preliquidar' | 'draft' | 'confirmed';
  total: number | null;
  days_to_normalize: number;
  /** Tiene todo para confirmar */
  ready: boolean;
}

export async function getCloseStatus(year: number, month: number) {
  const startDay = await fetchPeriodStartDay();
  const period = settlementPeriod(year, month, startDay);

  const [{ data: agents }, { data: schedules }, { data: rates }, { data: params }, { data: pss }, { data: holidays }] =
    await Promise.all([
      supabaseAdmin.from('profiles').select('id, first_name, last_name').eq('role', 'agent').eq('is_active', true),
      supabaseAdmin
        .from('schedules')
        .select('profile_id')
        .lte('effective_from', period.to)
        .or(`effective_until.is.null,effective_until.gte.${period.from}`),
      supabaseAdmin.from('agent_rates').select('profile_id').lte('effective_from', period.to),
      supabaseAdmin.from('agent_period_params').select('profile_id').eq('year', year).eq('month', month),
      supabaseAdmin
        .from('pre_settlements')
        .select('id, profile_id, status, total_amount')
        .eq('period_from', period.from)
        .eq('period_to', period.to)
        .neq('status', 'cancelled'),
      supabaseAdmin.from('holidays').select('date, name').gte('date', period.from).lte('date', period.to).order('date'),
    ]);

  const ids = ((pss ?? []) as { id: string }[]).map((p) => p.id);
  const { data: warnings } = ids.length
    ? await supabaseAdmin
        .from('pre_settlement_warnings')
        .select('pre_settlement_id, date, code')
        .in('pre_settlement_id', ids)
        .eq('blocking', true)
        .eq('status', 'pending')
    : { data: [] };

  const set = (rows: { profile_id: string }[] | null) => new Set((rows ?? []).map((r) => r.profile_id));
  const conEsquema = set(schedules as { profile_id: string }[]);
  const conTarifa = set(rates as { profile_id: string }[]);
  const conEvaluacion = set(params as { profile_id: string }[]);
  const psByAgent = new Map(
    ((pss ?? []) as { id: string; profile_id: string; status: string; total_amount: number }[]).map((p) => [p.profile_id, p])
  );

  // Días por normalizar: sin contar el aviso de evaluación faltante, que ya se
  // muestra aparte
  const dias = new Map<string, Set<string>>();
  for (const w of (warnings ?? []) as { pre_settlement_id: string; date: string; code: string }[]) {
    if (w.code === 'missing_period_params') continue;
    const s = dias.get(w.pre_settlement_id) ?? new Set<string>();
    s.add(w.date);
    dias.set(w.pre_settlement_id, s);
  }

  const rows: CloseAgentRow[] = ((agents ?? []) as { id: string; first_name: string; last_name: string }[])
    .map((a) => {
      const ps = psByAgent.get(a.id);
      const days = ps ? dias.get(ps.id)?.size ?? 0 : 0;
      const status: CloseAgentRow['status'] = !ps ? 'sin_preliquidar' : (ps.status as 'draft' | 'confirmed');
      const row: CloseAgentRow = {
        profile_id: a.id,
        name: `${a.last_name}, ${a.first_name}`,
        has_schedule: conEsquema.has(a.id),
        has_rate: conTarifa.has(a.id),
        params_loaded: conEvaluacion.has(a.id),
        pre_settlement_id: ps?.id ?? null,
        status,
        total: ps ? Number(ps.total_amount) : null,
        days_to_normalize: days,
        ready: false,
      };
      row.ready = status === 'draft' && days === 0 && row.params_loaded && row.has_schedule && row.has_rate;
      return row;
    })
    .sort((x, y) => x.name.localeCompare(y.name, 'es'));

  const cuenta = (f: (r: CloseAgentRow) => boolean) => rows.filter(f).length;

  return {
    period,
    holidays: holidays ?? [],
    agents: rows,
    steps: {
      without_schedule: cuenta((r) => !r.has_schedule),
      without_rate: cuenta((r) => !r.has_rate),
      params_missing: cuenta((r) => !r.params_loaded),
      without_draft: cuenta((r) => r.status === 'sin_preliquidar'),
      days_to_normalize: rows.reduce((s, r) => s + r.days_to_normalize, 0),
      agents_to_normalize: cuenta((r) => r.days_to_normalize > 0),
      ready: cuenta((r) => r.ready),
      confirmed: cuenta((r) => r.status === 'confirmed'),
      total: rows.length,
    },
  };
}

/** Confirma de una todas las que están listas. Las demás quedan como están. */
export async function confirmReady(year: number, month: number) {
  const status = await getCloseStatus(year, month);
  const listos = status.agents.filter((a) => a.ready && a.pre_settlement_id);
  if (listos.length === 0) throw new BusinessError('No hay preliquidaciones listas para confirmar');

  const results: { profile_id: string; name: string; ok: boolean; error?: string }[] = [];
  for (const a of listos) {
    try {
      await updatePreSettlementStatus(a.pre_settlement_id!, 'confirmed');
      results.push({ profile_id: a.profile_id, name: a.name, ok: true });
    } catch (err) {
      results.push({ profile_id: a.profile_id, name: a.name, ok: false, error: (err as Error).message });
    }
  }
  return results;
}
