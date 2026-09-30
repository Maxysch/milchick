import { useId, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, Combine, EyeOff, Pencil, Plus, RotateCcw, Sparkles, X } from 'lucide-react';
import { similarConcepts } from '@milchick/shared';
import { api } from '../../lib/api';
import { BAND_LABELS, TIER_LABELS } from '../../lib/utils';
import {
  describeDefaults,
  KIND_LABELS,
  ORIGIN_LABELS,
  useConceptCatalog,
  useInvalidateConcepts,
  type ItemConcept,
  type ItemKind,
} from '../../lib/concepts';
import { cardClass, fieldClass, getBadgeClass, inputClass, primaryButtonClass, secondaryButtonClass } from '../../pages/shared';

type Filtro = 'activos' | 'revisar' | 'inactivos' | 'todos';

interface Borrador {
  name: string;
  description: string;
  kind: ItemKind;
  amount: string;
  percentage: string;
  unitMinutes: string;
  days: string;
  band: string;
  tier: string;
  factor: string;
  sortOrder: string;
}

const desde = (c?: ItemConcept): Borrador => ({
  name: c?.name ?? '',
  description: c?.description ?? '',
  kind: c?.kind ?? 'fixed',
  amount: c?.default_amount != null ? String(c.default_amount) : '',
  percentage: c?.default_percentage != null ? String(Number((Number(c.default_percentage) * 100).toFixed(4))) : '',
  unitMinutes: c?.default_unit_minutes != null ? String(c.default_unit_minutes) : '',
  days: c?.default_days != null ? String(c.default_days) : '',
  band: c?.default_band ?? 'day_ld',
  tier: c?.default_tier ?? 'normal',
  factor: c?.default_factor != null ? String(c.default_factor) : '1',
  sortOrder: c ? String(c.sort_order) : '200',
});

const nulo = (v: string) => (v.trim() === '' ? null : Number(v));

function aPayload(b: Borrador, sistema: boolean) {
  const base = { name: b.name.trim(), description: b.description.trim() || null, sort_order: Number(b.sortOrder) || 0 };
  if (sistema) return base;
  return {
    ...base,
    kind: b.kind,
    default_amount: b.kind === 'fixed' ? nulo(b.amount) : null,
    default_percentage: b.kind === 'percentage' && b.percentage.trim() ? Number(b.percentage) / 100 : null,
    default_unit_minutes: b.kind === 'hourly' ? nulo(b.unitMinutes) : null,
    default_days: b.kind === 'hourly' ? nulo(b.days) : null,
    default_band: b.kind === 'hourly' ? b.band : null,
    default_tier: b.kind === 'hourly' ? b.tier : null,
    default_factor: b.kind === 'hourly' ? nulo(b.factor) ?? 1 : null,
  };
}

