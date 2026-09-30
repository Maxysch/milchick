/**
 * Sugerencias de esquema: los pares agente × día de la semana que vienen
 * marcando distinto a su esquema semana tras semana.
 */
import { supabaseAdmin } from '../config/supabase.js';
import { localToday } from '../config/time.js';
import { addDays, type TimeBlock } from './settlement-calc.js';
import { detectScheduleDrift, type DriftSuggestion } from './schedule-drift.js';
import { BusinessError, loadAgentInputs, refreshDrafts } from './presettlement.service.js';

export interface AgentSuggestion extends DriftSuggestion {
  profile_id: string;
  agent: string;
}

/**
 * Corre el detector sobre las últimas semanas para todos los agentes activos.
 * Por defecto mira ocho semanas hasta ayer: lo suficiente para que un patrón
 * se repita, sin que un esquema que ya se corrigió siga apareciendo mucho tiempo.
 */
export async function getScheduleSuggestions(opts: { from?: string; to?: string } = {}): Promise<AgentSuggestion[]> {
  const ayer = addDays(localToday(), -1);
  const to = opts.to ?? ayer;
  const from = opts.from ?? addDays(to, -55);

  const { data: agents } = await supabaseAdmin
    .from('profiles')
    .select('id, first_name, last_name')
    .eq('role', 'agent')
    .eq('is_active', true);

  const out: AgentSuggestion[] = [];
  for (const a of (agents ?? []) as { id: string; first_name: string; last_name: string }[]) {
    const inputs = await loadAgentInputs(a.id, from, to);

    // Las primeras semanas de un agente nuevo no son su esquema
    const hire = inputs.profile.hire_date;
    const desde = hire ? addDays(hire, inputs.margins.newHireReviewDays) : null;

    const sugerencias = detectScheduleDrift({
      days: inputs.days.filter((d) => !desde || d.date >= desde),
      schedulesByDate: inputs.schedulesByDate,
      observations: inputs.observations,
      margins: inputs.margins,
      correctedDates: new Set(inputs.corrections.keys()),
    });

    for (const s of sugerencias) {
      out.push({ ...s, profile_id: a.id, agent: `${a.last_name}, ${a.first_name}` });
    }
  }

  return out.sort((a, b) => a.agent.localeCompare(b.agent, 'es') || a.day_of_week - b.day_of_week);
}

/**
 * Aplica un horario nuevo a un día de la semana desde una fecha.
 *
 * No edita el esquema vigente: lo cierra el día anterior y crea uno nuevo. Así
 * los meses ya liquidados siguen mostrando el horario que realmente tenían.
 */
export async function applyScheduleSuggestion(input: {
  profile_id: string;
  day_of_week: number;
  blocks: TimeBlock[];
  effective_from: string;
}) {
  const hasta = addDays(input.effective_from, -1);

  const { data: vigentes } = await supabaseAdmin
    .from('schedules')
    .select('id, client_id, effective_from, effective_until')
    .eq('profile_id', input.profile_id)
    .eq('day_of_week', input.day_of_week)
    .or(`effective_until.is.null,effective_until.gte.${input.effective_from}`);

  const rows = (vigentes ?? []) as { id: string; client_id: string; effective_from: string }[];

  // El cliente es obligatorio en el esquema: se toma el del bloque que se
  // reemplaza, o el de cualquier otro día del agente
  let clientId: string | null = rows.length ? rows[0].client_id : null;
  if (!clientId) {
    const { data: otro } = await supabaseAdmin
      .from('schedules')
      .select('client_id')
      .eq('profile_id', input.profile_id)
      .limit(1)
      .maybeSingle();
    clientId = (otro?.client_id as string | undefined) ?? null;
  }
  if (!clientId) throw new BusinessError('El agente no tiene ningún esquema del que tomar el cliente');
  const cliente: string = clientId;

  for (const r of rows) {
    // Un bloque que empezaba en esa misma fecha o después se reemplaza entero
    const { error } = r.effective_from >= input.effective_from
      ? await supabaseAdmin.from('schedules').delete().eq('id', r.id)
      : await supabaseAdmin.from('schedules').update({ effective_until: hasta }).eq('id', r.id);
    if (error) throw new Error(error.message);
  }

  const { error } = await supabaseAdmin.from('schedules').insert(
    input.blocks.map((b) => ({
      profile_id: input.profile_id,
      client_id: cliente,
      day_of_week: input.day_of_week,
      start_time: b.start_time,
      end_time: b.end_time,
      effective_from: input.effective_from,
    }))
  );
  if (error) throw new Error(error.message);

  await refreshDrafts({ profileId: input.profile_id, from: input.effective_from });
}
