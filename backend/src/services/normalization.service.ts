/**
 * Normalización: resolver los días que no cierran contra el plan.
 *
 * Un día se paga solo cuando la marcación acompaña al plan dentro de los
 * márgenes. Cuando no, queda en esta bandeja hasta que alguien decide qué se
 * paga. Cada decisión es una corrección del día —un dato de entrada— y lo que
 * la corrección toca además (una autorización creada, horas que pasan a pagarse
 * sin tope) queda registrado para poder deshacerlo entero.
 */
import { supabaseAdmin } from '../config/supabase.js';
import type { DayResult, TimeBlock, Tier } from './settlement-calc.js';
import { BusinessError, refreshDrafts, revertEffects } from './presettlement.service.js';

export type ResolveAction = 'plan' | 'marks' | 'custom' | 'none' | 'authorize' | 'pay_authorized';

export interface ResolveInput {
  profile_id: string;
  date: string;
  action: ResolveAction;
  blocks?: TimeBlock[];
  hours?: number;
  tier?: Tier;
  note?: string | null;
}

// ─── La bandeja ─────────────────────────────────────────────────────

export interface QueueItem {
  profile_id: string;
  agent: string;
  pre_settlement_id: string;
  date: string;
  codes: string[];
  details: string[];
  plan: TimeBlock[];
  marked: TimeBlock[];
  new_hire: boolean;
  /** La excepción del día, si tenía: cambia qué significa "dejarlo como está" */
  exception: string | null;
  suggestion: { action: ResolveAction; hours?: number; tier?: Tier; reason: string } | null;
  context: Record<string, unknown> | null;
}

/**
 * Los días a normalizar de un período: un renglón por agente y día, con todos
 * los motivos juntos y la resolución sugerida.
 */
export async function getQueue(periodFrom: string, periodTo: string) {
  const [{ data: delPeriodo }, { data: agents }] = await Promise.all([
    supabaseAdmin
      .from('pre_settlements')
      .select('id, profile_id, status, day_summary, recalculated_at, profiles!pre_settlements_profile_id_fkey(first_name, last_name)')
      .eq('period_from', periodFrom)
      .eq('period_to', periodTo)
      .neq('status', 'cancelled'),
    supabaseAdmin.from('profiles').select('id, first_name, last_name').eq('role', 'agent').eq('is_active', true),
  ]);

  // Sólo los borradores tienen días por normalizar; una confirmada ya se cerró
  const todas = (delPeriodo ?? []) as Record<string, unknown>[];
  const draftRows = todas.filter((d) => d.status === 'draft');
  const ids = draftRows.map((d) => d.id as string);

  const { data: warnings } = ids.length
    ? await supabaseAdmin
        .from('pre_settlement_warnings')
        .select('pre_settlement_id, date, code, detail, context, suggestion')
        .in('pre_settlement_id', ids)
        .eq('blocking', true)
        .eq('status', 'pending')
        .order('date')
    : { data: [] };

  // La evaluación mensual faltante bloquea, pero no es un día: se resuelve en
  // Evaluación mensual y se muestra aparte
  const sinEvaluacion = new Set<string>();
  const deDias = ((warnings ?? []) as Record<string, unknown>[]).filter((w) => {
    if (w.code !== 'missing_period_params') return true;
    sinEvaluacion.add(w.pre_settlement_id as string);
    return false;
  });

  const draftById = new Map(draftRows.map((d) => [d.id as string, d]));
  const byKey = new Map<string, QueueItem>();

  for (const w of deDias) {
    const d = draftById.get(w.pre_settlement_id as string)!;
    const p = d.profiles as { first_name: string; last_name: string };
    const key = `${d.profile_id}|${w.date}`;
    const day = ((d.day_summary ?? []) as DayResult[]).find((x) => x.date === w.date);

    const item = byKey.get(key) ?? {
      profile_id: d.profile_id as string,
      agent: `${p.last_name}, ${p.first_name}`,
      pre_settlement_id: d.id as string,
      date: w.date as string,
      codes: [],
      details: [],
      plan: day?.plan ?? [],
      marked: day?.marked ?? [],
      new_hire: day?.newHire ?? false,
      exception: day?.exception ?? null,
      suggestion: (w.suggestion as QueueItem['suggestion']) ?? null,
      context: (w.context as Record<string, unknown>) ?? null,
    };
    item.codes.push(w.code as string);
    item.details.push(w.detail as string);
    item.suggestion ??= (w.suggestion as QueueItem['suggestion']) ?? null;
    byKey.set(key, item);
  }

  const items = [...byKey.values()].sort(
    (a, b) => a.agent.localeCompare(b.agent, 'es') || a.date.localeCompare(b.date)
  );

  const conPreliquidacion = new Set(todas.map((d) => d.profile_id as string));
  const sinPreliquidar = ((agents ?? []) as { id: string; first_name: string; last_name: string }[])
    .filter((a) => !conPreliquidacion.has(a.id))
    .map((a) => ({ profile_id: a.id, agent: `${a.last_name}, ${a.first_name}` }));

  const porAgente = new Map<string, { profile_id: string; agent: string; days: number }>();
  for (const it of items) {
    const cur = porAgente.get(it.profile_id) ?? { profile_id: it.profile_id, agent: it.agent, days: 0 };
    cur.days++;
    porAgente.set(it.profile_id, cur);
  }

  const actualizadas = draftRows.map((d) => d.recalculated_at as string | null).filter(Boolean) as string[];

  return {
    period: { from: periodFrom, to: periodTo },
    items,
    by_agent: [...porAgente.values()].sort((a, b) => b.days - a.days),
    totals: {
      days: items.length,
      with_suggestion: items.filter((i) => i.suggestion).length,
      new_hires: items.filter((i) => i.new_hire).length,
    },
    without_draft: sinPreliquidar,
    params_missing: draftRows
      .filter((d) => sinEvaluacion.has(d.id as string))
      .map((d) => {
        const p = d.profiles as { first_name: string; last_name: string };
        return { profile_id: d.profile_id as string, agent: `${p.last_name}, ${p.first_name}` };
      }),
    // Lo más viejo manda: si algún borrador no se recalcula hace rato, la bandeja puede estar atrasada
    oldest_recalculation: actualizadas.length ? actualizadas.sort()[0] : null,
  };
}

