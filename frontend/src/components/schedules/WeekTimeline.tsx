import { Plus } from 'lucide-react';
import { DAY_NAMES, formatDate } from '../../lib/utils';
import { BAND_STYLE, bandSegments, blockMinutes, formatHours, isoDow, type Band } from '../../lib/bands';
import type { ScheduleEntry } from '../../pages/shared';

/** Lunes primero, domingo al final */
const SEMANA = [1, 2, 3, 4, 5, 6, 0];

const hhmm = (t: string) => t.slice(0, 5);
/** "16:00" → "16" · "16:30" → "16:30": para los bloques cortos */
const corta = (t: string) => (t.slice(3, 5) === '00' ? String(Number(t.slice(0, 2))) : hhmm(t));

/**
 * La semana del agente: una fila por día y los bloques ubicados sobre una línea
 * horaria. El fondo muestra en qué banda cae cada hora —así se ve de un vistazo
 * qué parte de un horario va como nocturna o HD—.
 */
export default function WeekTimeline({
  blocks,
  upcoming,
  colorOf,
  clientName,
  selectedId,
  onSelect,
  onAdd,
}: {
  /** Los bloques vigentes a la fecha que se está mirando */
  blocks: ScheduleEntry[];
  /** Día de la semana → fecha del próximo cambio programado */
  upcoming: Map<number, string>;
  colorOf: (clientId: string) => string;
  clientName: (b: ScheduleEntry) => string;
  selectedId?: string | null;
  onSelect: (b: ScheduleEntry) => void;
  onAdd: (day: number) => void;
}) {
  // De 06 a 24 como mínimo, y más si algún bloque se sale de ahí
  const rangos = blocks.map((b) => blockMinutes(b.start_time, b.end_time));
  const desde = Math.min(6 * 60, ...rangos.map(([a]) => Math.floor(a / 60) * 60));
  const hasta = Math.max(24 * 60, ...rangos.map(([, b]) => Math.ceil(b / 60) * 60));
  const total = hasta - desde;
  const pos = (m: number) => `${((m - desde) / total) * 100}%`;
  const largo = (m: number) => `${(m / total) * 100}%`;

  const horas = Array.from({ length: total / 60 + 1 }, (_, i) => desde / 60 + i);
  const cada = total / 60 > 12 ? 3 : 2;
  const rotulo = (h: number) => (h <= 24 ? String(h).padStart(2, '0') : `${String(h - 24).padStart(2, '0')}+1`);

  const bandasUsadas = new Set<Band>();
  const columnas = 'grid grid-cols-[6.5rem_minmax(0,1fr)_2rem] items-center gap-3';

  const filas = SEMANA.map((day) => {
    const delDia = blocks
      .filter((b) => b.day_of_week === day)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
    const minutos = delDia.reduce((s, b) => {
      const [a, z] = blockMinutes(b.start_time, b.end_time);
      return s + (z - a);
    }, 0);
    const segmentos = bandSegments(isoDow(day), desde, hasta);
    segmentos.forEach((s) => bandasUsadas.add(s.band));
    return { day, delDia, minutos, segmentos };
  });

  const clientes = [...new Map(blocks.map((b) => [b.client_id, clientName(b)])).entries()];

  return (
    <div>
      {/* Eje de horas */}
      <div className={`${columnas} pb-1`}>
        <div />
        <div className="relative h-4 text-[11px] text-gray-400">
          {horas
            .filter((h) => h % cada === 0)
            .map((h, i, arr) => (
              <span
                key={h}
                className="absolute whitespace-nowrap"
                style={{
                  left: pos(h * 60),
                  transform: i === 0 && h * 60 === desde ? 'none' : i === arr.length - 1 && h * 60 === hasta ? 'translateX(-100%)' : 'translateX(-50%)',
                }}
              >
                {rotulo(h)}
              </span>
            ))}
        </div>
        <div />
      </div>

      {filas.map(({ day, delDia, minutos, segmentos }) => (
        <div key={day} className={`${columnas} border-t border-gray-100 py-1.5`}>
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-900">{DAY_NAMES[day]}</div>
            <div className="text-xs text-gray-500">{minutos ? formatHours(minutos) : 'Franco'}</div>
            {upcoming.get(day) ? (
              <div className="text-[11px] text-blue-700">cambia el {formatDate(upcoming.get(day)!).slice(0, 5)}</div>
            ) : null}
          </div>

          <div className="relative h-10 overflow-hidden rounded-md border border-gray-200 bg-white">
            {segmentos
              .filter((s) => s.band !== 'day_ld')
              .map((s) => (
                <div
                  key={`${s.band}-${s.from}`}
                  className="absolute inset-y-0"
                  style={{ left: pos(s.from), width: largo(s.to - s.from), background: BAND_STYLE[s.band].color }}
                />
              ))}
            {horas.slice(1, -1).map((h) => (
              <div
                key={h}
                className={`absolute inset-y-0 w-px ${h % cada === 0 ? 'bg-gray-200' : 'bg-gray-100'}`}
                style={{ left: pos(h * 60) }}
              />
            ))}
            {delDia.map((b) => {
              const [a, z] = blockMinutes(b.start_time, b.end_time);
              const texto = z - a >= 180 ? `${hhmm(b.start_time)}–${hhmm(b.end_time)}` : `${corta(b.start_time)}–${corta(b.end_time)}`;
              const elegido = selectedId === b.id;
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => onSelect(b)}
                  title={`${DAY_NAMES[day]} ${hhmm(b.start_time)} a ${hhmm(b.end_time)} · ${clientName(b)} · ${formatHours(z - a)}`}
                  aria-label={`${DAY_NAMES[day]} de ${hhmm(b.start_time)} a ${hhmm(b.end_time)}, ${clientName(b)}`}
                  className="absolute top-1 bottom-1 truncate rounded px-1.5 text-left text-[11px] font-semibold leading-8 text-white shadow-sm transition hover:brightness-110"
                  style={{
                    left: pos(a),
                    width: `calc(${largo(z - a)} - 2px)`,
                    background: colorOf(b.client_id),
                    outline: elegido ? '2px solid #111827' : undefined,
                    outlineOffset: elegido ? '1px' : undefined,
                  }}
                >
                  {texto}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => onAdd(day)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-blue-50 hover:text-blue-700"
            title={`Agregar un bloque el ${DAY_NAMES[day].toLowerCase()}`}
            aria-label={`Agregar un bloque el ${DAY_NAMES[day].toLowerCase()}`}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      ))}

      {/* Referencias */}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-gray-100 pt-3 text-xs text-gray-600">
        {(['day_ld', 'night_ld', 'day_hd', 'night_hd'] as Band[])
          .filter((b) => bandasUsadas.has(b))
          .map((b) => (
            <span key={b} className="inline-flex items-center gap-1.5">
              <span className="h-3 w-4 rounded-sm border border-gray-300" style={{ background: BAND_STYLE[b].color }} />
              {BAND_STYLE[b].label}
            </span>
          ))}
        {clientes.length ? <span className="hidden h-4 w-px bg-gray-200 sm:inline-block" /> : null}
        {clientes.map(([id, nombre]) => (
          <span key={id} className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm" style={{ background: colorOf(id) }} />
            {nombre}
          </span>
        ))}
      </div>
    </div>
  );
}
