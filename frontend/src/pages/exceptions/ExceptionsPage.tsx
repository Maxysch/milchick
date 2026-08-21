import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import {
  EXCEPTION_TYPE_LABELS,
  formatDate,
  OVERTIME_TIER_OPTIONS,
  TIER_LABELS,
} from '../../lib/utils';
import {
  cardClass,
  EmptyState,
  ErrorState,
  ExceptionRecord,
  getMonthStart,
  getRelationName,
  getToday,
  inputClass,
  LoadingState,
  OvertimeRecord,
  pageTitleClass,
  primaryButtonClass,
  secondaryButtonClass,
  useClientsQuery,
  useProfilesQuery,
} from '../shared';

type ExceptionFormState = {
  id: string;
  exception_type: ExceptionRecord['exception_type'];
  date_from: string;
  date_to: string;
  client_id: string;
  notes: string;
};

const emptyExceptionForm: ExceptionFormState = {
  id: '',
  exception_type: 'vacation',
  date_from: getToday(),
  date_to: getToday(),
  client_id: '',
  notes: '',
};

const emptyOvertimeForm = {
  id: '',
  date: getToday(),
  // Sin preseleccionar: elegir mal el tramo cambia lo que se paga, así que se
  // obliga a decidirlo en vez de dejar que pase uno por omisión.
  tier: '',
  hours: '1',
  start_time: '',
  end_time: '',
  client_id: '',
  notes: '',
};

