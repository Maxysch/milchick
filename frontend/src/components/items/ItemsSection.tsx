import { useEffect, useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { BAND_LABELS, TIER_LABELS, formatCurrency, hourLabel } from '../../lib/utils';
import { KIND_LABELS, useConcepts, type ItemConcept, type ItemKind } from '../../lib/concepts';
import { useProfile } from '../../hooks/useProfile';
import ConceptPicker from './ConceptPicker';
import {
  cardClass,
  EmptyState,
  fieldClass,
  getBadgeClass,
  inputClass,
  primaryButtonClass,
  type PreSettlementItem,
} from '../../pages/shared';

const vacio = {
  concept: null as string | null,
  description: '',
  kind: 'fixed' as ItemKind,
  amount: '',
  percentage: '',
  // Por tiempo: se carga como minutos × días y se convierte en horas
  unitMinutes: '',
  days: '',
  band: 'day_ld',
  tier: 'normal',
  factor: '1',
};

const num = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));

/** "3% del subtotal", "45 min × 21 días = 15,75 h a Diurna LD" */
function comoSeCalcula(i: PreSettlementItem): string {
  const kind = i.kind ?? (i.is_percentage ? 'percentage' : 'fixed');
  if (kind === 'fixed') return 'Importe fijo';
  if (kind === 'percentage') {
    const pct = i.percentage !== null && i.percentage !== undefined ? Number(i.percentage) * 100 : null;
    return pct !== null ? `${String(Number(pct.toFixed(4))).replace('.', ',')}% del subtotal` : 'Porcentaje del subtotal';
  }
  const horas = Number(i.quantity ?? 0);
  const armado = i.unit_minutes && i.days ? `${i.unit_minutes} min × ${i.days} días = ` : '';
  const factor = i.factor !== null && i.factor !== undefined && Number(i.factor) !== 1 ? ` × ${String(i.factor).replace('.', ',')}` : '';
  return `${armado}${String(Number(horas.toFixed(2))).replace('.', ',')} h a ${hourLabel(i.band ?? 'day_ld', i.tier ?? 'normal')}${factor}`;
}

