import { useEffect, useMemo, useState, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Save } from 'lucide-react';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/utils';
import {
  cardClass,
  EmptyState,
  ErrorState,
  getMonthStart,
  getToday,
  getBadgeClass,
  inputClass,
  LoadingState,
  NormalizationResult,
  pageTitleClass,
  primaryButtonClass,
  secondaryButtonClass,
  useProfilesQuery,
} from '../shared';

function getOriginalTime(result: NormalizationResult, kind: 'clockin' | 'clockout') {
  const adjustment = (result.adjustments ?? []).find((item) => item.type?.includes(kind));
  return adjustment?.original ?? (kind === 'clockin' ? result.normalized_in : result.normalized_out);
}

/** Parse HH:mm to minutes since midnight */
function timeToMinutes(time: string): number {
  const parts = time.split(':');
  return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

/** Check if difference between two times exceeds threshold (in minutes) */
function timeDiffExceeds(original: string, normalized: string, thresholdMinutes: number): boolean {
  const diff = Math.abs(timeToMinutes(original.slice(0, 5)) - timeToMinutes(normalized.slice(0, 5)));
  return diff > thresholdMinutes;
}

const NIGHTTIME_START = 21 * 60; // 21:00
const NIGHTTIME_END = 6 * 60;   // 06:00

/** Locally compute daytime/nighttime hours from two HH:mm strings */
function computeLocalHours(inTime: string, outTime: string): { daytime: number; nighttime: number } {
  const inMin = timeToMinutes(inTime);
  const outMin = timeToMinutes(outTime);
  const totalMin = outMin > inMin ? outMin - inMin : outMin + 1440 - inMin;
  if (totalMin <= 0) return { daytime: 0, nighttime: 0 };

  let nighttimeMin = 0;
  for (let m = 0; m < totalMin; m++) {
    const current = (inMin + m) % 1440;
    if (current >= NIGHTTIME_START || current < NIGHTTIME_END) {
      nighttimeMin++;
    }
  }

  const daytime = Math.round(((totalMin - nighttimeMin) / 60) * 100) / 100;
  const nighttime = Math.round((nighttimeMin / 60) * 100) / 100;
  return { daytime, nighttime };
}

const WARN_THRESHOLD = 15;

function NormResultRow({
  result,
  index,
  isPersisted,
  onSave,
  isSaving,
}: {
  result: NormalizationResult;
  index: number;
  isPersisted: boolean;
  onSave: (id: string, payload: { normalized_in?: string; normalized_out?: string }) => void;
  isSaving: boolean;
}) {
  const [normIn, setNormIn] = useState(result.normalized_in.slice(0, 5));
  const [normOut, setNormOut] = useState(result.normalized_out.slice(0, 5));

  useEffect(() => {
    setNormIn(result.normalized_in.slice(0, 5));
    setNormOut(result.normalized_out.slice(0, 5));
  }, [result.normalized_in, result.normalized_out]);

  const originalIn = String(getOriginalTime(result, 'clockin')).slice(0, 5);
  const originalOut = String(getOriginalTime(result, 'clockout')).slice(0, 5);
  const warnIn = timeDiffExceeds(originalIn, normIn, WARN_THRESHOLD);
  const warnOut = timeDiffExceeds(originalOut, normOut, WARN_THRESHOLD);

  const isDirty = normIn !== result.normalized_in.slice(0, 5) || normOut !== result.normalized_out.slice(0, 5);

  // Recalculate hours locally when times change
  const localHours = useMemo(() => {
    if (isDirty) return computeLocalHours(normIn, normOut);
    return { daytime: result.daytime_hours, nighttime: result.nighttime_hours };
  }, [normIn, normOut, isDirty, result.daytime_hours, result.nighttime_hours]);

  const handleSave = useCallback(() => {
    if (!result.id || !isPersisted || !isDirty) return;
    const payload: { normalized_in?: string; normalized_out?: string } = {};
    if (normIn !== result.normalized_in.slice(0, 5)) payload.normalized_in = normIn;
    if (normOut !== result.normalized_out.slice(0, 5)) payload.normalized_out = normOut;
    onSave(result.id, payload);
  }, [result.id, isPersisted, isDirty, normIn, normOut, result.normalized_in, result.normalized_out, onSave]);

  return (
    <tr key={`${result.date}-${result.clock_entry_id ?? index}`}>
      <td className="px-4 py-3 text-sm text-gray-700">{formatDate(result.date)}</td>
      <td className="px-4 py-3 text-sm text-gray-700">{originalIn}</td>
      <td className="px-4 py-3 text-sm text-gray-700">{originalOut}</td>
      <td className="px-4 py-3 text-sm">
        <div className="flex items-center gap-1.5">
          <input
            type="time"
            className={`${inputClass} w-28 ${warnIn ? 'border-amber-400 bg-amber-50' : ''}`}
            value={normIn}
            onChange={(e) => setNormIn(e.target.value)}
            disabled={!isPersisted}
          />
          {warnIn && (
            <span className="text-amber-500" title={`Diferencia > ${WARN_THRESHOLD} min vs marcado (${originalIn})`}>
              <AlertTriangle className="h-4 w-4" />
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-sm">
        <div className="flex items-center gap-1.5">
          <input
            type="time"
            className={`${inputClass} w-28 ${warnOut ? 'border-amber-400 bg-amber-50' : ''}`}
            value={normOut}
            onChange={(e) => setNormOut(e.target.value)}
            disabled={!isPersisted}
          />
          {warnOut && (
            <span className="text-amber-500" title={`Diferencia > ${WARN_THRESHOLD} min vs marcado (${originalOut})`}>
              <AlertTriangle className="h-4 w-4" />
            </span>
          )}
        </div>
      </td>
      <td className={`px-4 py-3 text-sm ${isDirty ? 'text-blue-700 font-medium' : 'text-gray-700'}`}>
        D {localHours.daytime.toFixed(2)} / N {localHours.nighttime.toFixed(2)}
      </td>
      <td className="px-4 py-3 text-sm text-gray-700">
        <div className="flex flex-wrap gap-2">
          {(result.adjustments ?? []).length > 0 ? (result.adjustments ?? []).map((adjustment, adjustmentIndex) => (
            <span key={`${adjustment.type ?? 'adj'}-${adjustmentIndex}`} className={getBadgeClass(
              adjustment.type?.startsWith('manual_edit') ? 'yellow' : 'blue'
            )}>
              {adjustment.type ?? 'ajuste'}
            </span>
          )) : <span className={getBadgeClass('gray')}>Sin ajustes</span>}
        </div>
      </td>
      <td className="px-4 py-3 text-sm">
        {isPersisted && isDirty && (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            onClick={handleSave}
            disabled={isSaving}
            title="Guardar corrección"
          >
            <Save className="h-3.5 w-3.5" />
            Guardar
          </button>
        )}
      </td>
    </tr>
  );
}

export default function NormalizationPage() {
  const queryClient = useQueryClient();
  const profilesQuery = useProfilesQuery();
  const [profileId, setProfileId] = useState('');
  const [from, setFrom] = useState(getMonthStart());
  const [to, setTo] = useState(getToday());
  const [previewResults, setPreviewResults] = useState<NormalizationResult[]>([]);
  const [isPersisted, setIsPersisted] = useState(false);
  const [ruleForm, setRuleForm] = useState({ id: '', name: '', description: '', rule_text: '', is_active: true });

  useEffect(() => {
    if (!profileId && profilesQuery.data?.[0]) {
      setProfileId(profilesQuery.data[0].id);
    }
  }, [profileId, profilesQuery.data]);

  const rulesQuery = useQuery({
    queryKey: ['normalization-rules'],
    queryFn: () => api.get<Array<{ id: string; name: string; description: string; rule_text: string; is_active: boolean }>>('/rules/normalization'),
  });

  const previewMutation = useMutation({
    mutationFn: () => api.get<NormalizationResult[]>(`/normalization/preview/${profileId}?from=${from}&to=${to}`),
    onSuccess: (results) => {
      setPreviewResults(results);
      setIsPersisted(false);
    },
  });

  const runMutation = useMutation({
    mutationFn: () => api.post<{ normalized: number; results: NormalizationResult[] }>(`/normalization/run/${profileId}`, { from, to }),
    onSuccess: async (payload) => {
      setPreviewResults(payload.results);
      setIsPersisted(true);
      await queryClient.invalidateQueries({ queryKey: ['normalized', profileId, from, to] });
    },
  });

  const editEntryMutation = useMutation({
    mutationFn: ({ entryId, payload }: { entryId: string; payload: { normalized_in?: string; normalized_out?: string } }) =>
      api.patch<NormalizationResult>(`/normalization/entry/${entryId}`, payload),
    onSuccess: (updated) => {
      setPreviewResults((prev) =>
        prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r))
      );
    },
  });

  const saveRuleMutation = useMutation({
    mutationFn: () => ruleForm.id
      ? api.patch(`/rules/normalization/${ruleForm.id}`, ruleForm)
      : api.post('/rules/normalization', ruleForm),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['normalization-rules'] });
      setRuleForm({ id: '', name: '', description: '', rule_text: '', is_active: true });
    },
  });

  const deleteRuleMutation = useMutation({
    mutationFn: (ruleId: string) => api.delete<void>(`/rules/normalization/${ruleId}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['normalization-rules'] });
    },
  });

  const totalPreviewHours = useMemo(
    () => previewResults.reduce((sum, item) => sum + item.daytime_hours + item.nighttime_hours, 0),
    [previewResults],
  );

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <h1 className={pageTitleClass}>Normalización</h1>

        <section className={cardClass}>
          <div className="grid gap-4 md:grid-cols-4 lg:grid-cols-5">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Agente</label>
              <select className={inputClass} value={profileId} onChange={(event) => setProfileId(event.target.value)}>
                <option value="">Seleccionar agente</option>
                {(profilesQuery.data ?? []).map((profile) => <option key={profile.id} value={profile.id}>{profile.first_name} {profile.last_name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Desde</label>
              <input className={inputClass} type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Hasta</label>
              <input className={inputClass} type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </div>
            <div className="flex items-end gap-3 md:col-span-2">
              <button type="button" className={primaryButtonClass} onClick={() => previewMutation.mutate()} disabled={previewMutation.isPending || !profileId}>
                {previewMutation.isPending ? 'Cargando...' : 'Preview'}
              </button>
              <button type="button" className={secondaryButtonClass} onClick={() => runMutation.mutate()} disabled={runMutation.isPending || !profileId}>
                {runMutation.isPending ? 'Ejecutando...' : 'Run'}
              </button>
            </div>
          </div>
          {previewMutation.error ? <p className="mt-3 text-sm text-red-600">{(previewMutation.error as Error).message}</p> : null}
          {runMutation.error ? <p className="mt-3 text-sm text-red-600">{(runMutation.error as Error).message}</p> : null}
        </section>

        <section className={cardClass}>
          <div className="mb-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-gray-900">Resultados</h2>
              {isPersisted ? (
                <span className={getBadgeClass('green')}>Persistido</span>
              ) : previewResults.length > 0 ? (
                <span className={getBadgeClass('yellow')}>Preview (sin guardar)</span>
              ) : null}
            </div>
            <div className="text-sm text-gray-500">Horas totales: {totalPreviewHours.toFixed(2)}</div>
          </div>
          {!isPersisted && previewResults.length > 0 && (
            <p className="mb-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Los resultados son de solo lectura. Ejecutá <strong>Run</strong> para persistirlos y poder editarlos.
            </p>
          )}
          {editEntryMutation.error && (
            <p className="mb-3 text-sm text-red-600">{(editEntryMutation.error as Error).message}</p>
          )}
          {previewResults.length === 0 ? (
            <EmptyState message="No hay resultados para mostrar. Ejecutá una preview." />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Fecha</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Marcado ingreso</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Marcado egreso</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Norm. ingreso</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Norm. egreso</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Horas</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Ajustes</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {previewResults.map((result, index) => (
                    <NormResultRow
                      key={`${result.date}-${result.clock_entry_id ?? index}`}
                      result={result}
                      index={index}
                      isPersisted={isPersisted}
                      onSave={(entryId, payload) => editEntryMutation.mutate({ entryId, payload })}
                      isSaving={editEntryMutation.isPending}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={cardClass}>
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Reglas de normalización</h2>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); saveRuleMutation.mutate(); }}>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Nombre</label>
              <input className={inputClass} value={ruleForm.name} onChange={(event) => setRuleForm((current) => ({ ...current, name: event.target.value }))} required />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Descripción</label>
              <input className={inputClass} value={ruleForm.description} onChange={(event) => setRuleForm((current) => ({ ...current, description: event.target.value }))} required />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">Texto de regla</label>
              <textarea className={`${inputClass} min-h-28`} value={ruleForm.rule_text} onChange={(event) => setRuleForm((current) => ({ ...current, rule_text: event.target.value }))} required />
            </div>
            <label className="flex items-center gap-3 text-sm text-gray-700 md:col-span-2">
              <input type="checkbox" checked={ruleForm.is_active} onChange={(event) => setRuleForm((current) => ({ ...current, is_active: event.target.checked }))} />
              Regla activa
            </label>
            {saveRuleMutation.error ? <p className="md:col-span-2 text-sm text-red-600">{(saveRuleMutation.error as Error).message}</p> : null}
            <div className="md:col-span-2 flex gap-3">
              <button type="submit" className={primaryButtonClass} disabled={saveRuleMutation.isPending}>
                {saveRuleMutation.isPending ? 'Guardando...' : ruleForm.id ? 'Actualizar regla' : 'Agregar regla'}
              </button>
              <button type="button" className={secondaryButtonClass} onClick={() => setRuleForm({ id: '', name: '', description: '', rule_text: '', is_active: true })}>Limpiar</button>
            </div>
          </form>

          {rulesQuery.isLoading ? <div className="mt-6"><LoadingState message="Cargando reglas..." /></div> : null}
          {rulesQuery.error ? <div className="mt-6"><ErrorState message={(rulesQuery.error as Error).message} /></div> : null}
          {!rulesQuery.isLoading && !rulesQuery.error ? (
            <div className="mt-6 overflow-x-auto">
              {(rulesQuery.data ?? []).length === 0 ? (
                <EmptyState message="No hay reglas configuradas." />
              ) : (
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Nombre</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Descripción</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Estado</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {(rulesQuery.data ?? []).map((rule) => (
                      <tr key={rule.id}>
                        <td className="px-4 py-3 text-sm text-gray-700">{rule.name}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{rule.description}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          <span className={getBadgeClass(rule.is_active ? 'green' : 'gray')}>
                            {rule.is_active ? 'Activa' : 'Inactiva'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          <div className="flex gap-2">
                            <button type="button" className={secondaryButtonClass} onClick={() => setRuleForm(rule)}>Editar</button>
                            <button
                              type="button"
                              className="rounded-lg bg-red-100 px-4 py-2 text-red-700 hover:bg-red-200"
                              onClick={() => {
                                if (window.confirm('¿Eliminar regla?')) {
                                  deleteRuleMutation.mutate(rule.id);
                                }
                              }}
                            >
                              Eliminar
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
