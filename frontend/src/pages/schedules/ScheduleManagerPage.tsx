import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { DAY_NAMES, formatDate } from '../../lib/utils';
import { blockMinutes, formatHours } from '../../lib/bands';
import { useInvalidateSettlement } from '../../lib/normalization';
import ScheduleSuggestions from '../../components/schedules/ScheduleSuggestions';
import WeekTimeline from '../../components/schedules/WeekTimeline';
import ScheduleEditor, { type EditorState } from '../../components/schedules/ScheduleEditor';
import {
  cardClass,
  EmptyState,
  ErrorState,
  fieldClass,
  getBadgeClass,
  getRelationName,
  getToday,
  LoadingState,
  pageTitleClass,
  secondaryButtonClass,
  type ScheduleEntry,
  useClientsQuery,
  useProfilesQuery,
} from '../shared';

/** Un color por cliente, estable dentro del agente */
const PALETA = ['#2563eb', '#059669', '#7c3aed', '#ea580c', '#0891b2', '#db2777'];
const SEMANA = [1, 2, 3, 4, 5, 6, 0];
const hhmm = (t: string) => t.slice(0, 5);

const diaSiguiente = (fecha: string) => {
  const d = new Date(`${fecha}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const duracion = (b: ScheduleEntry) => {
  const [a, z] = blockMinutes(b.start_time, b.end_time);
  return z - a;
};

export default function ScheduleManagerPage() {
  const queryClient = useQueryClient();
  const invalidateSettlement = useInvalidateSettlement();
  const profilesQuery = useProfilesQuery();
  const clientsQuery = useClientsQuery();
  const hoy = getToday();

  const [profileId, setProfileId] = useState('');
  const [fecha, setFecha] = useState(hoy);
  const [verTerminados, setVerTerminados] = useState(false);
  const [editor, setEditorState] = useState<EditorState | null>(null);
  const [version, setVersion] = useState(0);
  const [elegido, setElegido] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  // Cada apertura del editor arranca de cero con lo que se eligió
  const abrir = (s: EditorState | null) => {
    setEditorState(s);
    setVersion((v) => v + 1);
    if (!s) setElegido(null);
  };

  useEffect(() => {
    if (editor) editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [version, editor]);

  // Sólo agentes: son los que se liquidan
  const agentes = useMemo(
    () =>
      (profilesQuery.data ?? [])
        .filter((p) => p.role === 'agent' && p.is_active)
        .sort((a, b) => a.last_name.localeCompare(b.last_name, 'es') || a.first_name.localeCompare(b.first_name, 'es')),
    [profilesQuery.data]
  );

  useEffect(() => {
    if (!profileId && agentes[0]) setProfileId(agentes[0].id);
  }, [profileId, agentes]);

  const schedulesQuery = useQuery({
    queryKey: ['schedules', profileId],
    queryFn: () => api.get<ScheduleEntry[]>(`/schedules/profile/${profileId}`),
    enabled: Boolean(profileId),
  });
  const todos = useMemo(() => schedulesQuery.data ?? [], [schedulesQuery.data]);

  const vigentes = todos.filter((b) => b.effective_from <= fecha && (!b.effective_until || b.effective_until >= fecha));
  const proximos = todos.filter((b) => b.effective_from > fecha);
  const terminados = todos.filter((b) => b.effective_until && b.effective_until < fecha);

  // Cuándo cambia cada día: empieza un bloque nuevo o termina uno vigente
  const proximoCambio = useMemo(() => {
    const m = new Map<number, string>();
    const anotar = (d: number, f: string) => {
      const prev = m.get(d);
      if (!prev || f < prev) m.set(d, f);
    };
    proximos.forEach((b) => anotar(b.day_of_week, b.effective_from));
    vigentes.forEach((b) => b.effective_until && anotar(b.day_of_week, diaSiguiente(b.effective_until)));
    return m;
  }, [proximos, vigentes]);

  const colores = useMemo(() => {
    const nombres = new Map(todos.map((b) => [b.client_id, getRelationName(b.clients)]));
    const orden = [...nombres.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es')).map(([id]) => id);
    return new Map(orden.map((id, i) => [id, PALETA[i % PALETA.length]]));
  }, [todos]);
  const colorOf = (id: string) => colores.get(id) ?? '#6b7280';

  const minutosSemana = vigentes.reduce((s, b) => s + duracion(b), 0);
  const diasConHorario = new Set(vigentes.map((b) => b.day_of_week)).size;
  const clientesUsados = new Set(vigentes.map((b) => b.client_id)).size;

  const filas = [...vigentes, ...proximos, ...(verTerminados ? terminados : [])].sort(
    (a, b) =>
      SEMANA.indexOf(a.day_of_week) - SEMANA.indexOf(b.day_of_week) ||
      a.start_time.localeCompare(b.start_time) ||
      a.effective_from.localeCompare(b.effective_from)
  );

  const alGuardar = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['schedules', profileId] }),
      queryClient.invalidateQueries({ queryKey: ['schedule-suggestions'] }),
      invalidateSettlement(),
    ]);
  };

  const eliminar = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/schedules/${id}`),
    onSuccess: alGuardar,
  });

  const estado = (b: ScheduleEntry) =>
    b.effective_from > fecha
      ? <span className={getBadgeClass('blue')}>Desde el {formatDate(b.effective_from)}</span>
      : b.effective_until && b.effective_until < fecha
        ? <span className={getBadgeClass('gray')}>Terminó el {formatDate(b.effective_until)}</span>
        : <span className={getBadgeClass('green')}>Vigente</span>;

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <h1 className={pageTitleClass}>Esquemas</h1>
          <p className="mt-1 text-sm text-gray-600">
            El horario habitual de cada agente. Es el plan contra el que se contrasta la marcación: un esquema al día es
            un día que se paga solo.
          </p>
        </div>

        <ScheduleSuggestions />

        <section className={cardClass}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Agente</label>
                <select
                  className={`${fieldClass} w-72`}
                  value={profileId}
                  onChange={(e) => {
                    setProfileId(e.target.value);
                    abrir(null);
                  }}
                >
                  {agentes.map((p) => (
                    <option key={p.id} value={p.id}>{p.last_name}, {p.first_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Semana vigente al</label>
                <input className={`${fieldClass} w-44`} type="date" value={fecha} onChange={(e) => setFecha(e.target.value || hoy)} />
              </div>
            </div>
            {profileId && todos.length ? (
              <div className="text-right text-sm text-gray-600">
                <div className="text-2xl font-semibold text-gray-900">{formatHours(minutosSemana)}</div>
                por semana · {diasConHorario} {diasConHorario === 1 ? 'día' : 'días'} · {clientesUsados}{' '}
                {clientesUsados === 1 ? 'cliente' : 'clientes'}
              </div>
            ) : null}
          </div>
        </section>

        {schedulesQuery.isLoading ? <LoadingState message="Cargando esquemas..." /> : null}
        {schedulesQuery.error ? <ErrorState message={(schedulesQuery.error as Error).message} /> : null}

        {!profileId ? (
          <EmptyState message="Seleccioná un agente para ver y cargar su esquema." />
        ) : schedulesQuery.data ? (
          <>
            <section className={cardClass}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">La semana</h2>
                  <p className="text-sm text-gray-500">Tocá un bloque para cambiarlo, o el + para agregar uno ese día.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={`${secondaryButtonClass} inline-flex items-center gap-2`}
                    onClick={() => abrir({ mode: 'add', days: [] })}>
                    <Plus className="h-4 w-4" /> Agregar bloques
                  </button>
                  <button type="button" className={`${secondaryButtonClass} inline-flex items-center gap-2`}
                    onClick={() => abrir({ mode: 'change', day: vigentes[0]?.day_of_week ?? 1 })}>
                    <CalendarClock className="h-4 w-4" /> Cambiar desde una fecha
                  </button>
                </div>
              </div>

              {todos.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-300 px-6 py-8 text-center">
                  <p className="text-sm text-gray-600">Este agente todavía no tiene esquema: sin él no se le puede liquidar.</p>
                  <button type="button" className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-blue-700 hover:underline"
                    onClick={() => abrir({ mode: 'add', days: [1, 2, 3, 4, 5] })}>
                    <Plus className="h-4 w-4" /> Cargar su horario
                  </button>
                </div>
              ) : (
                <WeekTimeline
                  blocks={vigentes}
                  upcoming={proximoCambio}
                  colorOf={colorOf}
                  clientName={(b) => getRelationName(b.clients)}
                  selectedId={elegido}
                  onSelect={(b) => {
                    abrir({ mode: 'change', day: b.day_of_week });
                    setElegido(b.id);
                  }}
                  onAdd={(day) => abrir({ mode: 'add', days: [day] })}
                />
              )}
            </section>

            {editor ? (
              <section ref={editorRef} className={`${cardClass} scroll-mt-6 border border-blue-200`}>
                <ScheduleEditor
                  key={version}
                  state={editor}
                  profileId={profileId}
                  clients={clientsQuery.data ?? []}
                  blocks={todos}
                  today={fecha}
                  onClose={() => abrir(null)}
                  onSaved={alGuardar}
                  onModeChange={abrir}
                />
              </section>
            ) : null}

            {todos.length ? (
              <section className={cardClass}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold text-gray-900">Bloques</h2>
                  {terminados.length ? (
                    <label className="inline-flex items-center gap-2 text-sm text-gray-600">
                      <input type="checkbox" className="h-4 w-4" checked={verTerminados} onChange={(e) => setVerTerminados(e.target.checked)} />
                      Ver los que terminaron ({terminados.length})
                    </label>
                  ) : null}
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                        <th className="py-2 pr-4">Día</th>
                        <th className="py-2 pr-4">Horario</th>
                        <th className="py-2 pr-4 text-right">Horas</th>
                        <th className="py-2 pr-4">Cliente</th>
                        <th className="py-2 pr-4">Vigencia</th>
                        <th className="py-2 pr-4">Estado</th>
                        <th className="py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filas.map((b) => {
                        const terminado = !!b.effective_until && b.effective_until < fecha;
                        return (
                          <tr key={b.id} className={`${elegido === b.id ? 'bg-blue-50/60' : ''} ${terminado ? 'text-gray-400' : ''}`}>
                            <td className="py-2 pr-4 font-medium text-gray-900">{DAY_NAMES[b.day_of_week]}</td>
                            <td className="py-2 pr-4">
                              <span className="inline-flex items-center gap-2">
                                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colorOf(b.client_id) }} />
                                {hhmm(b.start_time)}–{hhmm(b.end_time)}
                              </span>
                            </td>
                            <td className="py-2 pr-4 text-right">{formatHours(duracion(b))}</td>
                            <td className="py-2 pr-4">{getRelationName(b.clients)}</td>
                            <td className="py-2 pr-4 whitespace-nowrap text-gray-600">
                              {b.effective_until
                                ? `${formatDate(b.effective_from)} → ${formatDate(b.effective_until)}`
                                : `desde ${formatDate(b.effective_from)}`}
                            </td>
                            <td className="py-2 pr-4 whitespace-nowrap">{estado(b)}</td>
                            <td className="py-2 text-right whitespace-nowrap">
                              {!terminado ? (
                                <button type="button" className="mr-1 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-blue-700 hover:bg-blue-50"
                                  title="El horario de ese día cambia a partir de una fecha"
                                  onClick={() => { abrir({ mode: 'change', day: b.day_of_week }); setElegido(b.id); }}>
                                  <CalendarClock className="h-4 w-4" /> Cambiar desde
                                </button>
                              ) : null}
                              <button type="button" className="mr-1 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-gray-600 hover:bg-gray-100"
                                title="Corregir un error de carga"
                                onClick={() => { abrir({ mode: 'fix', block: b }); setElegido(b.id); }}>
                                <Pencil className="h-4 w-4" /> Corregir
                              </button>
                              <button type="button" className="inline-flex items-center rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                                title="Eliminar el bloque" aria-label="Eliminar el bloque"
                                disabled={eliminar.isPending}
                                onClick={() => {
                                  if (window.confirm(`¿Eliminar el bloque del ${DAY_NAMES[b.day_of_week].toLowerCase()} de ${hhmm(b.start_time)} a ${hhmm(b.end_time)}? Si fue el horario real de algún mes, conviene "Cambiar desde" en vez de borrarlo.`)) {
                                    eliminar.mutate(b.id);
                                  }
                                }}>
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {eliminar.error ? <p className="mt-2 text-sm text-red-600">{(eliminar.error as Error).message}</p> : null}
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