export default function ExceptionsPage() {
  const queryClient = useQueryClient();
  const profilesQuery = useProfilesQuery();
  const clientsQuery = useClientsQuery();
  const [profileId, setProfileId] = useState('');
  const [from, setFrom] = useState(getMonthStart());
  const [to, setTo] = useState(getToday());
  const [exceptionForm, setExceptionForm] = useState(emptyExceptionForm);
  const [overtimeForm, setOvertimeForm] = useState(emptyOvertimeForm);

  useEffect(() => {
    if (!profileId && profilesQuery.data?.[0]) {
      setProfileId(profilesQuery.data[0].id);
    }
  }, [profileId, profilesQuery.data]);

  const exceptionsQuery = useQuery({
    queryKey: ['exceptions', profileId, from, to],
    queryFn: () => api.get<ExceptionRecord[]>(`/exceptions/profile/${profileId}?from=${from}&to=${to}`),
    enabled: Boolean(profileId),
  });

  const overtimeQuery = useQuery({
    queryKey: ['overtime', profileId, from, to],
    queryFn: () => api.get<OvertimeRecord[]>(`/overtime/profile/${profileId}?from=${from}&to=${to}`),
    enabled: Boolean(profileId),
  });

  const saveExceptionMutation = useMutation({
    mutationFn: () => {
      const payload = {
        profile_id: profileId,
        exception_type: exceptionForm.exception_type,
        date_from: exceptionForm.date_from,
        date_to: exceptionForm.date_to,
        client_id: exceptionForm.exception_type === 'extraordinary_coverage' ? exceptionForm.client_id || null : null,
        notes: exceptionForm.notes || null,
      };
      return exceptionForm.id ? api.patch(`/exceptions/${exceptionForm.id}`, payload) : api.post('/exceptions', payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['exceptions', profileId, from, to] });
      setExceptionForm(emptyExceptionForm);
    },
  });

  const deleteExceptionMutation = useMutation({
    mutationFn: (exceptionId: string) => api.delete<void>(`/exceptions/${exceptionId}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['exceptions', profileId, from, to] });
    },
  });

  const saveOvertimeMutation = useMutation({
    mutationFn: () => {
      const payload = {
        profile_id: profileId,
        date: overtimeForm.date,
        tier: overtimeForm.tier,
        hours: Number(overtimeForm.hours),
        start_time: overtimeForm.start_time || null,
        end_time: overtimeForm.end_time || null,
        client_id: overtimeForm.client_id || null,
        notes: overtimeForm.notes || null,
      };
      return overtimeForm.id ? api.patch(`/overtime/${overtimeForm.id}`, payload) : api.post('/overtime', payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['overtime', profileId, from, to] });
      setOvertimeForm(emptyOvertimeForm);
    },
  });

  const deleteOvertimeMutation = useMutation({
    mutationFn: (overtimeId: string) => api.delete<void>(`/overtime/${overtimeId}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['overtime', profileId, from, to] });
    },
  });

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <h1 className={pageTitleClass}>Excepciones</h1>

        <section className={cardClass}>
          <div className="grid gap-4 md:grid-cols-4">
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
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Nueva excepción</h2>
          <form className="grid gap-4 md:grid-cols-3" onSubmit={(event) => { event.preventDefault(); saveExceptionMutation.mutate(); }}>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Tipo</label>
              <select
                className={inputClass}
                value={exceptionForm.exception_type}
                onChange={(event) => setExceptionForm((current) => ({ ...current, exception_type: event.target.value as typeof current.exception_type }))}
              >
                {Object.entries(EXCEPTION_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Desde</label>
              <input className={inputClass} type="date" value={exceptionForm.date_from} onChange={(event) => setExceptionForm((current) => ({ ...current, date_from: event.target.value }))} required />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Hasta</label>
              <input className={inputClass} type="date" value={exceptionForm.date_to} onChange={(event) => setExceptionForm((current) => ({ ...current, date_to: event.target.value }))} required />
            </div>
            {exceptionForm.exception_type === 'extraordinary_coverage' ? (
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Cliente</label>
                <select className={inputClass} value={exceptionForm.client_id} onChange={(event) => setExceptionForm((current) => ({ ...current, client_id: event.target.value }))}>
                  <option value="">Seleccionar cliente</option>
                  {(clientsQuery.data ?? []).map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
                </select>
              </div>
            ) : null}
            <div className="md:col-span-3">
              <label className="mb-1 block text-sm font-medium text-gray-700">Notas</label>
              <textarea className={`${inputClass} min-h-24`} value={exceptionForm.notes} onChange={(event) => setExceptionForm((current) => ({ ...current, notes: event.target.value }))} />
            </div>
            {saveExceptionMutation.error ? <p className="md:col-span-3 text-sm text-red-600">{(saveExceptionMutation.error as Error).message}</p> : null}
            <div className="md:col-span-3 flex gap-3">
              <button type="submit" className={primaryButtonClass} disabled={saveExceptionMutation.isPending || !profileId}>
                {saveExceptionMutation.isPending ? 'Guardando...' : exceptionForm.id ? 'Actualizar excepción' : 'Agregar excepción'}
              </button>
              <button type="button" className={secondaryButtonClass} onClick={() => setExceptionForm(emptyExceptionForm)}>Limpiar</button>
            </div>
          </form>
        </section>

        {exceptionsQuery.isLoading ? <LoadingState message="Cargando excepciones..." /> : null}
        {exceptionsQuery.error ? <ErrorState message={(exceptionsQuery.error as Error).message} /> : null}
        {!exceptionsQuery.isLoading && !exceptionsQuery.error ? (
          <section className={cardClass}>
            <h2 className="mb-4 text-lg font-semibold text-gray-900">Listado de excepciones</h2>
            {(exceptionsQuery.data ?? []).length === 0 ? (
              <EmptyState message="No hay excepciones para el rango seleccionado." />
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Tipo</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Desde</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Hasta</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Cliente</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Notas</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {(exceptionsQuery.data ?? []).map((exception) => (
                      <tr key={exception.id}>
                        <td className="px-4 py-3 text-sm text-gray-700">{EXCEPTION_TYPE_LABELS[exception.exception_type]}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{formatDate(exception.date_from)}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{formatDate(exception.date_to)}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{getRelationName(exception.clients)}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{exception.notes || '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          <div className="flex gap-2">
                            <button type="button" className={secondaryButtonClass} onClick={() => setExceptionForm({
                              id: exception.id,
                              exception_type: exception.exception_type,
                              date_from: exception.date_from,
                              date_to: exception.date_to,
                              client_id: exception.client_id ?? '',
                              notes: exception.notes ?? '',
                            })}>Editar</button>
                            <button
                              type="button"
                              className="rounded-lg bg-red-100 px-4 py-2 text-red-700 hover:bg-red-200"
                              onClick={() => {
                                if (window.confirm('¿Eliminar excepción?')) {
                                  deleteExceptionMutation.mutate(exception.id);
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
            )}
          </section>
        ) : null}

        <section className={cardClass}>
          <h2 className="text-lg font-semibold text-gray-900">Horas fuera del esquema</h2>
          <p className="mb-4 mt-1 text-sm text-gray-500">
            Coberturas, adicionales y extras: todo lo que no sale del esquema del agente.
            El tramo define el recargo, así que hay que elegirlo.
          </p>
          <form className="grid gap-4 md:grid-cols-3 lg:grid-cols-5" onSubmit={(event) => { event.preventDefault(); saveOvertimeMutation.mutate(); }}>
            <div className="md:col-span-3 lg:col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">Tramo</label>
              <select
                className={inputClass}
                value={overtimeForm.tier}
                onChange={(event) => setOvertimeForm((current) => ({ ...current, tier: event.target.value }))}
                required
              >
                <option value="">Elegir tramo…</option>
                {OVERTIME_TIER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label} ({o.hint})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Fecha</label>
              <input className={inputClass} type="date" value={overtimeForm.date} onChange={(event) => setOvertimeForm((current) => ({ ...current, date: event.target.value }))} required />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Horas</label>
              <input className={inputClass} type="number" min="0" step="0.25" value={overtimeForm.hours} onChange={(event) => setOvertimeForm((current) => ({ ...current, hours: event.target.value }))} required />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Inicio</label>
              <input className={inputClass} type="time" value={overtimeForm.start_time} onChange={(event) => setOvertimeForm((current) => ({ ...current, start_time: event.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Fin</label>
              <input className={inputClass} type="time" value={overtimeForm.end_time} onChange={(event) => setOvertimeForm((current) => ({ ...current, end_time: event.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Cliente</label>
              <select className={inputClass} value={overtimeForm.client_id} onChange={(event) => setOvertimeForm((current) => ({ ...current, client_id: event.target.value }))}>
                <option value="">Sin cliente</option>
                {(clientsQuery.data ?? []).map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
            </div>
            <div className="md:col-span-3 lg:col-span-5">
              <label className="mb-1 block text-sm font-medium text-gray-700">Notas</label>
              <textarea className={`${inputClass} min-h-24`} value={overtimeForm.notes} onChange={(event) => setOvertimeForm((current) => ({ ...current, notes: event.target.value }))} />
            </div>
            {saveOvertimeMutation.error ? <p className="md:col-span-3 lg:col-span-5 text-sm text-red-600">{(saveOvertimeMutation.error as Error).message}</p> : null}
            <div className="md:col-span-3 lg:col-span-5 flex gap-3">
              <button type="submit" className={primaryButtonClass} disabled={saveOvertimeMutation.isPending || !profileId || !overtimeForm.tier}>
                {saveOvertimeMutation.isPending ? 'Guardando...' : overtimeForm.id ? 'Actualizar' : 'Agregar horas'}
              </button>
              <button type="button" className={secondaryButtonClass} onClick={() => setOvertimeForm(emptyOvertimeForm)}>Limpiar</button>
            </div>
          </form>
        </section>

        {overtimeQuery.isLoading ? <LoadingState message="Cargando horas extra..." /> : null}
        {overtimeQuery.error ? <ErrorState message={(overtimeQuery.error as Error).message} /> : null}
        {!overtimeQuery.isLoading && !overtimeQuery.error ? (
          <section className={cardClass}>
            {(overtimeQuery.data ?? []).length === 0 ? (
              <EmptyState message="No hay horas fuera del esquema en el rango seleccionado." />
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Fecha</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Tramo</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Horas</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Inicio</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Fin</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Cliente</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Notas</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {(overtimeQuery.data ?? []).map((overtime) => (
                      <tr key={overtime.id}>
                        <td className="px-4 py-3 text-sm text-gray-700">{formatDate(overtime.date)}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{TIER_LABELS[overtime.tier] ?? overtime.tier}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{overtime.hours}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{overtime.start_time?.slice(0, 5) ?? '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{overtime.end_time?.slice(0, 5) ?? '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{getRelationName(overtime.clients)}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{overtime.notes || '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          <div className="flex gap-2">
                            <button type="button" className={secondaryButtonClass} onClick={() => setOvertimeForm({
                              id: overtime.id,
                              date: overtime.date,
                              tier: overtime.tier ?? '',
                              hours: String(overtime.hours),
                              start_time: overtime.start_time?.slice(0, 5) ?? '',
                              end_time: overtime.end_time?.slice(0, 5) ?? '',
                              client_id: overtime.client_id ?? '',
                              notes: overtime.notes ?? '',
                            })}>Editar</button>
                            <button
                              type="button"
                              className="rounded-lg bg-red-100 px-4 py-2 text-red-700 hover:bg-red-200"
                              onClick={() => {
                                if (window.confirm('¿Eliminar horas extra?')) {
                                  deleteOvertimeMutation.mutate(overtime.id);
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
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}
