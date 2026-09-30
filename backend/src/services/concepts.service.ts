/**
 * El catálogo de conceptos de los ítems.
 *
 * Cada ítem de una preliquidación apunta a un concepto del catálogo. El
 * catálogo se administra en Configuración; al liquidar, si falta un concepto,
 * se puede crear en el momento —para no frenar la liquidación— y queda "a
 * revisar" para que el administrador lo confirme o lo unifique con otro.
 *
 * Nada se borra: un concepto que ya no se usa se desactiva. La única forma de
 * que desaparezca es unificarlo con otro, que mueve sus ítems.
 */
import { conceptKeyFromName, normalizeConceptName, type CreateItemConceptInput, type UpdateItemConceptInput } from '@milchick/shared';
import { supabaseAdmin } from '../config/supabase.js';
import { BusinessError } from './errors.js';

export interface ItemConcept {
  id: string;
  key: string;
  name: string;
  normalized_name: string;
  description: string | null;
  system: boolean;
  kind: 'fixed' | 'percentage' | 'hourly';
  default_amount: number | null;
  default_percentage: number | null;
  default_unit_minutes: number | null;
  default_days: number | null;
  default_band: string | null;
  default_tier: string | null;
  default_factor: number | null;
  sort_order: number;
  is_active: boolean;
  needs_review: boolean;
  origin: 'sistema' | 'configuracion' | 'liquidacion' | 'migracion';
  created_by: string | null;
  created_at: string;
}

const numero = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const aConcepto = (r: Record<string, unknown>): ItemConcept => ({
  ...(r as unknown as ItemConcept),
  default_amount: numero(r.default_amount),
  default_percentage: numero(r.default_percentage),
  default_factor: numero(r.default_factor),
});

export async function listConcepts(opts: { includeInactive?: boolean } = {}): Promise<ItemConcept[]> {
  let q = supabaseAdmin.from('item_concepts').select('*').order('sort_order').order('name');
  if (!opts.includeInactive) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(aConcepto);
}

/** Clave → nombre, para mostrar los ítems y armar el resumen */
export async function conceptNames(): Promise<Map<string, ItemConcept>> {
  return new Map((await listConcepts({ includeInactive: true })).map((c) => [c.key, c]));
}

async function porNombre(nombre: string): Promise<ItemConcept | null> {
  const { data } = await supabaseAdmin
    .from('item_concepts')
    .select('*')
    .eq('normalized_name', normalizeConceptName(nombre))
    .maybeSingle();
  return data ? aConcepto(data as Record<string, unknown>) : null;
}

async function claveLibre(nombre: string): Promise<string> {
  const base = conceptKeyFromName(nombre) || 'concepto';
  for (let i = 1; ; i++) {
    const key = i === 1 ? base : `${base}_${i}`;
    const { data } = await supabaseAdmin.from('item_concepts').select('id').eq('key', key).maybeSingle();
    if (!data) return key;
  }
}

/** Lo que el concepto guarda como valores por defecto, según su forma de cálculo */
function valoresPorDefecto(input: Partial<CreateItemConceptInput>, kind: ItemConcept['kind']) {
  return {
    default_amount: kind === 'fixed' ? input.default_amount ?? null : null,
    default_percentage: kind === 'percentage' ? input.default_percentage ?? null : null,
    default_unit_minutes: kind === 'hourly' ? input.default_unit_minutes ?? null : null,
    default_days: kind === 'hourly' ? input.default_days ?? null : null,
    default_band: kind === 'hourly' ? input.default_band ?? 'day_ld' : null,
    default_tier: kind === 'hourly' ? input.default_tier ?? 'normal' : null,
    default_factor: kind === 'hourly' ? input.default_factor ?? 1 : null,
  };
}

export class ConceptExistsError extends BusinessError {
  constructor(readonly existing: ItemConcept) {
    super(`Ya existe «${existing.name}»${existing.is_active ? '' : ', desactivado'}`, 409);
  }
}

/**
 * Da de alta un concepto.
 *
 * - Desde Configuración (administrador): con todos sus datos.
 * - Al liquidar (`fromSettlement`): sólo el nombre, y queda a revisar salvo que
 *   lo cree un administrador. Si el nombre ya existía desactivado, se reactiva
 *   —también a revisar— en vez de frenar la liquidación.
 */
export async function createConcept(
  input: CreateItemConceptInput,
  user: { id: string; role: string },
  opts: { fromSettlement?: boolean } = {}
): Promise<{ concept: ItemConcept; created: boolean }> {
  const existente = await porNombre(input.name);
  if (existente) {
    if (existente.is_active || !opts.fromSettlement) throw new ConceptExistsError(existente);
    const { data, error } = await supabaseAdmin
      .from('item_concepts')
      .update({ is_active: true, needs_review: user.role !== 'admin' })
      .eq('id', existente.id)
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return { concept: aConcepto(data as Record<string, unknown>), created: false };
  }

  const kind = opts.fromSettlement ? 'fixed' : input.kind ?? 'fixed';
  const { data, error } = await supabaseAdmin
    .from('item_concepts')
    .insert({
      key: await claveLibre(input.name),
      name: input.name.trim(),
      description: opts.fromSettlement ? null : input.description ?? null,
      kind,
      ...(opts.fromSettlement ? valoresPorDefecto({}, kind) : valoresPorDefecto(input, kind)),
      sort_order: input.sort_order ?? 200,
      origin: opts.fromSettlement ? 'liquidacion' : 'configuracion',
      needs_review: opts.fromSettlement ? user.role !== 'admin' : false,
      created_by: user.id,
    })
    .select('*')
    .single();
  if (error) {
    // Dos altas simultáneas del mismo nombre: gana la primera
    if (error.code === '23505') {
      const otro = await porNombre(input.name);
      if (otro) throw new ConceptExistsError(otro);
    }
    throw new Error(error.message);
  }
  return { concept: aConcepto(data as Record<string, unknown>), created: true };
}