/** Los campos de un concepto: nombre, forma de cálculo y valores por defecto */
function Formulario({
  valor,
  onChange,
  sistema,
}: {
  valor: Borrador;
  onChange: (b: Borrador) => void;
  sistema: boolean;
}) {
  const set = (k: keyof Borrador) => (e: { target: { value: string } }) => onChange({ ...valor, [k]: e.target.value });
  const base = useId();
  const id = (k: keyof Borrador) => `${base}-${k}`;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-[2fr_1fr_6rem]">
        <div>
          <label htmlFor={id('name')} className="mb-1 block text-xs text-gray-600">Nombre</label>
          <input id={id('name')} className={inputClass} value={valor.name} onChange={set('name')} placeholder="Ej. Bono por cobertura" />
        </div>
        {!sistema ? (
          <div>
            <label htmlFor={id('kind')} className="mb-1 block text-xs text-gray-600">Cómo se calcula</label>
            <select id={id('kind')} className={inputClass} value={valor.kind} onChange={set('kind')}>
              {(Object.keys(KIND_LABELS) as ItemKind[]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
            </select>
          </div>
        ) : <div />}
        <div>
          <label htmlFor={id('sortOrder')} className="mb-1 block text-xs text-gray-600">Orden</label>
          <input id={id('sortOrder')} className={inputClass} type="number" min="0" value={valor.sortOrder} onChange={set('sortOrder')} />
        </div>
      </div>

      {!sistema && valor.kind === 'fixed' ? (
        <div className="md:w-56">
          <label htmlFor={id('amount')} className="mb-1 block text-xs text-gray-600">Importe por defecto <span className="text-gray-400">(opcional)</span></label>
          <input id={id('amount')} className={inputClass} type="number" step="0.01" value={valor.amount} onChange={set('amount')} />
        </div>
      ) : null}
      {!sistema && valor.kind === 'percentage' ? (
        <div className="md:w-56">
          <label htmlFor={id('percentage')} className="mb-1 block text-xs text-gray-600">Porcentaje por defecto</label>
          <input id={id('percentage')} className={inputClass} type="number" step="0.5" min="0" max="100" value={valor.percentage} onChange={set('percentage')} />
        </div>
      ) : null}
      {!sistema && valor.kind === 'hourly' ? (
        <div className="grid gap-3 md:grid-cols-5">
          <div><label htmlFor={id('unitMinutes')} className="mb-1 block text-xs text-gray-600">Minutos por día</label><input id={id('unitMinutes')} className={inputClass} type="number" min="0" step="5" value={valor.unitMinutes} onChange={set('unitMinutes')} /></div>
          <div><label htmlFor={id('days')} className="mb-1 block text-xs text-gray-600">Días</label><input id={id('days')} className={inputClass} type="number" min="0" max="31" value={valor.days} onChange={set('days')} /></div>
          <div><label htmlFor={id('band')} className="mb-1 block text-xs text-gray-600">Valor hora</label>
            <select id={id('band')} className={inputClass} value={valor.band} onChange={set('band')}>{Object.entries(BAND_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div><label htmlFor={id('tier')} className="mb-1 block text-xs text-gray-600">Tramo</label>
            <select id={id('tier')} className={inputClass} value={valor.tier} onChange={set('tier')}>{Object.entries(TIER_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div><label htmlFor={id('factor')} className="mb-1 block text-xs text-gray-600">Factor</label><input id={id('factor')} className={inputClass} type="number" min="0" max="2" step="0.05" value={valor.factor} onChange={set('factor')} /></div>
        </div>
      ) : null}

      <div>
        <label htmlFor={id('description')} className="mb-1 block text-xs text-gray-600">Descripción <span className="text-gray-400">(opcional: para qué se usa)</span></label>
        <input id={id('description')} className={inputClass} value={valor.description} onChange={set('description')} />
      </div>
    </div>
  );
}

/**
 * El catálogo de conceptos de los ítems, en Configuración.
 *
 * Lo edita el administrador. Nada se borra: un concepto que ya no se usa se
 * desactiva, y los ítems que lo usaban lo conservan. Los creados al liquidar
 * quedan "a revisar": se confirman, se les cambia el nombre o se unifican con
 * otro existente.
 */
export default function ConceptCatalog({ esAdmin }: { esAdmin: boolean }) {
  const catalogo = useConceptCatalog();
  const invalidate = useInvalidateConcepts();
  const todos = useMemo(() => catalogo.data ?? [], [catalogo.data]);
  const aRevisar = todos.filter((c) => c.needs_review && c.is_active);
  const inactivos = todos.filter((c) => !c.is_active);
  const [filtro, setFiltro] = useState<Filtro>('activos');
  const [nuevo, setNuevo] = useState<Borrador | null>(null);
  const [editando, setEditando] = useState<{ id: string; b: Borrador } | null>(null);
  const [unificando, setUnificando] = useState<{ id: string; into: string } | null>(null);

  const visibles = todos.filter((c) =>
    filtro === 'todos' ? true : filtro === 'inactivos' ? !c.is_active : filtro === 'revisar' ? c.needs_review && c.is_active : c.is_active
  );

  const crear = useMutation({
    mutationFn: (b: Borrador) => api.post('/item-concepts', aPayload(b, false)),
    onSuccess: async () => { setNuevo(null); await invalidate(); },
  });
  const guardar = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) => api.patch(`/item-concepts/${id}`, payload),
    onSuccess: async () => { setEditando(null); await invalidate(); },
  });
  const unificar = useMutation({
    mutationFn: ({ id, into }: { id: string; into: string }) => api.post(`/item-concepts/${id}/merge`, { into_id: into }),
    onSuccess: async () => { setUnificando(null); await invalidate(); },
  });

  const parecidosNuevo = nuevo && nuevo.name.trim().length > 1 ? similarConcepts(nuevo.name, todos) : [];
  const error = (crear.error ?? guardar.error ?? unificar.error) as Error | null;

  const chip = (f: Filtro, texto: string, n?: number) => (
    <button type="button" onClick={() => setFiltro(f)}
      className={`rounded-full px-3 py-1 text-sm ${filtro === f ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
      {texto}{n !== undefined ? ` · ${n}` : ''}
    </button>
  );

  const accion = 'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm';

  return (
    <section className={cardClass} id="conceptos">
      <h2 className="text-lg font-semibold text-gray-900">Conceptos de los ítems</h2>
      <p className="mt-1 text-sm text-gray-600">
        La lista de la que se eligen los ítems al liquidar. Cambiar un valor por defecto no toca los ítems ya cargados, y
        desactivar un concepto lo saca de la lista, pero los ítems que ya lo usan lo conservan. Lo confirmado guarda el
        nombre con el que se confirmó.
      </p>

      {aRevisar.length ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="inline-flex items-start gap-2">
            <Sparkles className="mt-0.5 h-4 w-4 flex-none" />
            <span>
              {aRevisar.length === 1
                ? 'Un concepto creado al liquidar espera revisión: confirmalo, cambiale el nombre o unificalo con uno existente.'
                : `${aRevisar.length} conceptos creados al liquidar esperan revisión: confirmalos, cambiales el nombre o unificalos con uno existente.`}
            </span>
          </span>
          {filtro !== 'revisar' ? <button type="button" className="font-medium underline" onClick={() => setFiltro('revisar')}>Verlos</button> : null}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {chip('activos', 'Activos', todos.filter((c) => c.is_active).length)}
          {chip('revisar', 'A revisar', aRevisar.length)}
          {chip('inactivos', 'Desactivados', inactivos.length)}
          {chip('todos', 'Todos')}
        </div>
        {esAdmin && !nuevo ? (
          <button type="button" className={`${secondaryButtonClass} inline-flex items-center gap-2`} onClick={() => setNuevo(desde())}>
            <Plus className="h-4 w-4" /> Agregar concepto
          </button>
        ) : null}
      </div>

      {nuevo ? (
        <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50/40 p-4">
          <Formulario valor={nuevo} onChange={setNuevo} sistema={false} />
          {parecidosNuevo.length ? (
            <p className="mt-3 text-sm text-amber-800">
              <Sparkles className="mr-1 inline h-4 w-4" />
              Ya hay parecidos: {parecidosNuevo.map((c) => `«${c.name}»${c.is_active ? '' : ' (desactivado)'}`).join(', ')}.
            </p>
          ) : null}
          <div className="mt-4 flex gap-3">
            <button type="button" className={primaryButtonClass} disabled={crear.isPending || nuevo.name.trim().length < 2} onClick={() => crear.mutate(nuevo)}>
              {crear.isPending ? 'Guardando...' : 'Agregar'}
            </button>
            <button type="button" className={secondaryButtonClass} onClick={() => setNuevo(null)}>Cancelar</button>
          </div>
        </div>
      ) : null}

      {error ? <p className="mt-3 text-sm text-red-600">{error.message}</p> : null}

      <ul className="mt-3 divide-y divide-gray-100 border-t border-gray-100">
        {visibles.map((c) =>
          editando?.id === c.id ? (
            <li key={c.id} className="py-3">
              <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-4">
                <Formulario valor={editando.b} onChange={(b) => setEditando({ id: c.id, b })} sistema={c.system} />
                <div className="mt-4 flex flex-wrap gap-3">
                  <button type="button" className={primaryButtonClass} disabled={guardar.isPending || editando.b.name.trim().length < 2}
                    onClick={() => guardar.mutate({ id: c.id, payload: { ...aPayload(editando.b, c.system), ...(c.needs_review ? { needs_review: false } : {}) } })}>
                    {guardar.isPending ? 'Guardando...' : c.needs_review ? 'Guardar y confirmar' : 'Guardar'}
                  </button>
                  <button type="button" className={secondaryButtonClass} onClick={() => setEditando(null)}>Cancelar</button>
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  {c.system
                    ? 'Lo calcula el sistema: se cambian el nombre, la descripción y el orden.'
                    : 'Los ítems ya cargados no cambian: los valores por defecto se usan en los ítems nuevos.'}
                </p>
              </div>
            </li>
          ) : (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`font-medium ${c.is_active ? 'text-gray-900' : 'text-gray-400'}`}>{c.name}</span>
                  {c.system ? <span className={getBadgeClass('gray')}>Del sistema</span> : null}
                  {c.needs_review && c.is_active ? <span className={getBadgeClass('yellow')}>A revisar</span> : null}
                  {!c.is_active ? <span className={getBadgeClass('gray')}>Desactivado</span> : null}
                </div>
                <div className={`mt-0.5 text-sm ${c.is_active ? 'text-gray-500' : 'text-gray-400'}`}>
                  {[
                    describeDefaults(c, BAND_LABELS),
                    `${c.uses ?? 0} ${c.uses === 1 ? 'ítem' : 'ítems'}`,
                    c.origin === 'liquidacion' || c.origin === 'migracion' ? ORIGIN_LABELS[c.origin] : null,
                  ].filter(Boolean).join(' · ')}
                </div>
                {!c.system && c.description ? <div className="mt-0.5 text-xs text-gray-400">{c.description}</div> : null}
              </div>

              {esAdmin ? (
                unificando?.id === c.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-gray-600">Unificar con</span>
                    <select className={`${fieldClass} w-56 py-1.5`} value={unificando.into} onChange={(e) => setUnificando({ id: c.id, into: e.target.value })}>
                      <option value="">Elegí el concepto</option>
                      {(() => {
                        const candidatos = todos.filter((o) => o.id !== c.id && !o.system && o.is_active);
                        const parecidos = similarConcepts(c.name, candidatos, 3);
                        const resto = candidatos.filter((o) => !parecidos.includes(o));
                        const opcion = (o: ItemConcept) => <option key={o.id} value={o.id}>{o.name}</option>;
                        return parecidos.length ? (
                          <>
                            <optgroup label="Parecidos">{parecidos.map(opcion)}</optgroup>
                            <optgroup label="Todos">{resto.map(opcion)}</optgroup>
                          </>
                        ) : resto.map(opcion);
                      })()}
                    </select>
                    <button type="button" className={`${accion} bg-blue-600 py-1.5 text-white hover:bg-blue-700 disabled:opacity-50`}
                      disabled={!unificando.into || unificar.isPending}
                      onClick={() => {
                        const destino = todos.find((o) => o.id === unificando.into)?.name;
                        const n = c.uses ?? 0;
                        const aviso = `${n === 1 ? 'El ítem' : `Los ${n} ítems`} de «${c.name}» ${n === 1 ? 'pasa' : 'pasan'} a «${destino}» y «${c.name}» deja de existir. ` +
                          'Lo confirmado conserva el nombre con que se confirmó. ¿Seguir?';
                        if (window.confirm(aviso)) unificar.mutate(unificando);
                      }}>
                      <Check className="h-4 w-4" /> Unificar
                    </button>
                    <button type="button" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100" aria-label="Cancelar" onClick={() => setUnificando(null)}><X className="h-4 w-4" /></button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-1">
                    {c.needs_review && c.is_active ? (
                      <button type="button" className={`${accion} text-green-700 hover:bg-green-50`} title="Queda como está"
                        onClick={() => guardar.mutate({ id: c.id, payload: { needs_review: false } })}>
                        <Check className="h-4 w-4" /> Confirmar
                      </button>
                    ) : null}
                    <button type="button" className={`${accion} text-gray-600 hover:bg-gray-100`} onClick={() => setEditando({ id: c.id, b: desde(c) })}>
                      <Pencil className="h-4 w-4" /> Editar
                    </button>
                    {!c.system ? (
                      <>
                        <button type="button" className={`${accion} text-gray-600 hover:bg-gray-100`} title="Pasar sus ítems a otro concepto"
                          onClick={() => setUnificando({ id: c.id, into: '' })}>
                          <Combine className="h-4 w-4" /> Unificar
                        </button>
                        {c.is_active ? (
                          <button type="button" className={`${accion} text-gray-500 hover:bg-gray-100`} title="Sale de la lista; los ítems que lo usan lo conservan"
                            onClick={() => guardar.mutate({ id: c.id, payload: { is_active: false } })}>
                            <EyeOff className="h-4 w-4" /> Desactivar
                          </button>
                        ) : (
                          <button type="button" className={`${accion} text-blue-700 hover:bg-blue-50`}
                            onClick={() => guardar.mutate({ id: c.id, payload: { is_active: true } })}>
                            <RotateCcw className="h-4 w-4" /> Reactivar
                          </button>
                        )}
                      </>
                    ) : null}
                  </div>
                )
              ) : null}
            </li>
          )
        )}
        {visibles.length === 0 ? (
          <li className="py-6 text-center text-sm text-gray-500">{filtro === 'revisar' ? 'No hay conceptos a revisar.' : 'No hay conceptos.'}</li>
        ) : null}
      </ul>

      {!esAdmin ? (
        <p className="mt-3 text-xs text-gray-500">Los cambios al catálogo los hace un administrador. Al liquidar, si falta un concepto, lo podés crear desde el ítem.</p>
      ) : null}
    </section>
  );
}
