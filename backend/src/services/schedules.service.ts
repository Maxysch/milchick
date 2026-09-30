/**
 * Cambios en los esquemas que tienen consecuencias en lo que se paga.
 *
 * Dos reglas:
 *  - Dos bloques del mismo día no se pueden pisar: el motor paga cada bloque,
 *    así que un solapamiento se pagaría dos veces.
 *  - Un horario que cambia desde una fecha no se edita: el vigente se cierra el
 *    día anterior y se crea uno nuevo. Así los meses ya liquidados siguen
 *    mostrando el horario que realmente tenían.
 */
import { supabaseAdmin } from '../config/supabase.js';
import { addDays, endMinutes, timeToMinutes } from './settlement-calc.js';
import { BusinessError, refreshDrafts } from './presettlement.service.js';

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const SIN_FIN = '9999-12-31';

interface BlockCandidate {
  day_of_week: number;
  start_time: string;
  end_time: string;
  effective_from: string;
  effective_until?: string | null;
}

interface ScheduleRow extends BlockCandidate {
  id: string;
  client_id: string;
}

const rango = (inicio: string, fin: string): [number, number] => {
  const a = timeToMinutes(inicio);
  return [a, endMinutes(a, timeToMinutes(fin))];
};

const hhmm = (t: string) => t.slice(0, 5);
const fecha = (d: string) => d.split('-').reverse().join('/');

/** Si dos tramos del mismo día se pisan */
function sePisan(a: { start_time: string; end_time: string }, b: { start_time: string; end_time: string }) {
  const [as, ae] = rango(a.start_time, a.end_time);
  const [bs, be] = rango(b.start_time, b.end_time);
  return as < be && bs < ae;
}

/**
 * El bloque del agente que se pisa con el candidato: mismo día, horarios que se
 * cruzan y vigencias que se cruzan. `excluir` deja afuera el que se está editando.
 */
export async function findOverlap(profileId: string, c: BlockCandidate, excluir: string[] = []): Promise<ScheduleRow | null> {
  const { data, error } = await supabaseAdmin
    .from('schedules')
    .select('id, client_id, day_of_week, start_time, end_time, effective_from, effective_until')
    .eq('profile_id', profileId)
    .eq('day_of_week', c.day_of_week);
  if (error) throw new Error(error.message);

  return (
    ((data ?? []) as ScheduleRow[]).find(
      (x) =>
        !excluir.includes(x.id) &&
        x.effective_from <= (c.effective_until ?? SIN_FIN) &&
        c.effective_from <= (x.effective_until ?? SIN_FIN) &&
        sePisan(x, c)
    ) ?? null
  );
}

/** El mensaje para un bloque que se pisa con otro */
export function overlapMessage(x: ScheduleRow): string {
  const vigencia = x.effective_until
    ? `vigente del ${fecha(x.effective_from)} al ${fecha(x.effective_until)}`
    : `vigente desde el ${fecha(x.effective_from)}`;
  return (
    `Se pisa con el bloque del ${DIAS[x.day_of_week]} de ${hhmm(x.start_time)} a ${hhmm(x.end_time)} (${vigencia}). ` +
    'Si el horario cambia a partir de una fecha, usá "Cambiar desde".'
  );
}

/**
 * Cambia el horario de un día de la semana a partir de una fecha: los bloques
 * vigentes se cierran el día anterior (los que empezaban esa fecha o después se
 * reemplazan) y se crean los nuevos. Sin bloques, desde esa fecha el día es franco.
 *
 * Cada bloque puede traer su cliente; si no, se toma el del bloque que se
 * reemplaza, o el de cualquier otro día del agente.
 */
export async function changeDaySchedule(input: {
  profile_id: string;
  day_of_week: number;
  blocks: { start_time: string; end_time: string; client_id?: string | null }[];
  effective_from: string;
}) {
  for (const b of input.blocks) {
    if (b.start_time === b.end_time) throw new BusinessError(`El tramo ${b.start_time}–${b.end_time} no dura nada`);
  }
  for (let i = 0; i < input.blocks.length; i++) {
    for (let j = i + 1; j < input.blocks.length; j++) {
      if (sePisan(input.blocks[i], input.blocks[j])) {
        throw new BusinessError(
          `Los tramos ${input.blocks[i].start_time}–${input.blocks[i].end_time} y ` +
            `${input.blocks[j].start_time}–${input.blocks[j].end_time} se pisan`
        );
      }
    }
  }

  const hasta = addDays(input.effective_from, -1);

  const { data: vigentes, error: errVigentes } = await supabaseAdmin
    .from('schedules')
    .select('id, client_id, effective_from, effective_until')
    .eq('profile_id', input.profile_id)
    .eq('day_of_week', input.day_of_week)
    .or(`effective_until.is.null,effective_until.gte.${input.effective_from}`);
  if (errVigentes) throw new Error(errVigentes.message);

  const rows = (vigentes ?? []) as { id: string; client_id: string; effective_from: string }[];

  // El cliente es obligatorio en el esquema
  let porDefecto: string | null = rows[0]?.client_id ?? null;
  if (!porDefecto && input.blocks.some((b) => !b.client_id)) {
    const { data: otro } = await supabaseAdmin
      .from('schedules')
      .select('client_id')
      .eq('profile_id', input.profile_id)
      .limit(1)
      .maybeSingle();
    porDefecto = (otro?.client_id as string | undefined) ?? null;
  }
  const nuevos = input.blocks.map((b) => ({ ...b, client_id: b.client_id ?? porDefecto }));
  if (nuevos.some((b) => !b.client_id)) {
    throw new BusinessError('Falta el cliente: el agente no tiene ningún esquema del que tomarlo');
  }

  for (const r of rows) {
    // Un bloque que empezaba en esa misma fecha o después se reemplaza entero
    const { error } = r.effective_from >= input.effective_from
      ? await supabaseAdmin.from('schedules').delete().eq('id', r.id)
      : await supabaseAdmin.from('schedules').update({ effective_until: hasta }).eq('id', r.id);
    if (error) throw new Error(error.message);
  }

  if (nuevos.length) {
    const { error } = await supabaseAdmin.from('schedules').insert(
      nuevos.map((b) => ({
        profile_id: input.profile_id,
        client_id: b.client_id,
        day_of_week: input.day_of_week,
        start_time: b.start_time,
        end_time: b.end_time,
        effective_from: input.effective_from,
      }))
    );
    if (error) throw new Error(error.message);
  }

  await refreshDrafts({ profileId: input.profile_id, from: input.effective_from });
}