/**
 * Cambia un concepto. De uno del sistema sólo se cambian el nombre, la
 * descripción y el orden: lo demás lo decide el motor. Cambiar los valores por
 * defecto no toca los ítems ya cargados.
 */
export async function updateConcept(id: string, input: UpdateItemConceptInput): Promise<ItemConcept> {
  const { data: actual } = await supabaseAdmin.from('item_concepts').select('*').eq('id', id).maybeSingle();
  if (!actual) throw new BusinessError('Concepto no encontrado', 404);
  const c = aConcepto(actual as Record<string, unknown>);

  if (input.name !== undefined) {
    const otro = await porNombre(input.name);
    if (otro && otro.id !== id) throw new ConceptExistsError(otro);
  }

  let cambios: Record<string, unknown>;
  if (c.system) {
    if (input.is_active === false) throw new BusinessError('Un concepto del sistema no se desactiva: lo calcula el motor');
    cambios = Object.fromEntries(Object.entries({
      name: input.name?.trim(),
      description: input.description,
      sort_order: input.sort_order,
    }).filter(([, v]) => v !== undefined));
  } else {
    const kind = input.kind ?? c.kind;
    const tocaValores = input.kind !== undefined || Object.keys(input).some((k) => k.startsWith('default_'));
    cambios = Object.fromEntries(Object.entries({
      name: input.name?.trim(),
      description: input.description,
      sort_order: input.sort_order,
      is_active: input.is_active,
      needs_review: input.needs_review,
      kind: input.kind,
      ...(tocaValores ? valoresPorDefecto({ ...c, ...input } as Partial<CreateItemConceptInput>, kind) : {}),
    }).filter(([, v]) => v !== undefined));
  }

  const { data, error } = await supabaseAdmin.from('item_concepts').update(cambios).eq('id', id).select('*').single();
  if (error) throw new Error(error.message);
  return aConcepto(data as Record<string, unknown>);
}

/**
 * Unifica un concepto con otro: sus ítems —de borradores y de confirmadas—
 * pasan al otro, y el concepto desaparece. Las confirmadas conservan el nombre
 * con el que se confirmaron; sólo cambia a qué concepto suman.
 */
export async function mergeConcept(id: string, intoId: string): Promise<{ moved: number; into: ItemConcept }> {
  if (id === intoId) throw new BusinessError('Elegí otro concepto para unificar');
  const { data: filas } = await supabaseAdmin.from('item_concepts').select('*').in('id', [id, intoId]);
  const origen = (filas ?? []).find((f) => f.id === id);
  const destino = (filas ?? []).find((f) => f.id === intoId);
  if (!origen || !destino) throw new BusinessError('Concepto no encontrado', 404);
  if (origen.system || destino.system) {
    throw new BusinessError('Los conceptos del sistema no se unifican: los calcula el motor y se recalculan solos');
  }

  const { data: movidos, error } = await supabaseAdmin
    .from('pre_settlement_items')
    .update({ concept: destino.key })
    .eq('concept', origen.key)
    .select('id');
  if (error) throw new Error(error.message);

  const { error: errBorrar } = await supabaseAdmin.from('item_concepts').delete().eq('id', id);
  if (errBorrar) throw new Error(errBorrar.message);

  return { moved: (movidos ?? []).length, into: aConcepto(destino as Record<string, unknown>) };
}

/** Cuántos ítems usa cada concepto, para mostrar en el catálogo qué pesa cada uno */
export async function conceptUsage(): Promise<Record<string, number>> {
  const { data, error } = await supabaseAdmin.from('pre_settlement_items').select('concept');
  if (error) throw new Error(error.message);
  const cuenta: Record<string, number> = {};
  for (const r of (data ?? []) as { concept: string }[]) cuenta[r.concept] = (cuenta[r.concept] ?? 0) + 1;
  return cuenta;
}

/**
 * El concepto que se quiere usar en un ítem cargado a mano: tiene que existir,
 * estar activo y no ser del sistema —los del sistema se recalculan, y un ítem
 * suyo cargado a mano se perdería en el próximo recálculo—.
 */
export async function assertManualConcept(key: string): Promise<ItemConcept> {
  const { data } = await supabaseAdmin.from('item_concepts').select('*').eq('key', key).maybeSingle();
  if (!data) throw new BusinessError('Ese concepto no está en el catálogo');
  const c = aConcepto(data as Record<string, unknown>);
  if (c.system) throw new BusinessError(`«${c.name}» lo calcula el sistema: no se carga como ítem`);
  if (!c.is_active) throw new BusinessError(`«${c.name}» está desactivado`);
  return c;
}