function FilaManual({
  item,
  conceptos,
  editable,
  revisa,
  onSave,
  onDelete,
}: {
  item: PreSettlementItem;
  conceptos: ItemConcept[];
  editable: boolean;
  revisa: boolean;
  onSave: (payload: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  const [descripcion, setDescripcion] = useState(item.description ?? '');
  const [importe, setImporte] = useState(String(item.amount));
  useEffect(() => {
    setDescripcion(item.description ?? '');
    setImporte(String(item.amount));
  }, [item]);
  const fijo = (item.kind ?? 'fixed') === 'fixed';

  // El concepto actual puede estar desactivado: igual se muestra en la lista
  const opciones = conceptos.some((c) => c.key === item.concept)
    ? conceptos
    : [...conceptos, { id: item.concept, key: item.concept, name: item.concept_label ?? item.concept } as ItemConcept];

  return (
    <tr className="align-top">
      <td className="px-4 py-3 text-sm">
        {editable ? (
          <ConceptPicker ariaLabel="Concepto del ítem" value={item.concept} concepts={opciones} revisa={revisa} onChange={(c) => c.key !== item.concept && onSave({ concept: c.key })} className="w-64" />
        ) : (
          <span className="font-medium text-gray-900">{item.concept_label ?? item.concept}</span>
        )}
      </td>
      <td className="px-4 py-3 text-sm text-gray-700">
        {editable ? (
          <input className={inputClass} aria-label="Descripción del ítem" placeholder="Por qué, en una línea" value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            onBlur={() => descripcion !== (item.description ?? '') && onSave({ description: descripcion || null })} />
        ) : (
          <span>{item.description ?? '—'}</span>
        )}
        <div className="mt-1 text-xs text-gray-500">{comoSeCalcula(item)}</div>
      </td>
      <td className="px-4 py-3 text-right text-sm font-medium text-gray-900 whitespace-nowrap">
        {editable && fijo ? (
          <input className={`${fieldClass} w-36 text-right`} aria-label="Importe del ítem" type="number" step="0.01" value={importe}
            onChange={(e) => setImporte(e.target.value)}
            onBlur={() => Number(importe) !== Number(item.amount) && onSave({ amount: Number(importe) })} />
        ) : (
          formatCurrency(Number(item.amount))
        )}
      </td>
      <td className="px-4 py-3 text-right">
        {editable ? (
          <button type="button" className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600" title="Sacar el ítem" aria-label="Sacar el ítem" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </button>
        ) : null}
      </td>
    </tr>
  );
}

/**
 * Los ítems de una preliquidación.
 *
 * Arriba de todo, los que calcula el sistema —REG, SUPER REG, antigüedad,
 * equipos, feriado, vacaciones, monotributo—: no se editan, salen de la
 * evaluación mensual y de los datos del agente. Abajo, los cargados a mano,
 * cada uno con un concepto del catálogo.
 */
export default function ItemsSection({
  preSettlementId,
  items,
  editable,
}: {
  preSettlementId: string;
  items: PreSettlementItem[];
  editable: boolean;
}) {
  const qc = useQueryClient();
  const { profile } = useProfile();
  const revisa = profile?.role !== 'admin';
  const conceptosQuery = useConcepts();
  const conceptos = (conceptosQuery.data ?? []).filter((c) => !c.system);
  const [form, setForm] = useState(vacio);
  const base = useId();
  const id = (k: string) => `${base}-${k}`;

  const refrescar = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['pre-settlement', preSettlementId] }),
      qc.invalidateQueries({ queryKey: ['pre-settlements'] }),
      qc.invalidateQueries({ queryKey: ['pre-settlement-summary'] }),
    ]);

  const minutos = Number(form.unitMinutes) || 0;
  const dias = Number(form.days) || 0;
  const horas = Math.round(((minutos * dias) / 60) * 10000) / 10000;

  const agregar = useMutation({
    mutationFn: () =>
      api.post(`/pre-settlements/${preSettlementId}/items`, {
        concept: form.concept,
        description: form.description || null,
        kind: form.kind,
        // El backend recalcula lo que corresponda; el importe sólo manda en `fixed`
        amount: form.kind === 'fixed' ? Number(form.amount) || 0 : 0,
        percentage: form.kind === 'percentage' ? (Number(form.percentage) || 0) / 100 : null,
        quantity: form.kind === 'hourly' ? horas : null,
        band: form.kind === 'hourly' ? form.band : null,
        tier: form.kind === 'hourly' ? form.tier : null,
        factor: form.kind === 'hourly' ? Number(form.factor) || 1 : null,
        unit_minutes: form.kind === 'hourly' ? minutos : null,
        days: form.kind === 'hourly' ? dias : null,
      }),
    onSuccess: async () => {
      setForm(vacio);
      await refrescar();
    },
  });
  const actualizar = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) => api.patch(`/pre-settlements/items/${id}`, payload),
    onSuccess: refrescar,
  });
  const borrar = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/pre-settlements/items/${id}`),
    onSuccess: refrescar,
  });

  // Elegir un concepto trae su forma de cálculo y sus valores por defecto
  const elegirConcepto = (c: ItemConcept) =>
    setForm((f) => ({
      ...f,
      concept: c.key,
      kind: c.kind,
      amount: c.kind === 'fixed' ? num(c.default_amount) : f.amount,
      percentage: c.kind === 'percentage' && c.default_percentage !== null ? String(Number((Number(c.default_percentage) * 100).toFixed(4))) : '',
      unitMinutes: c.kind === 'hourly' ? num(c.default_unit_minutes) : '',
      days: c.kind === 'hourly' ? num(c.default_days) : '',
      band: c.default_band ?? 'day_ld',
      tier: c.default_tier ?? 'normal',
      factor: c.default_factor !== null ? String(c.default_factor) : '1',
    }));

  const sistema = items.filter((i) => i.concept_system);
  const manuales = items.filter((i) => !i.concept_system);
  const listo =
    !!form.concept &&
    (form.kind !== 'hourly' || horas > 0) &&
    (form.kind !== 'percentage' || !!form.percentage) &&
    (form.kind !== 'fixed' || Number(form.amount) !== 0);

  return (
    <section className={cardClass}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-gray-900">Ítems</h2>
        {!editable ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-gray-500"><Lock className="h-4 w-4" /> Confirmada: los ítems no se cambian</span>
        ) : null}
      </div>

      {editable ? (
        <div className="mb-6 space-y-4 rounded-lg border border-gray-200 p-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label htmlFor={id('concept')} className="mb-1 block text-xs text-gray-600">Concepto</label>
              <ConceptPicker inputId={id('concept')} value={form.concept} concepts={conceptos} revisa={revisa} onChange={elegirConcepto} />
            </div>
            <div>
              <label htmlFor={id('description')} className="mb-1 block text-xs text-gray-600">Descripción</label>
              <input id={id('description')} className={inputClass} placeholder="Por qué, en una línea" value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
            <div>
              <label htmlFor={id('kind')} className="mb-1 block text-xs text-gray-600">Cómo se calcula</label>
              <select id={id('kind')} className={inputClass} value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as ItemKind }))}>
                {(Object.keys(KIND_LABELS) as ItemKind[]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
              </select>
            </div>
          </div>

          {form.kind === 'fixed' ? (
            <div className="md:w-48">
              <label htmlFor={id('amount')} className="mb-1 block text-xs text-gray-600">Importe</label>
              <input id={id('amount')} className={inputClass} type="number" step="0.01" value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
            </div>
          ) : null}

          {form.kind === 'percentage' ? (
            <div className="flex flex-wrap items-end gap-4">
              <div className="w-32">
                <label htmlFor={id('percentage')} className="mb-1 block text-xs text-gray-600">Porcentaje</label>
                <input id={id('percentage')} className={inputClass} type="number" step="0.5" min="0" max="100" value={form.percentage}
                  onChange={(e) => setForm((f) => ({ ...f, percentage: e.target.value }))} />
              </div>
              <div className="pb-2 text-sm text-gray-600">Sobre el subtotal de horas. Se recalcula si se corrigen las horas.</div>
            </div>
          ) : null}

          {form.kind === 'hourly' ? (
            <div className="space-y-3">
              <div className="grid gap-4 md:grid-cols-5">
                <div>
                  <label htmlFor={id('unitMinutes')} className="mb-1 block text-xs text-gray-600">Minutos por día</label>
                  <input id={id('unitMinutes')} className={inputClass} type="number" min="0" step="5" placeholder="45" value={form.unitMinutes}
                    onChange={(e) => setForm((f) => ({ ...f, unitMinutes: e.target.value }))} />
                </div>
                <div>
                  <label htmlFor={id('days')} className="mb-1 block text-xs text-gray-600">Días</label>
                  <input id={id('days')} className={inputClass} type="number" min="0" step="1" placeholder="21" value={form.days}
                    onChange={(e) => setForm((f) => ({ ...f, days: e.target.value }))} />
                </div>
                <div>
                  <label htmlFor={id('band')} className="mb-1 block text-xs text-gray-600">Valor hora</label>
                  <select id={id('band')} className={inputClass} value={form.band} onChange={(e) => setForm((f) => ({ ...f, band: e.target.value }))}>
                    {Object.entries(BAND_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor={id('tier')} className="mb-1 block text-xs text-gray-600">Tramo</label>
                  <select id={id('tier')} className={inputClass} value={form.tier} onChange={(e) => setForm((f) => ({ ...f, tier: e.target.value }))}>
                    {Object.entries(TIER_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor={id('factor')} className="mb-1 block text-xs text-gray-600">Factor</label>
                  <input id={id('factor')} className={inputClass} type="number" min="0" max="2" step="0.05" value={form.factor}
                    onChange={(e) => setForm((f) => ({ ...f, factor: e.target.value }))} />
                </div>
              </div>
              <p className="text-sm text-gray-600">
                {horas > 0 ? (
                  <>
                    {form.unitMinutes || 0} min × {form.days || 0} días = <strong className="text-gray-900">{horas.toFixed(2)} h</strong>{' '}
                    a {hourLabel(form.band, form.tier)}
                    {Number(form.factor) !== 1 && ` × ${form.factor}`}
                  </>
                ) : 'Cargá los minutos por día y la cantidad de días.'}
              </p>
            </div>
          ) : null}

          {agregar.error ? <p className="text-sm text-red-600">{(agregar.error as Error).message}</p> : null}

          <button type="button" className={primaryButtonClass} onClick={() => agregar.mutate()} disabled={agregar.isPending || !listo}>
            {agregar.isPending ? 'Agregando...' : 'Agregar ítem'}
          </button>
        </div>
      ) : null}

      {items.length === 0 ? (
        <EmptyState message="No hay ítems." />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Concepto</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Descripción</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Importe</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {sistema.map((i) => (
                <tr key={i.id} className="align-top bg-gray-50/40">
                  <td className="px-4 py-3 text-sm">
                    <div className="font-medium text-gray-900">{i.concept_label ?? i.concept}</div>
                    <span className={`${getBadgeClass('gray')} mt-1 inline-block`} title="Sale de la evaluación mensual y de los datos del agente">Automático</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{i.description ?? '—'}</td>
                  <td className="px-4 py-3 text-right text-sm font-medium text-gray-900 whitespace-nowrap">{formatCurrency(Number(i.amount))}</td>
                  <td />
                </tr>
              ))}
              {manuales.map((i) => (
                <FilaManual
                  key={i.id}
                  item={i}
                  conceptos={conceptos}
                  editable={editable}
                  revisa={revisa}
                  onSave={(payload) => actualizar.mutate({ id: i.id, payload })}
                  onDelete={() => { if (window.confirm('¿Sacar el ítem?')) borrar.mutate(i.id); }}
                />
              ))}
            </tbody>
          </table>
          {actualizar.error || borrar.error ? (
            <p className="mt-2 text-sm text-red-600">{((actualizar.error ?? borrar.error) as Error).message}</p>
          ) : null}
        </div>
      )}
    </section>
  );
}
