import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/utils';
import {
  cardClass,
  DAY_OPTIONS,
  EmptyState,
  ErrorState,
  getRelationName,
  inputClass,
  LoadingState,
  pageTitleClass,
  primaryButtonClass,
  secondaryButtonClass,
  ScheduleEntry,
  useClientsQuery,
  useProfilesQuery,
  WEEK_DAYS,
} from '../shared';

const emptyForm = {
  id: '',
  day_of_week: 1,
  client_id: '',
  start_time: '',
  end_time: '',
  effective_from: '',
  effective_until: '',
};

export default function ScheduleManagerPage() {
  const queryClient = useQueryClient();
  const profilesQuery = useProfilesQuery();
  const clientsQuery = useClientsQuery();
  const [profileId, setProfileId] = useState('');
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    if (!profileId && profilesQuery.data?.[0]) {
      setProfileId(profilesQuery.data[0].id);
    }
  }, [profileId, profilesQuery.data]);

  const schedulesQuery = useQuery({
    queryKey: ['schedules', profileId],
    queryFn: () => api.get<ScheduleEntry[]>(`/schedules/profile/${profileId}`),
    enabled: Boolean(profileId),
  });

  const groupedSchedules = useMemo(() => {
    const map = new Map<number, ScheduleEntry[]>();
    WEEK_DAYS.forEach((day) => map.set(day, []));
    (schedulesQuery.data ?? []).forEach((schedule) => {
      map.set(schedule.day_of_week, [...(map.get(schedule.day_of_week) ?? []), schedule]);
    });
    return map;
  }, [schedulesQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        profile_id: profileId,
        day_of_week: Number(form.day_of_week),
        client_id: form.client_id,
        start_time: form.start_time,
        end_time: form.end_time,
        effective_from: form.effective_from,
        effective_until: form.effective_until || null,
      };
      return form.id ? api.patch(`/schedules/${form.id}`, payload) : api.post('/schedules', payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['schedules', profileId] });
      setForm(emptyForm);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (scheduleId: string) => api.delete<void>(`/schedules/${scheduleId}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['schedules', profileId] });
    },
  });

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <h1 className={pageTitleClass}>Esquemas</h1>

        <section className={cardClass}>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Agente</label>
              <select className={inputClass} value={profileId} onChange={(event) => setProfileId(event.target.value)}>
                <option value="">Seleccionar agente</option>
                {(profilesQuery.data ?? []).map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.first_name} {profile.last_name}</option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {schedulesQuery.isLoading ? <LoadingState message="Cargando esquemas..." /> : null}
        {schedulesQuery.error ? <ErrorState message={(schedulesQuery.error as Error).message} /> : null}

        {profileId ? (
          <div className="grid gap-4 lg:grid-cols-7">
            {WEEK_DAYS.map((day) => (
              <div key={day} className={`${cardClass} p-4`}>
                <h2 className="mb-3 text-sm font-semibold text-gray-900">{DAY_OPTIONS.find((option) => option.value === day)?.label}</h2>
                <div className="space-y-3">
                  {(groupedSchedules.get(day) ?? []).map((schedule) => (
                    <div key={schedule.id} className="rounded-lg border border-gray-200 p-3 text-sm">
                      <div className="font-medium text-gray-900">{getRelationName(schedule.clients)}</div>
                      <div className="mt-1 text-gray-600">{schedule.start_time.slice(0, 5)} - {schedule.end_time.slice(0, 5)}</div>
                      <div className="mt-1 text-xs text-gray-500">Desde {formatDate(schedule.effective_from)}{schedule.effective_until ? ` hasta ${formatDate(schedule.effective_until)}` : ''}</div>
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          className={secondaryButtonClass}
                          onClick={() => setForm({
                            id: schedule.id,
                            day_of_week: schedule.day_of_week,
                            client_id: schedule.client_id,
                            start_time: schedule.start_time.slice(0, 5),
                            end_time: schedule.end_time.slice(0, 5),
                            effective_from: schedule.effective_from,
                            effective_until: schedule.effective_until ?? '',
                          })}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="rounded-lg bg-red-100 px-4 py-2 text-red-700 hover:bg-red-200"
                          onClick={() => {
                            if (window.confirm('¿Eliminar bloque horario?')) {
                              deleteMutation.mutate(schedule.id);
                            }
                          }}
                        >
                          Eliminar
                        </button>
                      </div>
                    </div>
                  ))}
                  {(groupedSchedules.get(day) ?? []).length === 0 ? <p className="text-sm text-gray-400">Sin bloques</p> : null}
                </div>
              </div>
            ))}
          </div>
        ) : <EmptyState message="Seleccioná un agente para administrar sus esquemas." />}

        <section className={cardClass}>
          <h2 className="mb-4 text-lg font-semibold text-gray-900">{form.id ? 'Editar bloque horario' : 'Nuevo bloque horario'}</h2>
          {!profileId ? (
            <EmptyState message="Seleccioná un agente para cargar horarios." />
          ) : (
            <form
              className="grid gap-4 md:grid-cols-3"
              onSubmit={(event) => {
                event.preventDefault();
                saveMutation.mutate();
              }}
            >
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Día</label>
                <select className={inputClass} value={form.day_of_week} onChange={(event) => setForm((current) => ({ ...current, day_of_week: Number(event.target.value) }))}>
                  {DAY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Cliente</label>
                <select className={inputClass} value={form.client_id} onChange={(event) => setForm((current) => ({ ...current, client_id: event.target.value }))} required>
                  <option value="">Seleccionar cliente</option>
                  {(clientsQuery.data ?? []).map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Inicio</label>
                <input className={inputClass} type="time" value={form.start_time} onChange={(event) => setForm((current) => ({ ...current, start_time: event.target.value }))} required />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Fin</label>
                <input className={inputClass} type="time" value={form.end_time} onChange={(event) => setForm((current) => ({ ...current, end_time: event.target.value }))} required />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Vigente desde</label>
                <input className={inputClass} type="date" value={form.effective_from} onChange={(event) => setForm((current) => ({ ...current, effective_from: event.target.value }))} required />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Vigente hasta</label>
                <input className={inputClass} type="date" value={form.effective_until} onChange={(event) => setForm((current) => ({ ...current, effective_until: event.target.value }))} />
              </div>

              {saveMutation.error ? <p className="md:col-span-3 text-sm text-red-600">{(saveMutation.error as Error).message}</p> : null}

              <div className="md:col-span-3 flex gap-3">
                <button type="submit" className={primaryButtonClass} disabled={saveMutation.isPending || !profileId}>
                  {saveMutation.isPending ? 'Guardando...' : form.id ? 'Actualizar bloque' : 'Agregar bloque'}
                </button>
                <button type="button" className={secondaryButtonClass} onClick={() => setForm(emptyForm)}>
                  Limpiar
                </button>
              </div>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
