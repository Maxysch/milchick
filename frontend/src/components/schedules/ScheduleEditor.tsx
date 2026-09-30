import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CalendarClock, Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { api } from '../../lib/api';
import { DAY_NAMES, formatDate } from '../../lib/utils';
import { blockMinutes, formatHours } from '../../lib/bands';
import {
  fieldClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  type Client,
  type ScheduleEntry,
} from '../../pages/shared';

const SEMANA = [1, 2, 3, 4, 5, 6, 0];
const CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const SIN_FIN = '9999-12-31';
const hhmm = (t: string) => t.slice(0, 5);

export type EditorState =
  | { mode: 'add'; days: number[] }
  | { mode: 'change'; day: number }
  | { mode: 'fix'; block: ScheduleEntry };

interface Tramo {
  start_time: string;
  end_time: string;
  client_id: string;
}

const vigenteAl = (b: ScheduleEntry, fecha: string) =>
  b.effective_from <= fecha && (!b.effective_until || b.effective_until >= fecha);

/** El bloque existente que se pisaría con el candidato */
function pisado(
  blocks: ScheduleEntry[],
  c: { day: number; start: string; end: string; from: string; until: string | null },
  excluir?: string
) {
  if (!c.start || !c.end || !c.from) return null;
  const [s, e] = blockMinutes(c.start, c.end);
  return (
    blocks.find((b) => {
      if (b.id === excluir || b.day_of_week !== c.day) return false;
      if (!(b.effective_from <= (c.until || SIN_FIN) && c.from <= (b.effective_until ?? SIN_FIN))) return false;
      const [bs, be] = blockMinutes(b.start_time, b.end_time);
      return bs < e && s < be;
    }) ?? null
  );
}

