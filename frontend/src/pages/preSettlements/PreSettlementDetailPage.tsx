import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { formatCurrency, formatDate, HOUR_TYPE_LABELS } from '../../lib/utils';
import {
  cardClass,
  EmptyState,
  ErrorState,
  getBadgeClass,
  getProfileRelationName,
  getRelationName,
  inputClass,
  LoadingState,
  pageTitleClass,
  PreSettlementDailyLine,
  PreSettlementDetail,
  PreSettlementItem,
  primaryButtonClass,
} from '../shared';

function DailyRow({ line, onSave }: { line: PreSettlementDailyLine; onSave: (id: string, payload: { hours?: number; rate_per_hour?: number }) => void }) {
  const [hours, setHours] = useState(String(line.hours));
  const [rate, setRate] = useState(String(line.rate_per_hour));

  useEffect(() => {
    setHours(String(line.hours));
    setRate(String(line.rate_per_hour));
  }, [line.hours, line.rate_per_hour]);

  const computedAmount = (Number(hours || 0) * Number(rate || 0)) || 0;

  return (
    <tr>
      <td className="px-4 py-3 text-sm text-gray-700">{formatDate(line.date)}</td>
      <td className="px-4 py-3 text-sm text-gray-700">{HOUR_TYPE_LABELS[line.hour_type]}</td>
      <td className="px-4 py-3 text-sm text-gray-700">
        <input
          className={inputClass}
          type="number"
          min="0"
          step="0.25"
          value={hours}
          onChange={(event) => setHours(event.target.value)}
          onBlur={() => {
            const value = Number(hours);
            if (value !== line.hours) {
              onSave(line.id, { hours: value });
            }
          }}
        />
      </td>
      <td className="px-4 py-3 text-sm text-gray-700">
        <input
          className={inputClass}
          type="number"
          min="0"
          step="0.01"
          value={rate}
          onChange={(event) => setRate(event.target.value)}
          onBlur={() => {
            const value = Number(rate);
            if (value !== line.rate_per_hour) {
              onSave(line.id, { rate_per_hour: value });
            }
          }}
        />
      </td>
      <td className="px-4 py-3 text-sm font-medium text-gray-900">{formatCurrency(computedAmount)}</td>
      <td className="px-4 py-3 text-sm text-gray-700">{getRelationName(line.clients)}</td>
      <td className="px-4 py-3 text-sm text-gray-700">
        {line.is_projected ? <span className={getBadgeClass('blue')}>Proyectado</span> : <span className={getBadgeClass('gray')}>Real</span>}
      </td>
    </tr>
  );
}

function ItemRow({ item, onSave, onDelete }: { item: PreSettlementItem; onSave: (id: string, payload: Partial<PreSettlementItem>) => void; onDelete: (id: string) => void }) {
  const [concept, setConcept] = useState(item.concept);
  const [description, setDescription] = useState(item.description ?? '');
  const [amount, setAmount] = useState(String(item.amount));
  const [percentageBase, setPercentageBase] = useState(item.percentage_base ?? '');
  const [isPercentage, setIsPercentage] = useState(item.is_percentage);

  useEffect(() => {
    setConcept(item.concept);
    setDescription(item.description ?? '');
    setAmount(String(item.amount));
    setPercentageBase(item.percentage_base ?? '');
    setIsPercentage(item.is_percentage);
  }, [item]);

  return (
    <tr>
      <td className="px-4 py-3 text-sm text-gray-700">
        <input className={inputClass} value={concept} onChange={(event) => setConcept(event.target.value)} onBlur={() => concept !== item.concept && onSave(item.id, { concept })} />
      </td>
      <td className="px-4 py-3 text-sm text-gray-700">
        <input className={inputClass} value={description} onChange={(event) => setDescription(event.target.value)} onBlur={() => description !== (item.description ?? '') && onSave(item.id, { description: description || null })} />
      </td>
      <td className="px-4 py-3 text-sm text-gray-700">
        <input className={inputClass} type="number" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} onBlur={() => Number(amount) !== item.amount && onSave(item.id, { amount: Number(amount) })} />
      </td>
      <td className="px-4 py-3 text-sm text-gray-700">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isPercentage}
            onChange={(event) => {
              const checked = event.target.checked;
              setIsPercentage(checked);
              if (checked !== item.is_percentage) {
                onSave(item.id, { is_percentage: checked });
              }
            }}
          />
          Sí
        </label>
      </td>
      <td className="px-4 py-3 text-sm text-gray-700">
        <input className={inputClass} value={percentageBase} onChange={(event) => setPercentageBase(event.target.value)} onBlur={() => percentageBase !== (item.percentage_base ?? '') && onSave(item.id, { percentage_base: percentageBase || null })} />
      </td>
      <td className="px-4 py-3 text-sm text-gray-700">
        <button type="button" className="rounded-lg bg-red-100 px-3 py-2 text-red-700 hover:bg-red-200" onClick={() => onDelete(item.id)}>
          <Trash2 className="h-4 w-4" />
        </button>
      </td>
    </tr>
  );
}

