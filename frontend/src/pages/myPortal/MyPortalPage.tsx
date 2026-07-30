import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useProfile } from '../../hooks/useProfile';
import { formatDate, DAY_NAMES, EXCEPTION_TYPE_LABELS } from '../../lib/utils';
import { Clock, Calendar, AlertCircle, Timer } from 'lucide-react';
import { useState } from 'react';

export default function MyPortalPage() {
  const { profile } = useProfile();
  const queryClient = useQueryClient();
  const [clockNote, setClockNote] = useState('');
  const today = new Date().toISOString().split('T')[0];

  // Today's clock entries
  const { data: todayEntries } = useQuery({
    queryKey: ['my-clock-entries', today],
    queryFn: () => api.get<Array<Record<string, unknown>>>('/clock-entries/my/today'),
  });

  // My active schedule
  const { data: schedules } = useQuery({
    queryKey: ['my-schedule', profile?.id, today],
    queryFn: () => api.get<Array<Record<string, unknown>>>(`/schedules/profile/${profile!.id}?date=${today}`),
    enabled: !!profile,
  });

  // My upcoming exceptions
  const { data: exceptions } = useQuery({
    queryKey: ['my-exceptions', profile?.id],
    queryFn: () => api.get<Array<Record<string, unknown>>>(`/exceptions/profile/${profile!.id}?from=${today}&to=2099-12-31`),
    enabled: !!profile,
  });

  // My upcoming overtime
  const { data: overtime } = useQuery({
    queryKey: ['my-overtime', profile?.id],
    queryFn: () => api.get<Array<Record<string, unknown>>>(`/overtime/profile/${profile!.id}?from=${today}&to=2099-12-31`),
    enabled: !!profile,
  });

  // Clock in
  const clockIn = useMutation({
    mutationFn: () => {
      return api.post('/clock-entries/my/clock-in', {
        notes: clockNote || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-clock-entries'] });
      setClockNote('');
    },
  });

  // Clock out
  const clockOut = useMutation({
    mutationFn: () => {
      return api.post('/clock-entries/my/clock-out', {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-clock-entries'] });
    },
  });

  const undoClockOut = useMutation({
    mutationFn: () => {
      return api.post('/clock-entries/my/undo-clock-out', {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-clock-entries'] });
    },
  });

  const hasOpenEntry = todayEntries?.some((e) => !e.clock_out);
  const lastClosedEntry = todayEntries
    ?.filter((e) => e.clock_out)
    .slice(-1)[0];

  if (!profile) return null;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Hola, {profile.first_name}
        </h1>
        <p className="text-gray-500">{formatDate(today)}</p>
      </div>

      {/* Clock In / Out */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5" /> Marcación
        </h2>

        {todayEntries && todayEntries.length > 0 && (
          <div className="mb-4 space-y-1">
            {todayEntries.map((entry) => (
              <div key={String(entry.id)} className="text-sm text-gray-600">
                Ingreso: <span className="font-medium">{String(entry.clock_in)}</span>
                {Boolean(entry.clock_out) && (
                  <> — Egreso: <span className="font-medium">{String(entry.clock_out)}</span></>
                )}
                {!entry.clock_out && (
                  <span className="ml-2 px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs">En curso</span>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3">
          {!hasOpenEntry ? (
            <>
              <input
                type="text"
                placeholder="Nota (opcional)"
                value={clockNote}
                onChange={(e) => setClockNote(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 flex-1 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
              <button
                onClick={() => clockIn.mutate()}
                disabled={clockIn.isPending}
                className="bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 font-medium"
              >
                Marcar ingreso
              </button>
              {lastClosedEntry && (
                <button
                  onClick={() => undoClockOut.mutate()}
                  disabled={undoClockOut.isPending}
                  className="bg-amber-500 text-white px-4 py-2 rounded-lg hover:bg-amber-600 font-medium text-sm"
                >
                  Anular egreso
                </button>
              )}
            </>
          ) : (
            <button
              onClick={() => clockOut.mutate()}
              disabled={clockOut.isPending}
              className="bg-red-600 text-white px-6 py-2 rounded-lg hover:bg-red-700 font-medium"
            >
              Marcar egreso
            </button>
          )}
        </div>
        {(clockIn.error || clockOut.error || undoClockOut.error) && (
          <p className="text-red-600 text-sm mt-2">
            {(clockIn.error || clockOut.error || undoClockOut.error)?.message}
          </p>
        )}
      </div>

      {/* My Schedule */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Calendar className="w-5 h-5" /> Mi esquema
        </h2>
        {schedules && schedules.length > 0 ? (
          <div className="space-y-2">
            {schedules.map((s) => (
              <div key={s.id as string} className="flex items-center gap-4 text-sm">
                <span className="font-medium w-24">{DAY_NAMES[s.day_of_week as number]}</span>
                <span>{s.start_time as string} - {s.end_time as string}</span>
                <span className="text-gray-500">
                  {(s.clients as Record<string, string>)?.name || ''}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-sm">No hay esquema activo para hoy.</p>
        )}
      </div>

      {/* Upcoming Exceptions */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <AlertCircle className="w-5 h-5" /> Excepciones próximas
        </h2>
        {exceptions && exceptions.length > 0 ? (
          <div className="space-y-2">
            {exceptions.map((e) => (
              <div key={e.id as string} className="flex items-center gap-4 text-sm">
                <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
                  {EXCEPTION_TYPE_LABELS[e.exception_type as string] || String(e.exception_type)}
                </span>
                <span>{formatDate(e.date_from as string)} — {formatDate(e.date_to as string)}</span>
                {Boolean(e.notes) && <span className="text-gray-500">{String(e.notes)}</span>}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-sm">Sin excepciones próximas.</p>
        )}
      </div>

      {/* Upcoming Overtime */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Timer className="w-5 h-5" /> Horas extra próximas
        </h2>
        {overtime && overtime.length > 0 ? (
          <div className="space-y-2">
            {overtime.map((o) => (
              <div key={String(o.id)} className="flex items-center gap-4 text-sm">
                <span className="font-medium">{formatDate(o.date as string)}</span>
                <span>{String(o.hours)}h</span>
                {Boolean(o.start_time) && <span className="text-gray-500">{String(o.start_time)} - {String(o.end_time)}</span>}
                {Boolean(o.notes) && <span className="text-gray-500">{String(o.notes)}</span>}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-sm">Sin horas extra próximas.</p>
        )}
      </div>
    </div>
  );
}
