import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import {
  cardClass,
  EmptyState,
  ErrorState,
  getBadgeClass,
  getProfileRelationName,
  getToday,
  inputClass,
  LoadingState,
  pageTitleClass,
  PreSettlementRecord,
  primaryButtonClass,
  secondaryButtonClass,
  useProfilesQuery,
} from '../shared';

function getPeriodStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
}

export default function PreSettlementsListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const profilesQuery = useProfilesQuery();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [profileId, setProfileId] = useState('');
  const [periodFrom, setPeriodFrom] = useState(getPeriodStart());
  const [periodTo, setPeriodTo] = useState(getToday());

  useEffect(() => {
    if (!profileId && profilesQuery.data?.[0]) {
      setProfileId(profilesQuery.data[0].id);
    }
  }, [profileId, profilesQuery.data]);

  const preSettlementsQuery = useQuery({
    queryKey: ['pre-settlements'],
    queryFn: () => api.get<PreSettlementRecord[]>('/pre-settlements'),
  });

  const generateMutation = useMutation({
    mutationFn: () => api.post<{ preSettlement?: { id: string }; id?: string }>('/pre-settlements/generate', {
      profile_id: profileId,
      period_from: periodFrom,
      period_to: periodTo,
    }),
    onSuccess: async (response) => {
      await queryClient.invalidateQueries({ queryKey: ['pre-settlements'] });
      setIsModalOpen(false);
      const newId = response.preSettlement && typeof response.preSettlement === 'object' && 'id' in response.preSettlement
        ? response.preSettlement.id
        : response.id;
      if (newId) {
        navigate(`/pre-settlements/${newId}`);
      }
    },
  });

  const sortedRows = useMemo(() => preSettlementsQuery.data ?? [], [preSettlementsQuery.data]);

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className={`${pageTitleClass} mb-0`}>Preliquidaciones</h1>
          <button type="button" className={primaryButtonClass} onClick={() => setIsModalOpen(true)}>Generar nueva</button>
        </div>

        {preSettlementsQuery.isLoading ? <LoadingState message="Cargando preliquidaciones..." /> : null}
        {preSettlementsQuery.error ? <ErrorState message={(preSettlementsQuery.error as Error).message} /> : null}

        {!preSettlementsQuery.isLoading && !preSettlementsQuery.error ? (
          <section className={cardClass}>
            {sortedRows.length === 0 ? (
              <EmptyState message="No hay preliquidaciones generadas." />
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Agente</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Período</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Estado</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {sortedRows.map((row) => (
                      <tr key={row.id} className="cursor-pointer hover:bg-gray-50" onClick={() => navigate(`/pre-settlements/${row.id}`)}>
                        <td className="px-4 py-3 text-sm text-gray-700">{getProfileRelationName(row.profiles)}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{formatDate(row.period_from)} - {formatDate(row.period_to)}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          <span className={getBadgeClass(row.status === 'confirmed' ? 'green' : row.status === 'cancelled' ? 'red' : 'yellow')}>
                            {row.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{formatCurrency(row.total_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : null}

        {isModalOpen ? (
          <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 px-4">
            <div className={`${cardClass} w-full max-w-lg`}>
              <h2 className="mb-4 text-lg font-semibold text-gray-900">Generar preliquidación</h2>
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Agente</label>
                  <select className={inputClass} value={profileId} onChange={(event) => setProfileId(event.target.value)}>
                    <option value="">Seleccionar agente</option>
                    {(profilesQuery.data ?? []).map((profile) => <option key={profile.id} value={profile.id}>{profile.first_name} {profile.last_name}</option>)}
                  </select>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">Desde</label>
                    <input className={inputClass} type="date" value={periodFrom} onChange={(event) => setPeriodFrom(event.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">Hasta</label>
                    <input className={inputClass} type="date" value={periodTo} onChange={(event) => setPeriodTo(event.target.value)} />
                  </div>
                </div>
                {generateMutation.error ? <p className="text-sm text-red-600">{(generateMutation.error as Error).message}</p> : null}
                <div className="flex gap-3">
                  <button type="button" className={primaryButtonClass} onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending || !profileId}>
                    {generateMutation.isPending ? 'Generando...' : 'Generar'}
                  </button>
                  <button type="button" className={secondaryButtonClass} onClick={() => setIsModalOpen(false)}>Cancelar</button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
