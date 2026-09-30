import { useState } from 'react';
import { Check, Plus, Sparkles, Trash2, UserPlus } from 'lucide-react';
import {
  ACTION_LABELS,
  OVERTIME_TIER_OPTIONS,
  WARNING_LABELS,
  formatBlocks,
  formatDayShort,
  type TimeBlock,
} from '../../lib/utils';
import { actionsFor, useResolveDay, type DayCase, type ResolveAction } from '../../lib/normalization';
import { fieldClass, getBadgeClass } from '../../pages/shared';

/**
 * Un día que no cierra contra el plan, con lo que se puede hacer.
 *
 * Normalizar es una sola decisión por día. La sugerida aparece primero y
 * resaltada: en julio y agosto 2026 coincidió con lo que decidió el liquidador
 * en 9 de cada 10 días.
 */
export default function DayResolver({
  day,
  showAgent = false,
  selectable,
  selected,
  onToggle,
}: {
  day: DayCase;
  showAgent?: boolean;
  /** Para elegir días a resolver en bloque */
  selectable?: boolean;
  selected?: boolean;
  onToggle?: () => void;
}) {
  const resolve = useResolveDay();
  const [abierto, setAbierto] = useState<ResolveAction | null>(null);
  const [nota, setNota] = useState('');
  const [horas, setHoras] = useState(String(day.context?.suggestedHours || 1));
  const [tramo, setTramo] = useState('additional');
  const [bloques, setBloques] = useState<TimeBlock[]>(
    day.marked.length ? day.marked : day.plan.length ? day.plan : [{ start_time: '09:00', end_time: '15:00' }]
  );

  const acciones = actionsFor(day);
  const sugerida = day.suggestion?.action ?? null;
  const ordenadas = sugerida ? [sugerida, ...acciones.filter((a) => a !== sugerida)] : acciones;

  const aplicar = (action: ResolveAction) =>
    resolve.mutate({
      profile_id: day.profile_id,
      date: day.date,
      action,
      note: nota.trim() || null,
      ...(action === 'authorize' ? { hours: Number(horas), tier: tramo } : {}),
      ...(action === 'custom' ? { blocks: bloques } : {}),
    });

  const click = (action: ResolveAction) => {
    // Las que necesitan un dato más se abren; el resto se aplican de una
    if (action === 'authorize' || action === 'custom') {
      setAbierto(abierto === action ? null : action);
      return;
    }
    aplicar(action);
  };

  // "Está bien así" deja el día como lo calculó el sistema. En un feriado o una
  // licencia eso no es el esquema, y conviene que el botón lo diga
  const dejarAsi =
    day.codes.includes('worked_on_holiday') ? 'Dejarlo como feriado'
      : day.codes.includes('clocked_on_leave')
        ? day.exception === 'absence' ? 'Dejar la ausencia' : 'Dejar la licencia'
        : ACTION_LABELS.plan;

  const etiqueta = (a: ResolveAction) =>
    a === 'plan'
      ? dejarAsi
      : a === 'authorize' && day.context?.suggestedHours
        ? `Autorizar ${String(day.context.suggestedHours).replace('.', ',')} h`
        : ACTION_LABELS[a];

  return (
    <div className={`rounded-lg border px-4 py-3 ${selected ? 'border-blue-300 bg-blue-50/40' : 'border-gray-200 bg-white'}`}>
      <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
        <div className="flex min-w-44 items-start gap-3">
          {selectable ? (
            <input
              type="checkbox"
              className="mt-1 h-4 w-4"
              checked={!!selected}
              onChange={onToggle}
              disabled={!day.suggestion}
              title={day.suggestion ? 'Incluir al aceptar las sugeridas' : 'Sin sugerencia: se resuelve de a uno'}
            />
          ) : null}
          <div>
            {showAgent && day.agent ? <div className="text-sm font-semibold text-gray-900">{day.agent}</div> : null}
            <div className={showAgent ? 'text-sm text-gray-600' : 'text-sm font-semibold text-gray-900'}>
              {formatDayShort(day.date)}
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {day.codes.map((c) => (
                <span key={c} className={getBadgeClass('yellow')}>{WARNING_LABELS[c] ?? c}</span>
              ))}
              {day.new_hire ? (
                <span className={getBadgeClass('purple')}>
                  <UserPlus className="mr-1 inline h-3 w-3" />
                  Agente nuevo
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="min-w-56 flex-1 text-sm">
          <div className="grid grid-cols-[4.5rem_1fr] gap-x-2 text-gray-600">
            <span className="text-gray-400">Plan</span>
            <span className="font-medium text-gray-800">{formatBlocks(day.plan)}</span>
            <span className="text-gray-400">Marcó</span>
            <span className="font-medium text-gray-800">{formatBlocks(day.marked)}</span>
          </div>
          <ul className="mt-1 space-y-0.5 text-xs text-gray-500">
            {day.details.map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {ordenadas.map((a) => {
          const esSugerida = a === sugerida;
          return (
            <button
              key={a}
              type="button"
              disabled={resolve.isPending}
              onClick={() => click(a)}
              title={esSugerida ? day.suggestion?.reason : undefined}
              className={
                esSugerida
                  ? 'inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60'
                  : `inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm ${
                      abierto === a ? 'bg-gray-200 text-gray-900' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    } disabled:opacity-60`
              }
            >
              {esSugerida ? <Sparkles className="h-3.5 w-3.5" /> : null}
              {etiqueta(a)}
            </button>
          );
        })}
        <input
          className="ml-auto w-56 rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Nota (opcional)"
          value={nota}
          onChange={(e) => setNota(e.target.value)}
        />
      </div>

      {sugerida && day.suggestion ? (
        <p className="mt-1 text-xs text-blue-700">Sugerida: {day.suggestion.reason}</p>
      ) : null}

      {abierto === 'authorize' ? (
        <div className="mt-3 flex flex-wrap items-end gap-3 rounded-lg bg-gray-50 px-3 py-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Horas</label>
            <input className={`${fieldClass} w-24`} type="number" min="0.25" step="0.25" value={horas}
              onChange={(e) => setHoras(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Tramo</label>
            <select className={`${fieldClass} w-72`} value={tramo} onChange={(e) => setTramo(e.target.value)}>
              {OVERTIME_TIER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label} ({o.hint})</option>
              ))}
            </select>
          </div>
          <button type="button" className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
            disabled={resolve.isPending || !(Number(horas) > 0)} onClick={() => aplicar('authorize')}>
            <Check className="h-4 w-4" /> Autorizar y dar por revisado
          </button>
          <p className="basis-full text-xs text-gray-500">
            Se pagan hasta lo que efectivamente trabajó de más. Elegí bien el tramo: una hora Extra 100% vale el doble
            que una normal.
          </p>
        </div>
      ) : null}

      {abierto === 'custom' ? (
        <div className="mt-3 space-y-2 rounded-lg bg-gray-50 px-3 py-2">
          {bloques.map((b, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className={`${fieldClass} w-36`} type="time" value={b.start_time}
                onChange={(e) => setBloques(bloques.map((x, j) => (j === i ? { ...x, start_time: e.target.value } : x)))} />
              <span className="text-gray-400">a</span>
              <input className={`${fieldClass} w-36`} type="time" value={b.end_time}
                onChange={(e) => setBloques(bloques.map((x, j) => (j === i ? { ...x, end_time: e.target.value } : x)))} />
              {bloques.length > 1 ? (
                <button type="button" className="text-gray-400 hover:text-red-600" title="Sacar este tramo"
                  onClick={() => setBloques(bloques.filter((_, j) => j !== i))}>
                  <Trash2 className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          ))}
          <div className="flex items-center gap-3">
            <button type="button" className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline"
              onClick={() => setBloques([...bloques, { start_time: '15:00', end_time: '19:00' }])}>
              <Plus className="h-3.5 w-3.5" /> Agregar tramo
            </button>
            <button type="button" className="ml-auto inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
              disabled={resolve.isPending} onClick={() => aplicar('custom')}>
              <Check className="h-4 w-4" /> Pagar este horario
            </button>
          </div>
          <p className="text-xs text-gray-500">El sistema reparte las horas en sus bandas: lo que pase de las 21 h un día hábil va como nocturna.</p>
        </div>
      ) : null}

      {resolve.error ? <p className="mt-2 text-sm text-red-600">{(resolve.error as Error).message}</p> : null}
    </div>
  );
}
