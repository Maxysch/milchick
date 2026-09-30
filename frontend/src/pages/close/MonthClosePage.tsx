import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Circle, Download, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import { useInvalidateSettlement } from '../../lib/normalization';
import { useWorkingMonth, withMonth } from '../../lib/month';
import {
  cardClass,
  ErrorState,
  fieldClass,
  getBadgeClass,
  LoadingState,
  pageTitleClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../shared';

interface CloseStatus {
  period: { from: string; to: string };
  holidays: { date: string; name: string }[];
  agents: {
    profile_id: string;
    name: string;
    has_schedule: boolean;
    has_rate: boolean;
    params_loaded: boolean;
    pre_settlement_id: string | null;
    status: 'sin_preliquidar' | 'draft' | 'confirmed';
    total: number | null;
    days_to_normalize: number;
    ready: boolean;
  }[];
  steps: {
    without_schedule: number;
    without_rate: number;
    params_missing: number;
    without_draft: number;
    days_to_normalize: number;
    agents_to_normalize: number;
    ready: number;
    confirmed: number;
    total: number;
  };
}

function Paso({ n, listo, titulo, children, accion }: {
  n: number; listo: boolean; titulo: string; children: React.ReactNode; accion?: React.ReactNode;
}) {
  return (
    <div className="flex gap-4 border-b border-gray-100 py-4 last:border-0">
      <div className="pt-0.5">
        {listo ? <CheckCircle2 className="h-6 w-6 text-green-600" /> : <Circle className="h-6 w-6 text-gray-300" />}
      </div>
      <div className="flex-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Paso {n}</div>
        <div className="font-semibold text-gray-900">{titulo}</div>
        <div className="mt-1 text-sm text-gray-600">{children}</div>
      </div>
      {accion ? <div className="flex items-center">{accion}</div> : null}
    </div>
  );
}

export default function MonthClosePage() {
  // Abre en el mes que toca cerrar: el último que ya terminó
  const [month, setMonth] = useWorkingMonth();
  const [year, monthNumber] = (month ?? '').split('-').map(Number);
  const invalidate = useInvalidateSettlement();

  const statusQuery = useQuery({
    queryKey: ['close', year, monthNumber],
    queryFn: () => api.get<CloseStatus>(`/pre-settlements/close?year=${year}&month=${monthNumber}`),
    enabled: !!month,
  });
  const suggestionsQuery = useQuery({
    queryKey: ['schedule-suggestions'],
    queryFn: () => api.get<unknown[]>('/schedules/suggestions'),
  });
  const s = statusQuery.data;

  const generar = useMutation({
    mutationFn: () => api.post('/pre-settlements/generate-bulk', { period_from: s!.period.from, period_to: s!.period.to }),
    onSuccess: invalidate,
  });
  const confirmar = useMutation({
    mutationFn: () =>
      api.post<{ name: string; ok: boolean; error?: string }[]>('/pre-settlements/close/confirm-ready', { year, month: monthNumber }),
    onSuccess: invalidate,
  });

  const descargar = () =>
    api.download(`/pre-settlements/summary?from=${s!.period.from}&to=${s!.period.to}&format=csv`, `resumen-${month}.csv`);

  const sugerencias = suggestionsQuery.data?.length ?? 0;
  const todoConfirmado = s ? s.steps.confirmed === s.steps.total && s.steps.total > 0 : false;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h1 className={pageTitleClass}>Cierre del mes</h1>

      <section className={cardClass}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Mes a liquidar</label>
            <input className={`${fieldClass} w-52`} type="month" value={month ?? ''} onChange={(e) => setMonth(e.target.value)} />
          </div>
          {s ? (
            <div className="text-right">
              <div className="text-sm text-gray-500">{formatDate(s.period.from)} al {formatDate(s.period.to)}</div>
              <div className="text-2xl font-bold text-gray-900">
                {s.steps.confirmed} <span className="text-base font-normal text-gray-500">de {s.steps.total} confirmadas</span>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {!month || statusQuery.isLoading ? <LoadingState /> : null}
      {statusQuery.error ? <ErrorState message={(statusQuery.error as Error).message} /> : null}

      {s ? (
        <section className={cardClass}>
          <Paso n={1} titulo="Datos del mes" listo={s.steps.without_schedule === 0 && s.steps.without_rate === 0}>
            {s.steps.without_schedule || s.steps.without_rate ? (
              <span className="text-amber-700">
                <AlertTriangle className="mr-1 inline h-4 w-4" />
                {[s.steps.without_schedule && `${s.steps.without_schedule} sin esquema`, s.steps.without_rate && `${s.steps.without_rate} sin tarifa`]
                  .filter(Boolean).join(' · ')}. Sin eso no se les puede liquidar.{' '}
                <Link to="/agents" className="underline">Ir a Agentes</Link>
              </span>
            ) : 'Todos los agentes tienen esquema y tarifa.'}
            <div className="mt-1">
              Feriados:{' '}
              {s.holidays.length
                ? s.holidays.map((h) => `${formatDate(h.date)} (${h.name})`).join(', ')
                : <span className="text-amber-700">ninguno cargado — si el mes tiene alguno, cargalo antes de seguir.</span>}{' '}
              <Link to="/holidays" className="text-blue-700 underline">Revisar</Link>
            </div>
          </Paso>

          <Paso n={2} titulo="Evaluación mensual" listo={s.steps.params_missing === 0}
            accion={s.steps.params_missing ? <Link to={withMonth('/period-params', month)} className={secondaryButtonClass}>Cargarla</Link> : undefined}>
            {s.steps.params_missing
              ? `Falta la de ${s.steps.params_missing} ${s.steps.params_missing === 1 ? 'agente' : 'agentes'}. El REG y el SUPER REG dependen de ella.`
              : 'Cargada para todos.'}
          </Paso>

          <Paso n={3} titulo="Preliquidar" listo={s.steps.without_draft === 0}
            accion={
              <button type="button" className={`${s.steps.without_draft ? primaryButtonClass : secondaryButtonClass} inline-flex items-center gap-2`}
                disabled={generar.isPending} onClick={() => generar.mutate()}>
                <RefreshCw className={`h-4 w-4 ${generar.isPending ? 'animate-spin' : ''}`} />
                {generar.isPending ? 'Calculando...' : s.steps.without_draft ? `Preliquidar ${s.steps.without_draft}` : 'Actualizar todas'}
              </button>
            }>
            {s.steps.without_draft
              ? `${s.steps.without_draft} ${s.steps.without_draft === 1 ? 'agente sin preliquidación' : 'agentes sin preliquidación'}.`
              : 'Todos preliquidados. Se actualizan solas cuando cambia un dato; "Actualizar" trae además las marcaciones nuevas.'}
          </Paso>

          {/* Los días a normalizar salen de la preliquidación: sin ella no hay nada que mirar todavía */}
          <Paso n={4} titulo="Normalizar" listo={s.steps.without_draft === 0 && s.steps.days_to_normalize === 0}
            accion={s.steps.days_to_normalize ? <Link to={withMonth('/normalization', month)} className={primaryButtonClass}>Ir a la bandeja</Link> : undefined}>
            {s.steps.days_to_normalize
              ? `${s.steps.days_to_normalize} ${s.steps.days_to_normalize === 1 ? 'día' : 'días'} en ${s.steps.agents_to_normalize} ${s.steps.agents_to_normalize === 1 ? 'agente' : 'agentes'} no cierran contra el plan.`
              : s.steps.without_draft
                ? 'Aparecen al preliquidar: son los días en que la marcación no acompaña al plan.'
                : 'No hay días pendientes.'}
            {sugerencias ? (
              <div className="mt-1 text-amber-700">
                {sugerencias} {sugerencias === 1 ? 'esquema parece desactualizado' : 'esquemas parecen desactualizados'}: corregirlos saca días de la bandeja todos los meses.{' '}
                <Link to="/schedules" className="underline">Revisarlos</Link>
              </div>
            ) : null}
          </Paso>

          <Paso n={5} titulo="Confirmar" listo={todoConfirmado}
            accion={
              s.steps.ready ? (
                <button type="button" className={primaryButtonClass} disabled={confirmar.isPending} onClick={() => confirmar.mutate()}>
                  {confirmar.isPending ? 'Confirmando...' : `Confirmar las ${s.steps.ready} listas`}
                </button>
              ) : todoConfirmado ? (
                <button type="button" className={`${primaryButtonClass} inline-flex items-center gap-2`} onClick={descargar}>
                  <Download className="h-4 w-4" /> Resumen para pagar
                </button>
              ) : undefined
            }>
            {todoConfirmado
              ? 'Todo confirmado. El resumen sale en CSV para abrir en Excel.'
              : `${s.steps.ready} ${s.steps.ready === 1 ? 'lista' : 'listas'} para confirmar. Se confirma cuando no le quedan días por normalizar y tiene la evaluación cargada.`}
            {confirmar.data?.some((r) => !r.ok) ? (
              <div className="mt-1 text-red-600">
                {confirmar.data.filter((r) => !r.ok).map((r) => `${r.name}: ${r.error}`).join(' · ')}
              </div>
            ) : null}
          </Paso>
        </section>
      ) : null}

      {s ? (
        <section className={cardClass}>
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Por agente</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-4">Agente</th>
                  <th className="py-2 pr-4">Estado</th>
                  <th className="py-2 pr-4 text-right">A normalizar</th>
                  <th className="py-2 pr-4">Evaluación</th>
                  <th className="py-2 pr-4 text-right">Neto</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {s.agents.map((a) => (
                  <tr key={a.profile_id}>
                    <td className="py-2 pr-4 font-medium text-gray-900">{a.name}</td>
                    <td className="py-2 pr-4">
                      {a.status === 'confirmed' ? <span className={getBadgeClass('green')}>Confirmada</span>
                        : a.ready ? <span className={getBadgeClass('blue')}>Lista</span>
                          : a.status === 'draft' ? <span className={getBadgeClass('yellow')}>Borrador</span>
                            : <span className={getBadgeClass('gray')}>Sin preliquidar</span>}
                    </td>
                    <td className="py-2 pr-4 text-right">{a.days_to_normalize || '—'}</td>
                    <td className="py-2 pr-4">{a.params_loaded ? 'Cargada' : <span className="text-amber-700">Falta</span>}</td>
                    <td className="py-2 pr-4 text-right">{a.total !== null ? formatCurrency(a.total) : '—'}</td>
                    <td className="py-2 text-right">
                      {a.pre_settlement_id ? <Link to={`/pre-settlements/${a.pre_settlement_id}`} className="text-blue-700 hover:underline">Ver</Link> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
