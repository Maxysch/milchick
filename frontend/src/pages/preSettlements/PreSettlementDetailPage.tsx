import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Clock, Info, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import {
  BAND_LABELS,
  EXCEPTION_TYPE_LABELS,
  formatCurrency,
  formatDate,
  hourLabel,
  OVERTIME_TIER_OPTIONS,
  TIER_LABELS,
  LINE_SOURCE_LABELS,
  SETTLEMENT_STATUS_LABELS,
  WARNING_LABELS,
  WARNING_STATUS_LABELS,
} from '../../lib/utils';
import {
  cardClass,
  EmptyState,
  ErrorState,
  getBadgeClass,
  getProfileRelationName,
  getRelationName,
  inputClass,
  LoadingState,
  pageTitleClass,
  PreSettlementDailyLine,
  PreSettlementDetail,
  PreSettlementItem,
  primaryButtonClass,
  SettlementWarning,
} from '../shared';

/**
 * Todo lo que hay que saber del día, sin sacarlo de la tabla: qué marcó, qué
 * excepción tenía, qué horas se le cargaron fuera del esquema y, si alguien
 * corrigió las horas, cuánto decía antes.
 *
 * Se dibuja en un portal con posición fija porque la tabla vive dentro de un
 * contenedor con scroll, que recorta cualquier cosa que se salga de su caja.
 */
function TimeTooltip({ line }: { line: PreSettlementDailyLine }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  const clockTimes = line.clock_times ?? [];
  const overtime = line.day_overtime ?? [];
  const wasCorrected = line.original_hours !== null && line.original_hours !== undefined;

  const hasSomething =
    clockTimes.length > 0 || overtime.length > 0 || Boolean(line.day_exception) || wasCorrected;

  // Al hacer scroll el panel quedaría flotando lejos de su fila
  useEffect(() => {
    if (!anchor) return;
    const close = () => setAnchor(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [anchor]);

  if (!hasSomething) return null;

  const show = () => setAnchor(buttonRef.current?.getBoundingClientRect() ?? null);

  // Ámbar cuando hay algo que mirar; gris cuando sólo informa lo marcado
  const alerts = Boolean(line.day_exception) || wasCorrected;

  // Si no entra arriba, se abre para abajo
  const openDownwards = anchor !== null && anchor.top < 260;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`transition-colors ${alerts ? 'text-amber-500 hover:text-amber-600' : 'text-gray-400 hover:text-blue-600'}`}
        onMouseEnter={show}
        onMouseLeave={() => setAnchor(null)}
        onClick={() => (anchor ? setAnchor(null) : show())}
      >
        <Clock className="h-4 w-4" />
      </button>

      {anchor &&
        createPortal(
          <div
            className="pointer-events-none fixed z-50 w-max max-w-sm space-y-2 rounded-lg bg-gray-900 px-3 py-2 text-xs text-white shadow-lg"
            style={{
              left: anchor.left + anchor.width / 2,
              top: openDownwards ? anchor.bottom + 8 : anchor.top - 8,
              transform: `translate(-50%, ${openDownwards ? '0' : '-100%'})`,
            }}
          >
            {clockTimes.length > 0 && (
              <div>
                <div className="text-gray-400">Marcado</div>
                {clockTimes.map((ct, i) => (
                  <div key={i} className="font-mono">
                    {ct.clock_in.slice(0, 5)} → {ct.clock_out ? ct.clock_out.slice(0, 5) : '—'}
                  </div>
                ))}
              </div>
            )}

            {line.day_exception && (
              <div>
                <div className="text-gray-400">Excepción</div>
                <div>
                  {EXCEPTION_TYPE_LABELS[line.day_exception.exception_type] ??
                    line.day_exception.exception_type}
                </div>
                {line.day_exception.notes && (
                  <div className="text-gray-300">{line.day_exception.notes}</div>
                )}
              </div>
            )}

            {overtime.length > 0 && (
              <div>
                <div className="text-gray-400">Horas fuera del esquema</div>
                {overtime.map((ot, i) => (
                  <div key={i}>
                    {Number(ot.hours).toFixed(2)} h · {TIER_LABELS[ot.tier] ?? ot.tier}
                    {ot.start_time && ot.end_time && (
                      <span className="font-mono text-gray-300">
                        {' '}({ot.start_time.slice(0, 5)} → {ot.end_time.slice(0, 5)})
                      </span>
                    )}
                    {ot.notes && <div className="text-gray-300">{ot.notes}</div>}
                  </div>
                ))}
              </div>
            )}

            {wasCorrected && (
              <div>
                <div className="text-amber-400">Corregido a mano</div>
                <div>
                  <span className="text-gray-300 line-through">
                    {Number(line.original_hours).toFixed(2)} h
                  </span>
                  {' → '}
                  {Number(line.hours).toFixed(2)} h
                </div>
                {line.corrector && (
                  <div className="text-gray-300">
                    por {line.corrector.first_name} {line.corrector.last_name}
                    {line.corrected_at && ` · ${formatDate(line.corrected_at.slice(0, 10))}`}
                  </div>
                )}
              </div>
            )}
          </div>,
          document.body
        )}
    </>
  );
}