// ─── Resolver ───────────────────────────────────────────────────────

/**
 * Un día que ya está en una preliquidación confirmada no se toca: lo pagado es
 * lo confirmado. Para cambiarlo se vuelve la preliquidación a borrador.
 */
async function assertNotConfirmed(profileId: string, date: string) {
  const { data } = await supabaseAdmin
    .from('pre_settlements')
    .select('id')
    .eq('profile_id', profileId)
    .lte('period_from', date)
    .gte('period_to', date)
    .eq('status', 'confirmed')
    .limit(1);
  if (data?.length) {
    throw new BusinessError('Ese día es de una preliquidación confirmada. Para cambiarlo, volvela a borrador.');
  }
}

/**
 * Lo que el cálculo pagaba como horas del día. "Está bien así" confirma eso,
 * no el esquema: en un día de trabajo o de licencia es el plan; en un feriado
 * no trabajado o una ausencia, nada —el feriado se sigue compensando—.
 */
const asCalculated = (day: DayResult | null): TimeBlock[] => (day && day.regularHours > 0 ? day.plan : []);

/** El plan y lo marcado de un día, tal como quedaron en el último cálculo. */
async function dayOf(profileId: string, date: string): Promise<DayResult | null> {
  const { data } = await supabaseAdmin
    .from('pre_settlements')
    .select('day_summary')
    .eq('profile_id', profileId)
    .lte('period_from', date)
    .gte('period_to', date)
    .eq('status', 'draft')
    .maybeSingle();
  return ((data?.day_summary ?? []) as DayResult[]).find((d) => d.date === date) ?? null;
}

/**
 * Aplica una resolución a un día. Normalizar es una sola decisión: las acciones
 * sobre horas autorizadas también dejan el día revisado, porque si no un día
 * con dos motivos —llegó tarde y además tenía horas cargadas— quedaría a medio
 * resolver.
 */