export default function PreSettlementDetailPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const [newItem, setNewItem] = useState({ concept: '', description: '', amount: '0', is_percentage: false, percentage_base: '' });

  const detailQuery = useQuery({
    queryKey: ['pre-settlement', id],
    queryFn: () => api.get<PreSettlementDetail>(`/pre-settlements/${id}`),
    enabled: Boolean(id),
  });

  const dailyMutation = useMutation({
    mutationFn: ({ lineId, payload }: { lineId: string; payload: { hours?: number; rate_per_hour?: number } }) => api.patch(`/pre-settlements/daily/${lineId}`, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['pre-settlement', id] });
      await queryClient.invalidateQueries({ queryKey: ['pre-settlements'] });
    },
  });

  const itemMutation = useMutation({
    mutationFn: ({ itemId, payload }: { itemId: string; payload: Partial<PreSettlementItem> }) => api.patch(`/pre-settlements/items/${itemId}`, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['pre-settlement', id] });
      await queryClient.invalidateQueries({ queryKey: ['pre-settlements'] });
    },
  });

  const addItemMutation = useMutation({
    mutationFn: () => api.post(`/pre-settlements/${id}/items`, {
      concept: newItem.concept,
      description: newItem.description || null,
      amount: Number(newItem.amount),
      is_percentage: newItem.is_percentage,
      percentage_base: newItem.percentage_base || null,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['pre-settlement', id] });
      await queryClient.invalidateQueries({ queryKey: ['pre-settlements'] });
      setNewItem({ concept: '', description: '', amount: '0', is_percentage: false, percentage_base: '' });
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: (itemId: string) => api.delete<void>(`/pre-settlements/items/${itemId}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['pre-settlement', id] });
      await queryClient.invalidateQueries({ queryKey: ['pre-settlements'] });
    },
  });

  const statusMutation = useMutation({
    mutationFn: (status: 'confirmed' | 'cancelled') => api.patch(`/pre-settlements/${id}/status`, { status }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['pre-settlement', id] });
      await queryClient.invalidateQueries({ queryKey: ['pre-settlements'] });
    },
  });

  const grandTotal = useMemo(() => {
    const detail = detailQuery.data;
    if (!detail) return 0;
    const dailyTotal = detail.daily.reduce((sum, item) => sum + item.amount, 0);
    const itemsTotal = detail.items.reduce((sum, item) => sum + item.amount, 0);
    return dailyTotal + itemsTotal;
  }, [detailQuery.data]);

  if (detailQuery.isLoading) {
    return <div className="min-h-screen bg-gray-50 px-4 py-8"><div className="mx-auto max-w-7xl"><LoadingState message="Cargando detalle..." /></div></div>;
  }

  if (detailQuery.error || !detailQuery.data) {
    return <div className="min-h-screen bg-gray-50 px-4 py-8"><div className="mx-auto max-w-7xl"><ErrorState message={(detailQuery.error as Error)?.message ?? 'No se encontró la preliquidación.'} /></div></div>;
  }

  const detail = detailQuery.data;

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <Link to="/pre-settlements" className="mb-3 inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700">
            <ArrowLeft className="h-4 w-4" />
            Volver
          </Link>
          <h1 className={`${pageTitleClass} mb-2`}>Detalle de preliquidación</h1>
          <div className={`${cardClass} flex flex-col gap-3 md:flex-row md:items-center md:justify-between`}>
            <div>
              <div className="text-lg font-semibold text-gray-900">{getProfileRelationName(detail.profiles)}</div>
              <div className="text-sm text-gray-500">{formatDate(detail.period_from)} - {formatDate(detail.period_to)}</div>
            </div>
            <div className="flex items-center gap-4">
              <span className={getBadgeClass(detail.status === 'confirmed' ? 'green' : detail.status === 'cancelled' ? 'red' : 'yellow')}>
                {detail.status}
              </span>
              <div className="text-xl font-semibold text-gray-900">{formatCurrency(detail.total_amount)}</div>
            </div>
          </div>
        </div>

        <section className={cardClass}>
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Desglose diario</h2>
          {detail.daily.length === 0 ? (
            <EmptyState message="No hay líneas diarias cargadas." />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Fecha</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Tipo</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Horas</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Tarifa</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Importe</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Cliente</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Origen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {detail.daily.map((line) => (
                    <DailyRow key={line.id} line={line} onSave={(lineId, payload) => dailyMutation.mutate({ lineId, payload })} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Object.entries(detail.totals_by_type).map(([hourType, totals]) => (
            <div key={hourType} className={cardClass}>
              <div className="text-sm text-gray-500">{HOUR_TYPE_LABELS[hourType] ?? hourType}</div>
              <div className="mt-2 text-xl font-semibold text-gray-900">{totals.hours.toFixed(2)} hs</div>
              <div className="mt-1 text-sm text-gray-600">{formatCurrency(totals.amount)}</div>
            </div>
          ))}
        </section>

        <section className={cardClass}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-gray-900">Ítems</h2>
          </div>
          <div className="mb-6 grid gap-4 md:grid-cols-5">
            <input className={inputClass} placeholder="Concepto" value={newItem.concept} onChange={(event) => setNewItem((current) => ({ ...current, concept: event.target.value }))} />
            <input className={inputClass} placeholder="Descripción" value={newItem.description} onChange={(event) => setNewItem((current) => ({ ...current, description: event.target.value }))} />
            <input className={inputClass} type="number" step="0.01" value={newItem.amount} onChange={(event) => setNewItem((current) => ({ ...current, amount: event.target.value }))} />
            <input className={inputClass} placeholder="Base %" value={newItem.percentage_base} onChange={(event) => setNewItem((current) => ({ ...current, percentage_base: event.target.value }))} />
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={newItem.is_percentage} onChange={(event) => setNewItem((current) => ({ ...current, is_percentage: event.target.checked }))} />
                %
              </label>
              <button type="button" className={primaryButtonClass} onClick={() => addItemMutation.mutate()} disabled={addItemMutation.isPending || !newItem.concept.trim()}>
                Agregar
              </button>
            </div>
          </div>

          {detail.items.length === 0 ? (
            <EmptyState message="No hay ítems adicionales." />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Concepto</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Descripción</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Monto</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">%</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Base</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {detail.items.map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      onSave={(itemId, payload) => itemMutation.mutate({ itemId, payload })}
                      onDelete={(itemId) => {
                        if (window.confirm('¿Eliminar ítem?')) {
                          deleteItemMutation.mutate(itemId);
                        }
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={`${cardClass} flex flex-col gap-4 md:flex-row md:items-center md:justify-between`}>
          <div>
            <div className="text-sm text-gray-500">Total general</div>
            <div className="text-2xl font-semibold text-gray-900">{formatCurrency(grandTotal)}</div>
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="button" className={primaryButtonClass} onClick={() => statusMutation.mutate('confirmed')} disabled={statusMutation.isPending}>Confirmar</button>
            <button type="button" className="rounded-lg bg-red-600 px-4 py-2 text-white hover:bg-red-700" onClick={() => statusMutation.mutate('cancelled')} disabled={statusMutation.isPending}>Cancelar</button>
          </div>
        </section>
      </div>
    </div>
  );
}
