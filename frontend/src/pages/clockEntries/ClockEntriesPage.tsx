import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/utils';
import {
  cardClass,
  EmptyState,
  ErrorState,
  getMonthStart,
  getRelationName,
  getToday,
  inputClass,
  LoadingState,
  pageTitleClass,
  primaryButtonClass,
  secondaryButtonClass,
  useClientsQuery,
  useProfilesQuery,
} from '../shared';

const emptyForm = {
  id: '',
  date: getToday(),
  clock_in: '',
  clock_out: '',
  client_id: '',
  notes: '',
};

export default function ClockEntriesPage() {
  const queryClient = useQueryClient();
  const profilesQuery = useProfilesQuery();
  const clientsQuery = useClientsQuery();
  const [profileId, setProfileId] = useState('');
  const [from, setFrom] = useState(getMonthStart());
  const [to, setTo] = useState(getToday());
  const [form, setForm] = useState(emptyForm);
  const [bulkText, setBulkText] = useState('');

  useEffect(() => {
    if (!profileId && profilesQuery.data?.[0]) {
      setProfileId(profilesQuery.data[0].id);
    }
  }, [profileId, profilesQuery.data]);

  const entriesQuery = useQuery({
    queryKey: ['clock-entries', profileId, from, to],
    queryFn: () => api.get(`/clock-entries/profile/${profileId}?from=${from}&to=${to}`),
    enabled: Boolean(profileId),
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        profile_id: profileId,
        date: form.date,
        clock_in: form.clock_in,
        clock_out: form.clock_out || null,
        client_id: form.client_id || null,
        notes: form.notes || null,
      };
      return form.id ? api.patch(`/clock-entries/${form.id}`, payload) : api.post('/clock-entries', payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['clock-entries', profileId, from, to] });
      setForm(emptyForm);
    },
  });

  const bulkMutation = useMutation({
    mutationFn: () => {
      const entries = bulkText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [date, clock_in, clock_out, client_id, ...notesParts] = line.split(',');
          return {
            profile_id: profileId,
            date: date?.trim(),
            clock_in: clock_in?.trim(),
            clock_out: clock_out?.trim() || null,
            client_id: client_id?.trim() || null,
            notes: notesParts.join(',').trim() || null,
          };
        });

      return api.post('/clock-entries/bulk', { entries });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['clock-entries', profileId, from, to] });
      setBulkText('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (entryId: string) => api.delete<void>(`/clock-entries/${entryId}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['clock-entries', profileId, from, to] });
    },
  });

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <h1 className={pageTitleClass}>Marcaciones</h1>

        <section className={cardClass}>
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-4">
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
          </div>
        </section>

        <section className={cardClass}>
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Carga individual</h2>
          <form className="grid gap-4 md:grid-cols-5" onSubmit={(event) => { event.preventDefault(); saveMutation.mutate(); }}>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Fecha</label>
              <input className={inputClass} type="date" value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} required />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Ingreso</label>
              <input className={inputClass} type="time" value={form.clock_in} onChange={(event) => setForm((current) => ({ ...current, clock_in: event.target.value }))} required />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Egreso</label>
              <input className={inputClass} type="time" value={form.clock_out} onChange={(event) => setForm((current) => ({ ...current, clock_out: event.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Cliente</label>
              <select className={inputClass} value={form.client_id} onChange={(event) => setForm((current) => ({ ...current, client_id: event.target.value }))}>
                <option value="">Sin cliente</option>
                {(clientsQuery.data ?? []).map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Notas</label>
              <input className={inputClass} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
            </div>
            <div className="md:col-span-5 flex gap-3">
              <button type="submit" className={primaryButtonClass} disabled={saveMutation.isPending || !profileId}>
                {saveMutation.isPending ? 'Guardando...' : form.id ? 'Actualizar marcación' : 'Agregar marcación'}
              </button>
              <button type="button" className={secondaryButtonClass} onClick={() => setForm(emptyForm)}>Limpiar</button>
            </div>
            {saveMutation.error ? <p className="md:col-span-5 text-sm text-red-600">{(saveMutation.error as Error).message}</p> : null}
          </form>
        </section>

        <section className={cardClass}>
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Carga masiva</h2>
          <textarea
            className={`${inputClass} min-h-32`}
            value={bulkText}
            onChange={(event) => setBulkText(event.target.value)}
            placeholder="YYYY-MM-DD,HH:mm,HH:mm,client-id,Notas"
          />
          <p className="mt-2 text-sm text-gray-500">Una línea por marcación: fecha, ingreso, egreso, client_id y notas.</p>
          <div className="mt-4">
            <button type="button" className={primaryButtonClass} onClick={() => bulkMutation.mutate()} disabled={bulkMutation.isPending || !profileId || !bulkText.trim()}>
              {bulkMutation.isPending ? 'Procesando...' : 'Cargar lote'}
            </button>
          </div>
          {bulkMutation.error ? <p className="mt-3 text-sm text-red-600">{(bulkMutation.error as Error).message}</p> : null}
        </section>

        {entriesQuery.isLoading ? <LoadingState message="Cargando marcaciones..." /> : null}
        {entriesQuery.error ? <ErrorState message={(entriesQuery.error as Error).message} /> : null}

        {!entriesQuery.isLoading && !entriesQuery.error ? (
          <section className={cardClass}>
            {Array.isArray(entriesQuery.data) && entriesQuery.data.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Fecha</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Ingreso</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Egreso</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Cliente</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Notas</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {(entriesQuery.data as Array<{ id: string; date: string; clock_in: string; clock_out: string | null; client_id: string | null; notes: string | null; clients?: { name: string } | null }>).map((entry) => (
                      <tr key={entry.id}>
                        <td className="px-4 py-3 text-sm text-gray-700">{formatDate(entry.date)}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{entry.clock_in.slice(0, 5)}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{entry.clock_out?.slice(0, 5) ?? '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{getRelationName(entry.clients)}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{entry.notes || '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className={secondaryButtonClass}
                              onClick={() => setForm({
                                id: entry.id,
                                date: entry.date,
                                clock_in: entry.clock_in.slice(0, 5),
                                clock_out: entry.clock_out?.slice(0, 5) ?? '',
                                client_id: entry.client_id ?? '',
                                notes: entry.notes ?? '',
                              })}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              className="rounded-lg bg-red-100 px-4 py-2 text-red-700 hover:bg-red-200"
                              onClick={() => {
                                if (window.confirm('¿Eliminar marcación?')) {
                                  deleteMutation.mutate(entry.id);
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
              </div>
            ) : <EmptyState message="No hay marcaciones en el rango seleccionado." />}
          </section>
        ) : null}
      </div>
    </div>
  );
}