export async function resolveDay(input: ResolveInput, userId: string, opts: { refresh?: boolean } = {}) {
  await assertNotConfirmed(input.profile_id, input.date);
  const day = await dayOf(input.profile_id, input.date);
  if (!day && (input.action === 'plan' || input.action === 'marks')) {
    throw new BusinessError('No hay una preliquidación en borrador que contenga ese día');
  }

  // Si el día ya estaba resuelto, lo anterior se deshace entero antes
  const { data: existing } = await supabaseAdmin
    .from('day_corrections')
    .select('id, effects')
    .eq('profile_id', input.profile_id)
    .eq('date', input.date)
    .maybeSingle();
  if (existing?.effects) await revertEffects(existing.effects as Record<string, unknown>);

  const effects: Record<string, string[]> = {};
  let resolution: 'plan' | 'marks' | 'custom' | 'none';
  let blocks: TimeBlock[] | null;

  switch (input.action) {
    case 'plan':
      resolution = 'plan';
      blocks = asCalculated(day);
      break;
    case 'marks':
      if (!day!.marked.length) throw new BusinessError('Ese día no tiene una marcación completa para pagar');
      resolution = 'marks';
      blocks = day!.marked;
      break;
    case 'custom':
      resolution = 'custom';
      blocks = input.blocks ?? [];
      break;
    case 'none':
      resolution = 'none';
      blocks = null;
      break;
    case 'authorize': {
      const { data: ot, error } = await supabaseAdmin
        .from('overtime')
        .insert({
          profile_id: input.profile_id,
          date: input.date,
          hours: input.hours,
          tier: input.tier,
          notes: input.note ?? 'Autorizadas al normalizar el día',
          created_by: userId,
        })
        .select('id')
        .single();
      if (error || !ot) throw new Error(`No se pudo autorizar: ${error?.message}`);
      effects.overtime_created = [ot.id as string];
      resolution = 'plan';
      blocks = asCalculated(day);
      break;
    }
    case 'pay_authorized': {
      const { data: ots } = await supabaseAdmin
        .from('overtime')
        .select('id')
        .eq('profile_id', input.profile_id)
        .eq('date', input.date)
        .eq('uncapped', false);
      const ids = ((ots ?? []) as { id: string }[]).map((o) => o.id);
      if (ids.length === 0) throw new BusinessError('Ese día no tiene horas autorizadas para pagar');
      await supabaseAdmin.from('overtime').update({ uncapped: true }).in('id', ids);
      effects.overtime_uncapped = ids;
      resolution = 'plan';
      blocks = asCalculated(day);
      break;
    }
  }

  const payload = {
    profile_id: input.profile_id,
    date: input.date,
    resolution,
    blocks,
    lines: null,
    note: input.note ?? null,
    effects: Object.keys(effects).length ? effects : null,
    created_by: userId,
  };

  const { error } = existing
    ? await supabaseAdmin.from('day_corrections').update(payload).eq('id', existing.id)
    : await supabaseAdmin.from('day_corrections').insert(payload);
  if (error) {
    // Si la corrección no se pudo guardar, lo que se tocó antes se revierte
    await revertEffects(effects);
    throw new Error(`No se pudo guardar la corrección: ${error.message}`);
  }

  if (opts.refresh !== false) await refreshDrafts({ profileId: input.profile_id, from: input.date });
}

/**
 * Resuelve varios días de una. Es lo que hace "aceptar las sugeridas": el
 * cliente manda exactamente la lista que el supervisor vio y confirmó, no se
 * recalcula de este lado qué aceptar.
 */
export async function resolveMany(items: ResolveInput[], userId: string) {
  const results: { profile_id: string; date: string; ok: boolean; error?: string }[] = [];
  const tocados = new Map<string, string>(); // agente → primera fecha tocada

  for (const it of items) {
    try {
      await resolveDay(it, userId, { refresh: false });
      results.push({ profile_id: it.profile_id, date: it.date, ok: true });
      const prev = tocados.get(it.profile_id);
      if (!prev || it.date < prev) tocados.set(it.profile_id, it.date);
    } catch (err) {
      results.push({ profile_id: it.profile_id, date: it.date, ok: false, error: (err as Error).message });
    }
  }

  for (const [profileId, from] of tocados) await refreshDrafts({ profileId, from });

  return {
    resolved: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok),
  };
}

// ─── Correcciones aplicadas ─────────────────────────────────────────

export async function listCorrections(from: string, to: string, profileId?: string) {
  let q = supabaseAdmin
    .from('day_corrections')
    .select('*, profiles!day_corrections_profile_id_fkey(first_name, last_name), creator:created_by(first_name, last_name)')
    .gte('date', from)
    .lte('date', to)
    .order('date');
  if (profileId) q = q.eq('profile_id', profileId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);

  // Las de días ya confirmados se muestran, pero no se pueden deshacer
  const rows = (data ?? []) as Record<string, unknown>[];
  const ids = [...new Set(rows.map((r) => r.profile_id as string))];
  const { data: confirmadas } = ids.length
    ? await supabaseAdmin
        .from('pre_settlements')
        .select('profile_id, period_from, period_to')
        .in('profile_id', ids)
        .eq('status', 'confirmed')
        .lte('period_from', to)
        .gte('period_to', from)
    : { data: [] };
  const cerradas = (confirmadas ?? []) as { profile_id: string; period_from: string; period_to: string }[];
  return rows.map((r) => ({
    ...r,
    locked: cerradas.some(
      (c) => c.profile_id === r.profile_id && c.period_from <= (r.date as string) && (r.date as string) <= c.period_to
    ),
  }));
}

/** Deshace una corrección: el día vuelve a calcularse solo, y se revierte lo que tocó. */
export async function undoCorrection(id: string) {
  const { data: c } = await supabaseAdmin
    .from('day_corrections')
    .select('profile_id, date, effects')
    .eq('id', id)
    .single();
  if (!c) throw new BusinessError('Corrección no encontrada', 404);
  await assertNotConfirmed(c.profile_id as string, c.date as string);

  if (c.effects) await revertEffects(c.effects as Record<string, unknown>);
  const { error } = await supabaseAdmin.from('day_corrections').delete().eq('id', id);
  if (error) throw new Error(error.message);

  await refreshDrafts({ profileId: c.profile_id as string, from: c.date as string });
}
