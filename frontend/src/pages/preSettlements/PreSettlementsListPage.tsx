import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Check, Download, Play, X } from 'lucide-react';
import { api } from '../../lib/api';
import { formatCurrency, formatDate, SETTLEMENT_STATUS_LABELS } from '../../lib/utils';
import {
  BulkResult,
  cardClass,
  EmptyState,
  ErrorState,
  getBadgeClass,
  getProfileRelationName,
  inputClass,
  LoadingState,
  pageTitleClass,
  PeriodSummaryRow,
  PreSettlementRecord,
  primaryButtonClass,
  secondaryButtonClass,
  useProfilesQuery,
} from '../shared';

/** Mes actual en formato YYYY-MM, que es lo que espera <input type="month">. */
function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default function PreSettlementsListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const profilesQuery = useProfilesQuery();

  const [month, setMonth] = useState(currentMonth());
  const [bulkResults, setBulkResults] = useState<BulkResult[] | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // El período no es el mes calendario: el backend sabe dónde corta.
  const [year, monthNumber] = month.split('-').map(Number);
  const periodQuery = useQuery({
    queryKey: ['period', year, monthNumber],
    queryFn: () => api.get<{ from: string; to: string; period_start_day: number }>(
      `/pre-settlements/period?year=${year}&month=${monthNumber}`
    ),
    enabled: Number.isFinite(year) && Number.isFinite(monthNumber),
  });

  const from = periodQuery.data?.from;
  const to = periodQuery.data?.to;

  const listQuery = useQuery({
    queryKey: ['pre-settlements'],
    queryFn: () => api.get<PreSettlementRecord[]>('/pre-settlements'),
  });

  const summaryQuery = useQuery({
    queryKey: ['pre-settlement-summary', from, to],
    queryFn: () => api.get<PeriodSummaryRow[]>(`/pre-settlements/summary?from=${from}&to=${to}`),
    enabled: Boolean(from && to),
  });

  useEffect(() => setBulkResults(null), [month]);

  const singleMutation = useMutation({
    mutationFn: (profileId: string) =>
      api.post<{ preSettlement: { id: string } }>('/pre-settlements/generate', {
        profile_id: profileId,
        period_from: from,
        period_to: to,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['pre-settlements'] });
      await queryClient.invalidateQueries({ queryKey: ['pre-settlement-summary'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const bulkMutation = useMutation({
    mutationFn: () =>
      api.post<BulkResult[]>('/pre-settlements/generate-bulk', {
        period_from: from,
        period_to: to,
      }),
    onSuccess: async (results) => {
      setBulkResults(results);
      await queryClient.invalidateQueries({ queryKey: ['pre-settlements'] });
      await queryClient.invalidateQueries({ queryKey: ['pre-settlement-summary'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const summary = summaryQuery.data ?? [];
  const totalNet = summary.reduce((s, r) => s + r.net, 0);
  const totalPending = summary.reduce((s, r) => s + r.pending_warnings, 0);

  const activeAgents = (profilesQuery.data ?? []).filter(
    (p) => p.role === 'agent' && p.is_active
  );
  const generated = new Set(summary.map((r) => r.profile_id));
  const pendingAgents = activeAgents.filter((p) => !generated.has(p.id));

  const handleDownload = async () => {
    setDownloadError(null);
    try {
      await api.download(
        `/pre-settlements/summary?from=${from}&to=${to}&format=csv`,
        `resumen-${from}_${to}.csv`
      );
    } catch (err) {
      setDownloadError((err as Error).message);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <h1 className={pageTitleClass}>Preliquidaciones</h1>

        {/* ── Período ── */}
        <section className={cardClass}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Mes a liquidar</label>
                <input
                  className={`${inputClass} w-44`}
                  type="month"
                  value={month}
                  onChange={(event) => setMonth(event.target.value)}
                />
              </div>
              {from && to ? (
                <div className="pb-2 text-sm text-gray-600">
                  Período: <strong className="text-gray-900">{formatDate(from)} al {formatDate(to)}</strong>
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className={primaryButtonClass}
                disabled={bulkMutation.isPending || !from || pendingAgents.length === 0}
                onClick={() => bulkMutation.mutate()}
              >
                <Play className="mr-1 inline h-4 w-4" />
                {bulkMutation.isPending
                  ? 'Generando...'
                  : pendingAgents.length === 0
                    ? 'Todos generados'
                    : `Generar los ${pendingAgents.length} que faltan`}
              </button>
              <button
                type="button"
                className={secondaryButtonClass}
                disabled={summary.length === 0}
                onClick={handleDownload}
              >
                <Download className="mr-1 inline h-4 w-4" />
                Exportar resumen
              </button>
            </div>
          </div>

          {bulkMutation.error ? (
            <p className="mt-3 text-sm text-red-600">{(bulkMutation.error as Error).message}</p>
          ) : null}
          {downloadError ? <p className="mt-3 text-sm text-red-600">{downloadError}</p> : null}
        </section>

        {/* ── Resultado de la corrida ── */}
        {bulkResults ? (
          <section className={cardClass}>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">Resultado de la generación</h2>
            <div className="space-y-1">
              {bulkResults.map((r) => (
                <div key={r.profile_id} className="flex flex-wrap items-center gap-2 text-sm">
                  {r.status === 'generated' ? <Check className="h-4 w-4 text-green-600" /> : null}
                  {r.status === 'skipped' ? <AlertTriangle className="h-4 w-4 text-amber-600" /> : null}
                  {r.status === 'failed' ? <X className="h-4 w-4 text-red-600" /> : null}
                  <span className="font-medium text-gray-900">{r.name}</span>
                  {r.status === 'generated' ? (
                    <>
                      <span className="text-gray-600">{formatCurrency(r.total_amount ?? 0)}</span>
                      {r.warnings ? (
                        <span className={getBadgeClass('yellow')}>{r.warnings} desvíos</span>
                      ) : (
                        <span className={getBadgeClass('green')}>sin desvíos</span>
                      )}
                    </>
                  ) : (
                    <span className="text-gray-500">{r.reason}</span>
                  )}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* ── Resumen del período ── */}
        <section className={cardClass}>
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold text-gray-900">Resumen del período</h2>
            {summary.length > 0 ? (
              <div className="flex flex-wrap items-center gap-4 text-sm">
                {totalPending > 0 ? (
                  <span className={getBadgeClass('yellow')}>{totalPending} desvíos sin revisar</span>
                ) : (
                  <span className={getBadgeClass('green')}>Todo revisado</span>
                )}
                <span className="text-gray-600">
                  Total a pagar <strong className="text-gray-900">{formatCurrency(totalNet)}</strong>
                </span>
              </div>
            ) : null}
          </div>

          {summaryQuery.isLoading ? <LoadingState message="Cargando resumen..." /> : null}
          {summaryQuery.error ? <ErrorState message={(summaryQuery.error as Error).message} /> : null}

          {!summaryQuery.isLoading && summary.length === 0 && pendingAgents.length === 0 ? (
            <EmptyState message="No hay agentes activos para liquidar." />
          ) : null}

          {summary.length > 0 || pendingAgents.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Agente</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Horas</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Honorarios</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Conceptos</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Neto</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {summary.map((row) => {
                    const conceptsTotal =
                      Object.values(row.concepts).reduce((s, v) => s + v, 0) + row.manual_items;
                    return (
                      <tr
                        key={row.pre_settlement_id}
                        className="cursor-pointer hover:bg-gray-50"
                        onClick={() => navigate(`/pre-settlements/${row.pre_settlement_id}`)}
                      >
                        <td className="px-4 py-3 text-sm text-gray-700">{row.name}</td>
                        <td className="px-4 py-3 text-right text-sm text-gray-700">{row.hours.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right text-sm text-gray-700">{formatCurrency(row.subtotal)}</td>
                        <td className="px-4 py-3 text-right text-sm text-gray-700">{formatCurrency(conceptsTotal)}</td>
                        <td className="px-4 py-3 text-right text-sm font-medium text-gray-900">{formatCurrency(row.net)}</td>
                        <td className="px-4 py-3 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={getBadgeClass(row.status === 'confirmed' ? 'green' : row.status === 'cancelled' ? 'red' : 'yellow')}>
                              {SETTLEMENT_STATUS_LABELS[row.status] ?? row.status}
                            </span>
                            {row.pending_warnings > 0 ? (
                              <span className="text-xs text-amber-700">
                                {row.pending_warnings} sin revisar
                              </span>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {/* Los que todavía no tienen preliquidación en el período.
                      Se pueden generar de a uno desde acá. */}
                  {pendingAgents.map((agent) => (
                    <tr key={agent.id} className="bg-gray-50/60">
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {agent.last_name}, {agent.first_name}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-gray-400" colSpan={4}>
                        Sin generar
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <button
                          type="button"
                          className={secondaryButtonClass}
                          disabled={singleMutation.isPending || bulkMutation.isPending || !from}
                          onClick={() => singleMutation.mutate(agent.id)}
                        >
                          {singleMutation.isPending && singleMutation.variables === agent.id
                            ? 'Generando...'
                            : 'Generar'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {singleMutation.error ? (
            <p className="mt-3 text-sm text-red-600">{(singleMutation.error as Error).message}</p>
          ) : null}
        </section>

        {/* ── Historial ── */}
        <section className={cardClass}>
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Todas las preliquidaciones</h2>

          {listQuery.isLoading ? <LoadingState message="Cargando..." /> : null}
          {listQuery.error ? <ErrorState message={(listQuery.error as Error).message} /> : null}

          {!listQuery.isLoading && (listQuery.data ?? []).length === 0 ? (
            <EmptyState message="No hay preliquidaciones generadas." />
          ) : null}

          {(listQuery.data ?? []).length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Agente</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Período</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Estado</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {(listQuery.data ?? []).map((row) => (
                    <tr key={row.id} className="cursor-pointer hover:bg-gray-50" onClick={() => navigate(`/pre-settlements/${row.id}`)}>
                      <td className="px-4 py-3 text-sm text-gray-700">{getProfileRelationName(row.profiles)}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{formatDate(row.period_from)} - {formatDate(row.period_to)}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        <span className={getBadgeClass(row.status === 'confirmed' ? 'green' : row.status === 'cancelled' ? 'red' : 'yellow')}>
                          {SETTLEMENT_STATUS_LABELS[row.status] ?? row.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-medium text-gray-900">{formatCurrency(row.total_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