function DailyRow({
  line,
  onSave,
  warning,
  isFocused,
  onAcceptWarning,
  onDelete,
  day,
}: {
  line: PreSettlementDailyLine;
  onSave: (id: string, payload: { hours?: number; rate_per_hour?: number }) => void;
  /** Desvío del día, si lo hay. Se muestra en la fila para resolverlo acá mismo. */
  warning?: SettlementWarning;
  isFocused: boolean;
  onAcceptWarning: (warningId: string) => void;
  onDelete?: (lineId: string) => void;
  /** Contexto del día, para agrupar visualmente las líneas de una misma fecha */
  day: { isFirst: boolean; isLast: boolean; lineCount: number; totalHours: number; stripe: boolean };
}) {
  const [hours, setHours] = useState(String(line.hours));
  const [rate, setRate] = useState(String(line.rate_per_hour));

  useEffect(() => {
    setHours(String(line.hours));
    setRate(String(line.rate_per_hour));
  }, [line.hours, line.rate_per_hour]);

  const computedAmount = (Number(hours || 0) * Number(rate || 0)) || 0;

  const pendingWarning = warning?.status === 'pending' ? warning : undefined;

  const background = isFocused
    ? 'bg-amber-50 ring-2 ring-inset ring-amber-300'
    : pendingWarning
      ? 'bg-amber-50/40'
      : day.stripe
        ? 'bg-gray-50/70'
        : undefined;

  return (
    <tr
      id={day.isFirst ? `dia-${line.date}` : undefined}
      className={[
        background,
        // Línea divisoria entre días, para que un día se lea como un bloque
        day.isFirst ? 'border-t-2 border-gray-200' : 'border-t-0',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <td className="px-4 py-3 text-sm text-gray-700">
        {day.isFirst ? (
          <>
            <div className="flex items-center gap-1.5">
              <span className="font-medium">{formatDate(line.date)}</span>
              <TimeTooltip line={line} />
              {pendingWarning && <AlertTriangle className="h-4 w-4 text-amber-600" />}
            </div>
            {day.lineCount > 1 && (
              <div className="mt-0.5 text-xs text-gray-500">
                {day.lineCount} conceptos · {day.totalHours.toFixed(2)} hs en total
              </div>
            )}
          </>
        ) : (
          // Las líneas siguientes del mismo día no repiten la fecha
          <span className="ml-2 select-none text-gray-300">↳</span>
        )}
        {pendingWarning && day.isFirst && (
          <div className="mt-1 max-w-xs text-xs text-amber-800">
            {WARNING_LABELS[pendingWarning.code] ?? pendingWarning.code}: {pendingWarning.detail}
            <button
              type="button"
              className="mt-1 block text-blue-600 hover:text-blue-700 hover:underline"
              onClick={() => onAcceptWarning(pendingWarning.id)}
            >
              Está bien, marcar revisado
            </button>
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-sm text-gray-700">{hourLabel(line.band, line.tier)}</td>
      <td className="px-4 py-3 text-sm text-gray-700">
        <input
          className={inputClass}
          type="number"
          min="0"
          step="0.25"
          value={hours}
          onChange={(event) => setHours(event.target.value)}
          onBlur={() => {
            const value = Number(hours);
            if (value !== line.hours) {
              onSave(line.id, { hours: value });
            }
          }}
        />
      </td>
      <td className="px-4 py-3 text-sm text-gray-700">
        <input
          className={inputClass}
          type="number"
          min="0"
          step="0.01"
          value={rate}
          onChange={(event) => setRate(event.target.value)}
          onBlur={() => {
            const value = Number(rate);
            if (value !== line.rate_per_hour) {
              onSave(line.id, { rate_per_hour: value });
            }
          }}
        />
      </td>
      <td className="px-4 py-3 text-sm font-medium text-gray-900">{formatCurrency(computedAmount)}</td>
      <td className="px-4 py-3 text-sm text-gray-700">{getRelationName(line.clients)}</td>
      <td className="px-4 py-3 text-sm text-gray-700">
        <div className="flex flex-wrap items-center gap-2">
          <span className={getBadgeClass(
            line.source === 'manual' ? 'purple'
              : line.source === 'adjustment' ? 'blue'
              : line.source === 'exception' ? 'yellow'
              : 'gray'
          )}>
            {LINE_SOURCE_LABELS[line.source] ?? line.source}
          </span>
          {/* Proyectado = la fecha todavía no ocurrió cuando se generó.
              Se concilia el mes siguiente si la realidad fue otra. */}
          {line.is_projected && <span className={getBadgeClass('blue')}>Proyectado</span>}
          {line.source === 'manual' && onDelete && (
            <button
              type="button"
              className="text-gray-400 hover:text-red-600"
              title="Borrar la línea agregada a mano"
              onClick={() => onDelete(line.id)}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </td>

    </tr>
  );
}

function ItemRow({ item, onSave, onDelete }: { item: PreSettlementItem; onSave: (id: string, payload: Partial<PreSettlementItem>) => void; onDelete: (id: string) => void }) {
  const [concept, setConcept] = useState(item.concept);
  const [description, setDescription] = useState(item.description ?? '');
  const [amount, setAmount] = useState(String(item.amount));
  const [percentageBase, setPercentageBase] = useState(item.percentage_base ?? '');
  const [isPercentage, setIsPercentage] = useState(item.is_percentage);

  useEffect(() => {
    setConcept(item.concept);
    setDescription(item.description ?? '');
    setAmount(String(item.amount));
    setPercentageBase(item.percentage_base ?? '');
    setIsPercentage(item.is_percentage);
  }, [item]);

  return (
    <tr>
      <td className="px-4 py-3 text-sm text-gray-700">
        <input className={inputClass} value={concept} onChange={(event) => setConcept(event.target.value)} onBlur={() => concept !== item.concept && onSave(item.id, { concept })} />
      </td>
      <td className="px-4 py-3 text-sm text-gray-700">
        <input className={inputClass} value={description} onChange={(event) => setDescription(event.target.value)} onBlur={() => description !== (item.description ?? '') && onSave(item.id, { description: description || null })} />
      </td>
      <td className="px-4 py-3 text-sm text-gray-700">
        <input className={inputClass} type="number" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} onBlur={() => Number(amount) !== item.amount && onSave(item.id, { amount: Number(amount) })} />
      </td>
      <td className="px-4 py-3 text-sm text-gray-700">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isPercentage}
            onChange={(event) => {
              const checked = event.target.checked;
              setIsPercentage(checked);
              if (checked !== item.is_percentage) {
                onSave(item.id, { is_percentage: checked });
              }
            }}
          />
          Sí
        </label>
      </td>
      <td className="px-4 py-3 text-sm text-gray-700">
        <input className={inputClass} value={percentageBase} onChange={(event) => setPercentageBase(event.target.value)} onBlur={() => percentageBase !== (item.percentage_base ?? '') && onSave(item.id, { percentage_base: percentageBase || null })} />
      </td>
      <td className="px-4 py-3 text-sm text-gray-700">
        <button type="button" className="rounded-lg bg-red-100 px-3 py-2 text-red-700 hover:bg-red-200" onClick={() => onDelete(item.id)}>
          <Trash2 className="h-4 w-4" />
        </button>
      </td>
    </tr>
  );
}

/**
 * Aviso de desvíos.
 *
 * Sólo informa: la corrección se hace sobre la tabla de abajo, que ya tiene las
 * horas editables. Tener dos lugares donde editar lo mismo confundía.
 * Editar las horas de un día marca su desvío como revisado solo.
 */
function WarningNotice({
  warnings,
  onFocusDate,
}: {
  warnings: SettlementWarning[];
  onFocusDate: (date: string) => void;
}) {
  const [showReviewed, setShowReviewed] = useState(false);

  if (warnings.length === 0) return null;

  const pending = warnings.filter((w) => w.status === 'pending');
  const visible = showReviewed ? warnings : pending;
  const allReviewed = pending.length === 0;

  return (
    <div
      className={`rounded-lg border px-4 py-3 ${
        allReviewed ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'
      }`}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          className={`mt-0.5 h-5 w-5 flex-shrink-0 ${
            allReviewed ? 'text-green-600' : 'text-amber-600'
          }`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <strong className={allReviewed ? 'text-green-800' : 'text-amber-800'}>
              {allReviewed
                ? `Los ${warnings.length} desvíos del período están revisados`
                : `${pending.length} ${pending.length === 1 ? 'día' : 'días'} donde la marcación no acompaña al esquema pagado`}
            </strong>
            {warnings.length > pending.length && (
              <button
                type="button"
                className="text-sm text-blue-600 hover:text-blue-700"
                onClick={() => setShowReviewed((v) => !v)}
              >
                {showReviewed ? 'Ver sólo pendientes' : 'Ver todos'}
              </button>
            )}
          </div>

          {visible.length > 0 && (
            <ul className="mt-2 space-y-1">
              {visible.map((w) => (
                <li key={w.id} className="text-sm">
                  <button
                    type="button"
                    className="text-left hover:underline"
                    onClick={() => onFocusDate(w.date)}
                  >
                    <span className="font-medium">{formatDate(w.date)}</span>
                    {' — '}
                    <span>{WARNING_LABELS[w.code] ?? w.code}</span>
                    <span className="text-gray-600">. {w.detail}</span>
                    {w.status !== 'pending' && (
                      <span className="ml-1.5 text-xs text-gray-500">
                        ({WARNING_STATUS_LABELS[w.status]})
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {!allReviewed && (
            <p className="mt-2 text-sm text-gray-600">
              Se pagaron las horas del esquema. Corregí las horas en el desglose de abajo,
              o marcá el día como revisado si está bien así.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PreSettlementDetailPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const [newItem, setNewItem] = useState({
    concept: '',
    description: '',
    kind: 'fixed' as 'fixed' | 'percentage' | 'hourly',
    amount: '0',
    percentage: '',
    // Para el tipo por horas: se carga como minutos × días y se convierte
    unitMinutes: '',
    days: '',
    band: 'day_ld',
    tier: 'normal',
    factor: '1',
  });
  // Día resaltado al clickear un desvío del aviso de arriba
  const [focusedDate, setFocusedDate] = useState<string | null>(null);
  const [newLine, setNewLine] = useState({ date: '', band: 'day_ld', tier: 'normal', hours: '', client_id: '' });

  const detailQuery = useQuery({
    queryKey: ['pre-settlement', id],
    queryFn: () => api.get<PreSettlementDetail>(`/pre-settlements/${id}`),
    enabled: Boolean(id),
  });

  const dailyMutation = useMutation({
    mutationFn: ({ lineId, payload }: { lineId: string; payload: { hours?: number; rate_per_hour?: number } }) => api.patch(`/pre-settlements/daily/${lineId}`, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['pre-settlement', id] });
      await queryClient.invalidateQueries({ queryKey: ['pre-settlements'] });
    },
  });

  const addLineMutation = useMutation({
    mutationFn: () =>
      api.post(`/pre-settlements/${id}/daily`, {
        date: newLine.date,
        band: newLine.band,
        tier: newLine.tier,
        hours: Number(newLine.hours),
        client_id: newLine.client_id || null,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['pre-settlement', id] });
      await queryClient.invalidateQueries({ queryKey: ['pre-settlements'] });
      setNewLine({ date: '', band: 'day_ld', tier: 'normal', hours: '', client_id: '' });
    },
  });

  const deleteLineMutation = useMutation({
    mutationFn: (lineId: string) => api.delete<void>(`/pre-settlements/daily/${lineId}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['pre-settlement', id] });
      await queryClient.invalidateQueries({ queryKey: ['pre-settlements'] });
    },
  });

  const reviewMutation = useMutation({
    mutationFn: ({ warningId, status }: { warningId: string; status: 'pending' | 'accepted' | 'corrected' }) =>
      api.patch(`/pre-settlements/warnings/${warningId}`, { status }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['pre-settlement', id] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const itemMutation = useMutation({
    mutationFn: ({ itemId, payload }: { itemId: string; payload: Partial<PreSettlementItem> }) => api.patch(`/pre-settlements/items/${itemId}`, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['pre-settlement', id] });
      await queryClient.invalidateQueries({ queryKey: ['pre-settlements'] });
    },
  });

  const addItemMutation = useMutation({
    mutationFn: () => {
      const minutos = Number(newItem.unitMinutes) || 0;
      const dias = Number(newItem.days) || 0;
      const horas = Math.round(((minutos * dias) / 60) * 10000) / 10000;

      return api.post(`/pre-settlements/${id}/items`, {
        concept: newItem.concept,
        description: newItem.description || null,
        kind: newItem.kind,
        // El backend recalcula lo que corresponda; el importe sólo manda en `fixed`
        amount: newItem.kind === 'fixed' ? Number(newItem.amount) : 0,
        percentage:
          newItem.kind === 'percentage' ? (Number(newItem.percentage) || 0) / 100 : null,
        quantity: newItem.kind === 'hourly' ? horas : null,
        band: newItem.kind === 'hourly' ? newItem.band : null,
        tier: newItem.kind === 'hourly' ? newItem.tier : null,
        factor: newItem.kind === 'hourly' ? Number(newItem.factor) || 1 : null,
        unit_minutes: newItem.kind === 'hourly' ? minutos : null,
        days: newItem.kind === 'hourly' ? dias : null,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['pre-settlement', id] });
      await queryClient.invalidateQueries({ queryKey: ['pre-settlements'] });
      setNewItem({
        concept: '', description: '', kind: 'fixed', amount: '0', percentage: '',
        unitMinutes: '', days: '', band: 'day_ld', tier: 'normal', factor: '1',
      });
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: (itemId: string) => api.delete<void>(`/pre-settlements/items/${itemId}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['pre-settlement', id] });
      await queryClient.invalidateQueries({ queryKey: ['pre-settlements'] });
    },
  });

  const statusMutation = useMutation({
    mutationFn: (status: 'confirmed' | 'cancelled') => api.patch(`/pre-settlements/${id}/status`, { status }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['pre-settlement', id] });
      await queryClient.invalidateQueries({ queryKey: ['pre-settlements'] });
    },
  });

  const grandTotal = useMemo(() => {
    const detail = detailQuery.data;
    if (!detail) return 0;
    const dailyTotal = detail.daily.reduce((sum, item) => sum + item.amount, 0);
    const itemsTotal = detail.items.reduce((sum, item) => sum + item.amount, 0);
    return dailyTotal + itemsTotal;
  }, [detailQuery.data]);

  if (detailQuery.isLoading) {
    return <div className="min-h-screen bg-gray-50 px-4 py-8"><div className="mx-auto max-w-7xl"><LoadingState message="Cargando detalle..." /></div></div>;
  }

  if (detailQuery.error || !detailQuery.data) {
    return <div className="min-h-screen bg-gray-50 px-4 py-8"><div className="mx-auto max-w-7xl"><ErrorState message={(detailQuery.error as Error)?.message ?? 'No se encontró la preliquidación.'} /></div></div>;
  }

  const detail = detailQuery.data;

  // Minutos por día × días -> horas, que es lo que guarda el ítem
  const itemHours =
    Math.round(((Number(newItem.unitMinutes) || 0) * (Number(newItem.days) || 0) / 60) * 10000) / 10000;

  // Contexto de cada día: cuántas líneas tiene, el total de horas y si le toca
  // franja. Con esto la tabla puede leerse como bloques por fecha en vez de una
  // lista plana donde dos filas del mismo día parecen no tener relación.
  const dayContext = new Map<
    string,
    { isFirst: boolean; isLast: boolean; lineCount: number; totalHours: number; stripe: boolean }
  >();
  {
    const byDate = new Map<string, { count: number; hours: number }>();
    for (const line of detail.daily) {
      const cur = byDate.get(line.date) ?? { count: 0, hours: 0 };
      cur.count += 1;
      cur.hours += Number(line.hours);
      byDate.set(line.date, cur);
    }
    const dates = [...byDate.keys()];
    detail.daily.forEach((line, index) => {
      const totals = byDate.get(line.date)!;
      dayContext.set(line.id, {
        isFirst: index === 0 || detail.daily[index - 1].date !== line.date,
        isLast: index === detail.daily.length - 1 || detail.daily[index + 1].date !== line.date,
        lineCount: totals.count,
        totalHours: totals.hours,
        stripe: dates.indexOf(line.date) % 2 === 1,
      });
    });
  }

  // Un día puede tener varios desvíos; se muestra el primero pendiente.
  const warningByDate = new Map<string, SettlementWarning>();
  for (const w of detail.settlement_warnings ?? []) {
    const existing = warningByDate.get(w.date);
    if (!existing || (existing.status !== 'pending' && w.status === 'pending')) {
      warningByDate.set(w.date, w);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <Link to="/pre-settlements" className="mb-3 inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700">
            <ArrowLeft className="h-4 w-4" />
            Volver
          </Link>
          <h1 className={`${pageTitleClass} mb-2`}>Detalle de preliquidación</h1>
          <div className={`${cardClass} flex flex-col gap-3 md:flex-row md:items-center md:justify-between`}>
            <div>
              <div className="text-lg font-semibold text-gray-900">{getProfileRelationName(detail.profiles)}</div>
              <div className="text-sm text-gray-500">{formatDate(detail.period_from)} - {formatDate(detail.period_to)}</div>
            </div>
            <div className="flex items-center gap-4">
              <span className={getBadgeClass(detail.status === 'confirmed' ? 'green' : detail.status === 'cancelled' ? 'red' : 'yellow')}>
                {SETTLEMENT_STATUS_LABELS[detail.status] ?? detail.status}
              </span>
              <div className="text-xl font-semibold text-gray-900">{formatCurrency(detail.total_amount)}</div>
            </div>
          </div>
        </div>

        {/* Warnings */}
        {detail.warnings?.has_projected && (
          <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
            <Info className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-600" />
            <div className="text-sm text-blue-800">
              <strong>Algunas líneas están proyectadas.</strong> Corresponden a fechas futuras o a días cubiertos por una excepción (vacaciones, licencia).
            </div>
          </div>
        )}
        <WarningNotice
          warnings={detail.settlement_warnings ?? []}
          onFocusDate={(date) => {
            setFocusedDate(date);
            document.getElementById(`dia-${date}`)?.scrollIntoView({
              behavior: 'smooth',
              block: 'center',
            });
          }}
        />

        <section className={cardClass}>
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Desglose diario</h2>
          {detail.daily.length === 0 ? (
            <EmptyState message="No hay líneas diarias cargadas." />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Fecha</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Tipo</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Horas</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Tarifa</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Importe</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Cliente</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Origen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {detail.daily.map((line) => (
                    <DailyRow
                      key={line.id}
                      line={line}
                      onSave={(lineId, payload) => dailyMutation.mutate({ lineId, payload })}
                      warning={warningByDate.get(line.date)}
                      isFocused={focusedDate === line.date}
                      onAcceptWarning={(warningId) =>
                        reviewMutation.mutate({ warningId, status: 'accepted' })
                      }
                      day={dayContext.get(line.id)!}
                      onDelete={(lineId) => {
                        if (window.confirm('¿Borrar esta línea agregada a mano?')) {
                          deleteLineMutation.mutate(lineId);
                        }
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Agregar un día que el motor no generó ──
              Pasa cuando el agente cubrió una fecha que no está en su esquema.
              La línea se ordena sola por fecha al recargar. */}
          <div className="mt-6 border-t border-gray-200 pt-4">
            <h3 className="mb-3 text-sm font-medium text-gray-900">Agregar un día</h3>
            <form
              className="grid gap-3 md:grid-cols-6"
              onSubmit={(event) => {
                event.preventDefault();
                addLineMutation.mutate();
              }}
            >
              <div>
                <label className="mb-1 block text-xs text-gray-600">Fecha</label>
                <input
                  className={inputClass}
                  type="date"
                  min={detail.period_from}
                  max={detail.period_to}
                  value={newLine.date}
                  onChange={(event) => setNewLine((c) => ({ ...c, date: event.target.value }))}
                  required
                />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs text-gray-600">Banda</label>
                <select
                  className={inputClass}
                  value={newLine.band}
                  onChange={(event) => setNewLine((c) => ({ ...c, band: event.target.value }))}
                >
                  {Object.entries(BAND_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs text-gray-600">Tramo</label>
                <select
                  className={inputClass}
                  value={newLine.tier}
                  onChange={(event) => setNewLine((c) => ({ ...c, tier: event.target.value }))}
                >
                  {OVERTIME_TIER_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label} ({o.hint})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-600">Horas</label>
                <input
                  className={inputClass}
                  type="number"
                  min="0.25"
                  step="0.25"
                  value={newLine.hours}
                  onChange={(event) => setNewLine((c) => ({ ...c, hours: event.target.value }))}
                  required
                />
              </div>
              <div className="md:col-span-6 flex items-center gap-3">
                <button
                  type="submit"
                  className={primaryButtonClass}
                  disabled={addLineMutation.isPending || !newLine.date || !newLine.hours}
                >
                  {addLineMutation.isPending ? 'Agregando...' : 'Agregar día'}
                </button>
                <span className="text-xs text-gray-500">
                  Queda marcada como editada a mano, así que la conciliación del mes
                  siguiente no la toca.
                </span>
              </div>
              {addLineMutation.error ? (
                <p className="md:col-span-6 text-sm text-red-600">
                  {(addLineMutation.error as Error).message}
                </p>
              ) : null}
            </form>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Object.entries(detail.totals_by_type).map(([key, totals]) => {
            const [band, tier] = key.split(':');
            return (
            <div key={key} className={cardClass}>
              <div className="text-sm text-gray-500">{hourLabel(band, tier)}</div>
              <div className="mt-2 text-xl font-semibold text-gray-900">{totals.hours.toFixed(2)} hs</div>
              <div className="mt-1 text-sm text-gray-600">{formatCurrency(totals.amount)}</div>
            </div>
            );
          })}
        </section>

        <section className={cardClass}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-gray-900">Ítems</h2>
          </div>
          <div className="mb-6 space-y-4 rounded-lg border border-gray-200 p-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs text-gray-600">Concepto</label>
                <input className={inputClass} placeholder="Ej. compensacion_especial" value={newItem.concept}
                  onChange={(e) => setNewItem((c) => ({ ...c, concept: e.target.value }))} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-600">Descripción</label>
                <input className={inputClass} value={newItem.description}
                  onChange={(e) => setNewItem((c) => ({ ...c, description: e.target.value }))} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-600">Cómo se calcula</label>
                <select className={inputClass} value={newItem.kind}
                  onChange={(e) => setNewItem((c) => ({ ...c, kind: e.target.value as typeof c.kind }))}>
                  <option value="fixed">Importe fijo</option>
                  <option value="percentage">Porcentaje del subtotal</option>
                  <option value="hourly">Por tiempo, a valor hora</option>
                </select>
              </div>
            </div>

            {newItem.kind === 'fixed' && (
              <div className="md:w-48">
                <label className="mb-1 block text-xs text-gray-600">Importe</label>
                <input className={inputClass} type="number" step="0.01" value={newItem.amount}
                  onChange={(e) => setNewItem((c) => ({ ...c, amount: e.target.value }))} />
              </div>
            )}

            {newItem.kind === 'percentage' && (
              <div className="flex flex-wrap items-end gap-4">
                <div className="w-32">
                  <label className="mb-1 block text-xs text-gray-600">Porcentaje</label>
                  <input className={inputClass} type="number" step="0.5" min="0" max="100"
                    value={newItem.percentage}
                    onChange={(e) => setNewItem((c) => ({ ...c, percentage: e.target.value }))} />
                </div>
                <div className="pb-2 text-sm text-gray-600">
                  Sobre el subtotal de horas. Se recalcula si se corrigen las horas.
                </div>
              </div>
            )}

            {newItem.kind === 'hourly' && (
              <div className="space-y-3">
                <div className="grid gap-4 md:grid-cols-5">
                  <div>
                    <label className="mb-1 block text-xs text-gray-600">Minutos por día</label>
                    <input className={inputClass} type="number" min="0" step="5"
                      placeholder="45" value={newItem.unitMinutes}
                      onChange={(e) => setNewItem((c) => ({ ...c, unitMinutes: e.target.value }))} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-600">Días</label>
                    <input className={inputClass} type="number" min="0" step="1"
                      placeholder="21" value={newItem.days}
                      onChange={(e) => setNewItem((c) => ({ ...c, days: e.target.value }))} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-600">Valor hora</label>
                    <select className={inputClass} value={newItem.band}
                      onChange={(e) => setNewItem((c) => ({ ...c, band: e.target.value }))}>
                      {Object.entries(BAND_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-600">Tramo</label>
                    <select className={inputClass} value={newItem.tier}
                      onChange={(e) => setNewItem((c) => ({ ...c, tier: e.target.value }))}>
                      {Object.entries(TIER_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-600">Factor</label>
                    <input className={inputClass} type="number" min="0" max="2" step="0.05"
                      value={newItem.factor}
                      onChange={(e) => setNewItem((c) => ({ ...c, factor: e.target.value }))} />
                  </div>
                </div>
                <p className="text-sm text-gray-600">
                  {itemHours > 0 ? (
                    <>
                      {newItem.unitMinutes || 0} min × {newItem.days || 0} días ={' '}
                      <strong className="text-gray-900">{itemHours.toFixed(2)} h</strong>
                      {' '}a {hourLabel(newItem.band, newItem.tier)}
                      {Number(newItem.factor) !== 1 && ` × ${newItem.factor}`}
                    </>
                  ) : (
                    'Cargá los minutos por día y la cantidad de días.'
                  )}
                </p>
              </div>
            )}

            {addItemMutation.error ? (
              <p className="text-sm text-red-600">{(addItemMutation.error as Error).message}</p>
            ) : null}

            <button type="button" className={primaryButtonClass}
              onClick={() => addItemMutation.mutate()}
              disabled={addItemMutation.isPending || !newItem.concept.trim() ||
                (newItem.kind === 'hourly' && itemHours <= 0) ||
                (newItem.kind === 'percentage' && !newItem.percentage)}>
              {addItemMutation.isPending ? 'Agregando...' : 'Agregar ítem'}
            </button>
          </div>

          {detail.items.length === 0 ? (
            <EmptyState message="No hay ítems adicionales." />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Concepto</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Descripción</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Monto</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">%</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Base</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {detail.items.map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      onSave={(itemId, payload) => itemMutation.mutate({ itemId, payload })}
                      onDelete={(itemId) => {
                        if (window.confirm('¿Eliminar ítem?')) {
                          deleteItemMutation.mutate(itemId);
                        }
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={`${cardClass} flex flex-col gap-4 md:flex-row md:items-center md:justify-between`}>
          <div>
            <div className="text-sm text-gray-500">Total general</div>
            <div className="text-2xl font-semibold text-gray-900">{formatCurrency(grandTotal)}</div>
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="button" className={primaryButtonClass} onClick={() => statusMutation.mutate('confirmed')} disabled={statusMutation.isPending}>Confirmar</button>
            <button type="button" className="rounded-lg bg-red-600 px-4 py-2 text-white hover:bg-red-700" onClick={() => statusMutation.mutate('cancelled')} disabled={statusMutation.isPending}>Cancelar</button>
          </div>
        </section>
      </div>
    </div>
  );
}