function Dias({ value, onChange, single }: { value: number[]; onChange: (d: number[]) => void; single?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {SEMANA.map((d) => {
        const on = value.includes(d);
        return (
          <button
            key={d}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(single ? [d] : on ? value.filter((x) => x !== d) : [...value, d])}
            className={`h-9 min-w-12 rounded-lg border px-2 text-sm font-medium transition ${
              on ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white text-gray-700 hover:border-blue-400'
            }`}
          >
            {CORTO[d]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Carga y cambios de esquema.
 *
 * - Agregar: el mismo bloque en varios días de una ("lunes a viernes de 9 a 15").
 * - Cambiar desde: el horario de un día cambia a partir de una fecha. El actual
 *   se cierra el día anterior y el nuevo rige desde ahí, así los meses ya
 *   liquidados no cambian. Es la forma correcta de un cambio de horario.
 * - Corregir: un error de carga. Cambia el bloque en toda su vigencia.
 */
export default function ScheduleEditor({
  state,
  profileId,
  clients,
  blocks,
  today,
  onClose,
  onSaved,
  onModeChange,
}: {
  state: EditorState;
  profileId: string;
  clients: Client[];
  /** Todos los bloques del agente, vigentes o no */
  blocks: ScheduleEntry[];
  today: string;
  onClose: () => void;
  onSaved: () => Promise<unknown> | void;
  onModeChange: (s: EditorState) => void;
}) {
  const clienteHabitual = useMemo(() => {
    const cuenta = new Map<string, number>();
    blocks.forEach((b) => cuenta.set(b.client_id, (cuenta.get(b.client_id) ?? 0) + 1));
    return [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? clients[0]?.id ?? '';
  }, [blocks, clients]);

  const activos = clients.filter((c) => c.is_active !== false);

  // ── Agregar / corregir: un bloque
  const base = state.mode === 'fix' ? state.block : null;
  const [dias, setDias] = useState<number[]>(
    state.mode === 'add' ? state.days : state.mode === 'fix' ? [state.block.day_of_week] : []
  );
  const [cliente, setCliente] = useState(base?.client_id ?? clienteHabitual);
  const [inicio, setInicio] = useState(base ? hhmm(base.start_time) : '');
  const [fin, setFin] = useState(base ? hhmm(base.end_time) : '');
  const [vigDesde, setVigDesde] = useState(base?.effective_from ?? today);
  const [vigHasta, setVigHasta] = useState(base?.effective_until ?? '');

  // ── Cambiar desde: los tramos del día a partir de una fecha
  const diaCambio = state.mode === 'change' ? state.day : 1;
  const [desde, setDesde] = useState(today);
  const tramosAl = (fecha: string, dia: number): Tramo[] =>
    blocks
      .filter((b) => b.day_of_week === dia && vigenteAl(b, fecha))
      .sort((a, b) => a.start_time.localeCompare(b.start_time))
      .map((b) => ({ start_time: hhmm(b.start_time), end_time: hhmm(b.end_time), client_id: b.client_id }));
  const [tramos, setTramos] = useState<Tramo[]>(() => tramosAl(today, diaCambio));
  const actuales = tramosAl(desde, diaCambio);

  const duracion = inicio && fin ? (() => { const [a, z] = blockMinutes(inicio, fin); return z - a; })() : 0;
  const conflicto = state.mode !== 'change'
    ? dias
        .map((d) => pisado(blocks, { day: d, start: inicio, end: fin, from: vigDesde, until: vigHasta || null }, base?.id))
        .find(Boolean) ?? null
    : null;

  const tramosPisados = tramos.some((t, i) =>
    tramos.some((u, j) => {
      if (j <= i || !t.start_time || !t.end_time || !u.start_time || !u.end_time) return false;
      const [a, b] = blockMinutes(t.start_time, t.end_time);
      const [c, d] = blockMinutes(u.start_time, u.end_time);
      return a < d && c < b;
    })
  );

  const guardar = useMutation({
    mutationFn: async () => {
      if (state.mode === 'change') {
        await api.post('/schedules/change-day', {
          profile_id: profileId,
          day_of_week: diaCambio,
          blocks: tramos,
          effective_from: desde,
        });
        return;
      }
      const payload = (d: number) => ({
        day_of_week: d,
        client_id: cliente,
        start_time: inicio,
        end_time: fin,
        effective_from: vigDesde,
        effective_until: vigHasta || null,
      });
      if (state.mode === 'fix') {
        await api.patch(`/schedules/${state.block.id}`, payload(dias[0]));
        return;
      }
      // De a uno: si alguno falla, los anteriores ya quedaron cargados
      for (const d of [...dias].sort((a, b) => SEMANA.indexOf(a) - SEMANA.indexOf(b))) {
        await api.post('/schedules', { profile_id: profileId, ...payload(d) });
      }
    },
    onSettled: () => onSaved(),
    onSuccess: () => onClose(),
  });

  const puedeGuardar =
    state.mode === 'change'
      ? !!desde && !tramosPisados && tramos.every((t) => t.start_time && t.end_time && t.start_time !== t.end_time && t.client_id)
      : dias.length > 0 && !!cliente && !!inicio && !!fin && inicio !== fin && !!vigDesde && !conflicto;

  const pestaña = (activo: boolean) =>
    `inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${
      activo ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'
    }`;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {state.mode === 'fix' ? (
          <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
            <Pencil className="h-4 w-4 text-gray-500" />
            Corregir el bloque del {DAY_NAMES[state.block.day_of_week].toLowerCase()} {hhmm(state.block.start_time)}–{hhmm(state.block.end_time)}
          </h2>
        ) : (
          <div className="flex flex-wrap gap-1 rounded-xl bg-gray-50 p-1">
            <button type="button" className={pestaña(state.mode === 'add')} onClick={() => onModeChange({ mode: 'add', days: dias })}>
              <Plus className="h-4 w-4" /> Agregar bloques
            </button>
            <button type="button" className={pestaña(state.mode === 'change')} onClick={() => onModeChange({ mode: 'change', day: dias[0] ?? 1 })}>
              <CalendarClock className="h-4 w-4" /> Cambiar un día desde una fecha
            </button>
          </div>
        )}
        <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700" aria-label="Cerrar">
          <X className="h-5 w-5" />
        </button>
      </div>

      {state.mode === 'change' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-6">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Día</label>
              <Dias
                single
                value={[diaCambio]}
                onChange={([d]) => {
                  onModeChange({ mode: 'change', day: d });
                }}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">A partir del</label>
              <input className={`${fieldClass} w-44`} type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4">
            <div className="mb-2 text-sm text-gray-600">
              Ahora el {DAY_NAMES[diaCambio].toLowerCase()} es{' '}
              <strong className="text-gray-900">
                {actuales.length ? actuales.map((t) => `${t.start_time}–${t.end_time}`).join(' + ') : 'franco'}
              </strong>
              . Desde el {desde ? formatDate(desde) : '—'} pasa a ser:
            </div>
            <div className="space-y-2">
              {tramos.map((t, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <input className={`${fieldClass} w-36`} type="time" value={t.start_time}
                    onChange={(e) => setTramos(tramos.map((x, j) => (j === i ? { ...x, start_time: e.target.value } : x)))} />
                  <span className="text-gray-400">a</span>
                  <input className={`${fieldClass} w-36`} type="time" value={t.end_time}
                    onChange={(e) => setTramos(tramos.map((x, j) => (j === i ? { ...x, end_time: e.target.value } : x)))} />
                  <select className={`${fieldClass} w-60`} value={t.client_id}
                    onChange={(e) => setTramos(tramos.map((x, j) => (j === i ? { ...x, client_id: e.target.value } : x)))}>
                    {activos.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button type="button" className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600" title="Sacar este tramo"
                    onClick={() => setTramos(tramos.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {tramos.length === 0 ? (
                <p className="text-sm font-medium text-amber-800">Desde esa fecha, el {DAY_NAMES[diaCambio].toLowerCase()} queda franco.</p>
              ) : null}
              <button type="button" className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline"
                onClick={() => setTramos([...tramos, { start_time: '', end_time: '', client_id: tramos[tramos.length - 1]?.client_id ?? clienteHabitual }])}>
                <Plus className="h-4 w-4" /> Agregar tramo
              </button>
            </div>
            {tramosPisados ? <p className="mt-2 text-sm text-red-600">Dos tramos se pisan: el mismo tiempo se pagaría dos veces.</p> : null}
          </div>

          <p className="text-sm text-gray-500">
            El horario actual se cierra el día anterior y el nuevo rige desde esa fecha: los meses ya liquidados no
            cambian, y las preliquidaciones en borrador se recalculan solas.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">{state.mode === 'fix' ? 'Día' : 'Días'}</label>
            <div className="flex flex-wrap items-center gap-3">
              <Dias single={state.mode === 'fix'} value={dias} onChange={setDias} />
              {state.mode === 'add' ? (
                <div className="flex gap-3 text-sm">
                  <button type="button" className="text-blue-700 hover:underline" onClick={() => setDias([1, 2, 3, 4, 5])}>Lunes a viernes</button>
                  <button type="button" className="text-gray-500 hover:underline" onClick={() => setDias([])}>Ninguno</button>
                </div>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">Cliente</label>
              <select className={inputClass} value={cliente} onChange={(e) => setCliente(e.target.value)}>
                <option value="">Seleccionar cliente</option>
                {activos.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Entra</label>
              <input className={inputClass} type="time" value={inicio} onChange={(e) => setInicio(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Sale</label>
              <input className={inputClass} type="time" value={fin} onChange={(e) => setFin(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Vigente desde</label>
              <input className={inputClass} type="date" value={vigDesde} onChange={(e) => setVigDesde(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Hasta <span className="font-normal text-gray-400">(opcional)</span></label>
              <input className={inputClass} type="date" value={vigHasta} onChange={(e) => setVigHasta(e.target.value)} />
            </div>
            <div className="flex items-end pb-2 text-sm text-gray-600 lg:col-span-2">
              {duracion > 0 ? (
                <span>
                  <strong className="text-gray-900">{formatHours(duracion)}</strong>
                  {state.mode === 'add' && dias.length > 1 ? ` por día · ${formatHours(duracion * dias.length)} por semana` : ''}
                  {blockMinutes(inicio, fin)[1] > 24 * 60 ? ' · cruza la medianoche' : ''}
                </span>
              ) : null}
            </div>
          </div>

          {conflicto ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              Se pisa con el bloque del {DAY_NAMES[conflicto.day_of_week].toLowerCase()} de {hhmm(conflicto.start_time)} a{' '}
              {hhmm(conflicto.end_time)} ({conflicto.effective_until ? `vigente hasta el ${formatDate(conflicto.effective_until)}` : `vigente desde el ${formatDate(conflicto.effective_from)}`}):
              el mismo tiempo se pagaría dos veces. Si el horario cambia a partir de una fecha, usá{' '}
              <button type="button" className="font-semibold underline" onClick={() => onModeChange({ mode: 'change', day: conflicto.day_of_week })}>
                Cambiar un día desde una fecha
              </button>.
            </p>
          ) : null}

          {state.mode === 'fix' ? (
            <p className="text-sm text-gray-500">
              Corregir es para un error de carga: cambia el bloque en toda su vigencia, también en los meses que se vuelvan
              a recalcular. Si el horario cambió a partir de una fecha, usá{' '}
              <button type="button" className="font-medium text-blue-700 hover:underline" onClick={() => onModeChange({ mode: 'change', day: state.block.day_of_week })}>
                Cambiar desde
              </button>.
            </p>
          ) : null}
        </div>
      )}

      {guardar.error ? <p className="mt-3 text-sm text-red-600">{(guardar.error as Error).message}</p> : null}

      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" className={`${primaryButtonClass} inline-flex items-center gap-2`} disabled={!puedeGuardar || guardar.isPending}
          onClick={() => guardar.mutate()}>
          <Check className="h-4 w-4" />
          {guardar.isPending
            ? 'Guardando...'
            : state.mode === 'change'
              ? `Aplicar desde el ${desde ? formatDate(desde) : '—'}`
              : state.mode === 'fix'
                ? 'Guardar la corrección'
                : dias.length > 1 ? `Agregar a ${dias.length} días` : 'Agregar bloque'}
        </button>
        <button type="button" className={secondaryButtonClass} onClick={onClose}>Cancelar</button>
      </div>
    </div>
  );
}
