import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCheck, ChevronDown, ChevronRight, Info, RefreshCw, Sparkles, Undo2 } from 'lucide-react';
import { api } from '../../lib/api';
import {
  ACTION_LABELS,
  RESOLUTION_LABELS,
  formatBlocks,
  formatDayShort,
  timeAgo,
  type TimeBlock,
} from '../../lib/utils';
import { useInvalidateSettlement, useResolveMany, type Queue, type ResolvePayload } from '../../lib/normalization';
import { useWorkingMonth } from '../../lib/month';
import DayResolver from '../../components/normalization/DayResolver';
import {
  cardClass,
  EmptyState,
  ErrorState,
  fieldClass,
  getBadgeClass,
  LoadingState,
  pageTitleClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../shared';

interface Correction {
  id: string;
  date: string;
  resolution: string;
  blocks: TimeBlock[] | null;
  note: string | null;
  effects: Record<string, string[]> | null;
  /** Es de una preliquidación confirmada: no se puede deshacer */
  locked: boolean;
  profiles: { first_name: string; last_name: string } | null;
  creator: { first_name: string; last_name: string } | null;
}

export default function NormalizationPage() {
  const [month, setMonth] = useWorkingMonth();
  const [year, monthNumber] = (month ?? '').split('-').map(Number);
  const [agente, setAgente] = useState<string | null>(null);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [confirmando, setConfirmando] = useState(false);
  const [verCorrecciones, setVerCorrecciones] = useState(false);
  const invalidate = useInvalidateSettlement();

  const periodQuery = useQuery({
    queryKey: ['period', year, monthNumber],
    queryFn: () => api.get<{ from: string; to: string }>(`/pre-settlements/period?year=${year}&month=${monthNumber}`),
    enabled: !!month,
  });
  const period = periodQuery.data;

  const queueQuery = useQuery({
    queryKey: ['normalization-queue', period?.from, period?.to],
    queryFn: () => api.get<Queue>(`/normalization/queue?from=${period!.from}&to=${period!.to}`),
    enabled: !!period,
  });
  const queue = queueQuery.data;

  const correctionsQuery = useQuery({
    queryKey: ['corrections', period?.from, period?.to],
    queryFn: () => api.get<Correction[]>(`/normalization/corrections?from=${period!.from}&to=${period!.to}`),
    enabled: !!period && verCorrecciones,
  });

  const refresh = useMutation({
    mutationFn: () => api.post('/pre-settlements/refresh', { from: period!.from }),
    onSuccess: invalidate,
  });
  const generarFaltantes = useMutation({
    mutationFn: () =>
      api.post('/pre-settlements/generate-bulk', {
        profile_ids: queue!.without_draft.map((a) => a.profile_id),
        period_from: period!.from,
        period_to: period!.to,
      }),
    onSuccess: invalidate,
  });
  const deshacer = useMutation({
    mutationFn: (id: string) => api.delete(`/normalization/corrections/${id}`),
    onSuccess: invalidate,
  });
  const resolverVarios = useResolveMany();

  const items = useMemo(
    () => (queue?.items ?? []).filter((i) => !agente || i.profile_id === agente),
    [queue, agente]
  );
  const key = (i: { profile_id: string; date: string }) => `${i.profile_id}|${i.date}`;
  const sugeribles = items.filter((i) => i.suggestion);

  // Cuando al agente elegido no le quedan días, se vuelve a ver todos
  useEffect(() => {
    if (agente && queue && !queue.by_agent.some((a) => a.profile_id === agente)) setAgente(null);
  }, [queue, agente]);

  // Al cambiar de bandeja se preseleccionan todas las sugeridas: lo habitual es
  // aceptarlas y corregir las pocas que no van
  useEffect(() => {
    setSeleccion(new Set(sugeribles.map(key)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, agente]);

  const lote: ResolvePayload[] = items
    .filter((i) => i.suggestion && seleccion.has(key(i)))
    .map((i) => ({
      profile_id: i.profile_id,
      date: i.date,
      action: i.suggestion!.action,
      ...(i.suggestion!.hours ? { hours: i.suggestion!.hours, tier: i.suggestion!.tier } : {}),
    }));

  const resumenLote = lote.reduce<Record<string, number>>((acc, l) => {
    acc[l.action] = (acc[l.action] ?? 0) + 1;
    return acc;
  }, {});

  const porAgente = useMemo(() => {
    const m = new Map<string, typeof items>();
    for (const i of items) m.set(i.agent ?? i.profile_id, [...(m.get(i.agent ?? i.profile_id) ?? []), i]);
    return [...m.entries()];
  }, [items]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <h1 className={pageTitleClass}>Normalización</h1>

      <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
        <Info className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-600" />
        <div className="text-sm text-blue-800">
          Los días que la marcación acompaña al plan se pagan solos. Acá quedan los que no cierran: llegó tarde, se fue
          antes, trabajó de más o en otro horario. Cada uno se resuelve con una decisión, y la preliquidación se
          actualiza sola. La opción <strong>sugerida</strong> es la que el liquidador suele tomar en casos así.
        </div>
      </div>

      <section className={cardClass}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Mes</label>
            <input className={`${fieldClass} w-52`} type="month" value={month ?? ''} onChange={(e) => { setMonth(e.target.value); setAgente(null); }} />
          </div>

          {queue ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-gray-500">Actualizada {timeAgo(queue.oldest_recalculation)}</span>
              <button type="button" className={`${secondaryButtonClass} inline-flex items-center gap-2`}
                disabled={refresh.isPending} onClick={() => refresh.mutate()}>
                <RefreshCw className={`h-4 w-4 ${refresh.isPending ? 'animate-spin' : ''}`} />
                {refresh.isPending ? 'Actualizando...' : 'Traer marcaciones nuevas'}
              </button>
            </div>
          ) : null}
        </div>

        {queue ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-gray-50 px-4 py-3">
              <div className="text-2xl font-bold text-gray-900">{queue.totals.days}</div>
              <div className="text-sm text-gray-500">días a normalizar</div>
            </div>
            <div className="rounded-lg bg-blue-50 px-4 py-3">
              <div className="text-2xl font-bold text-blue-700">{queue.totals.with_suggestion}</div>
              <div className="text-sm text-blue-700">con respuesta sugerida</div>
            </div>
            <div className="rounded-lg bg-purple-50 px-4 py-3">
              <div className="text-2xl font-bold text-purple-700">{queue.totals.new_hires}</div>
              <div className="text-sm text-purple-700">de agentes en sus primeras semanas</div>
            </div>
          </div>
        ) : null}

        {queue?.without_draft.length ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <span>
              {queue.without_draft.length === 1 ? '1 agente todavía no tiene' : `${queue.without_draft.length} agentes todavía no tienen`}{' '}
              preliquidación en este mes: {queue.without_draft.map((a) => a.agent).join(', ')}.
            </span>
            <button type="button" className={primaryButtonClass} disabled={generarFaltantes.isPending} onClick={() => generarFaltantes.mutate()}>
              {generarFaltantes.isPending ? 'Generando...' : 'Preliquidarlos'}
            </button>
          </div>
        ) : null}

        {queue?.params_missing.length ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <span>
              Falta la evaluación mensual de {queue.params_missing.map((a) => a.agent).join(', ')}. Sin eso no se puede confirmar.
            </span>
            <Link to="/period-params" className="font-medium underline">Cargarla</Link>
          </div>
        ) : null}
      </section>

      {!month || queueQuery.isLoading || periodQuery.isLoading ? <LoadingState /> : null}
      {queueQuery.error ? <ErrorState message={(queueQuery.error as Error).message} /> : null}

      {queue && queue.items.length === 0 ? (
        <div className={cardClass}>
          <EmptyState message="No hay días para normalizar en este mes." />
        </div>
      ) : null}

      {queue && queue.items.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setAgente(null)}
              className={`rounded-full px-3 py-1 text-sm ${!agente ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 shadow-sm hover:bg-gray-100'}`}>
              Todos · {queue.totals.days}
            </button>
            {queue.by_agent.map((a) => (
              <button key={a.profile_id} type="button" onClick={() => setAgente(agente === a.profile_id ? null : a.profile_id)}
                className={`rounded-full px-3 py-1 text-sm ${agente === a.profile_id ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 shadow-sm hover:bg-gray-100'}`}>
                {a.agent} · {a.days}
              </button>
            ))}
          </div>

          {sugeribles.length > 0 ? (
            <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-white px-4 py-3 shadow-sm">
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <Sparkles className="h-4 w-4 text-blue-600" />
                <span>
                  <strong>{lote.length}</strong> de {sugeribles.length}{' '}
                  {sugeribles.length === 1 ? 'día con sugerencia seleccionado' : 'días con sugerencia seleccionados'}
                </span>
                <button type="button" className="ml-2 text-blue-700 hover:underline" onClick={() => setSeleccion(new Set(sugeribles.map(key)))}>todas</button>
                <button type="button" className="text-blue-700 hover:underline" onClick={() => setSeleccion(new Set())}>ninguna</button>
              </div>
              <button type="button" className={`${primaryButtonClass} inline-flex items-center gap-2`}
                disabled={lote.length === 0 || resolverVarios.isPending} onClick={() => setConfirmando(true)}>
                <CheckCheck className="h-4 w-4" /> {lote.length === 1 ? 'Aceptar la sugerida' : `Aceptar las ${lote.length} sugeridas`}
              </button>
            </div>
          ) : null}

          {confirmando ? (
            <div className={`${cardClass} border border-blue-200`}>
              <h2 className="text-lg font-semibold text-gray-900">
                {lote.length === 1 ? '¿Aceptar la sugerencia?' : `¿Aceptar ${lote.length} sugerencias?`}
              </h2>
              <ul className="mt-2 space-y-1 text-sm text-gray-700">
                {Object.entries(resumenLote).map(([a, n]) => (
                  <li key={a}>{n} {n === 1 ? 'día' : 'días'}: <strong>{ACTION_LABELS[a]}</strong></li>
                ))}
              </ul>
              <p className="mt-2 text-sm text-gray-500">Se puede deshacer cualquiera desde "Correcciones aplicadas".</p>
              <div className="mt-4 flex gap-3">
                <button type="button" className={primaryButtonClass} disabled={resolverVarios.isPending}
                  onClick={() => resolverVarios.mutate(lote, { onSuccess: (r) => { if (!r.failed.length) setConfirmando(false); } })}>
                  {resolverVarios.isPending ? 'Aplicando...' : lote.length === 1 ? 'Sí, aceptarla' : 'Sí, aceptarlas'}
                </button>
                <button type="button" className={secondaryButtonClass} onClick={() => setConfirmando(false)}>Revisar de nuevo</button>
              </div>
              {resolverVarios.data?.failed.length ? (
                <p className="mt-2 text-sm text-red-600">
                  {resolverVarios.data.failed.length} no se pudieron aplicar:{' '}
                  {resolverVarios.data.failed
                    .map((f) => {
                      const quien = queue?.items.find((i) => i.profile_id === f.profile_id)?.agent;
                      return `${quien ? `${quien}, ` : ''}${formatDayShort(f.date)}: ${f.error}`;
                    })
                    .join(' · ')}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-6">
            {porAgente.map(([nombre, dias]) => (
              <section key={nombre}>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
                  {nombre} · {dias.length} {dias.length === 1 ? 'día' : 'días'}
                </h2>
                <div className="space-y-2">
                  {dias.map((d) => (
                    <DayResolver
                      key={key(d)}
                      day={d}
                      selectable
                      selected={seleccion.has(key(d))}
                      onToggle={() => {
                        const s = new Set(seleccion);
                        if (s.has(key(d))) s.delete(key(d)); else s.add(key(d));
                        setSeleccion(s);
                      }}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      ) : null}

      <section className={cardClass}>
        <button type="button" className="flex w-full items-center gap-2 text-left text-lg font-semibold text-gray-900"
          onClick={() => setVerCorrecciones(!verCorrecciones)}>
          {verCorrecciones ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
          Correcciones aplicadas
        </button>
        {verCorrecciones ? (
          <div className="mt-4">
            {correctionsQuery.isLoading ? <LoadingState /> : null}
            {correctionsQuery.data?.length === 0 ? <EmptyState message="Todavía no se normalizó ningún día en este mes." /> : null}
            {correctionsQuery.data?.length ? (
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="py-2 pr-4">Agente</th><th className="py-2 pr-4">Día</th><th className="py-2 pr-4">Cómo</th>
                    <th className="py-2 pr-4">Nota</th><th className="py-2 pr-4">Quién</th><th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {correctionsQuery.data.map((c) => (
                    <tr key={c.id}>
                      <td className="py-2 pr-4 text-gray-900">{c.profiles ? `${c.profiles.last_name}, ${c.profiles.first_name}` : '—'}</td>
                      <td className="py-2 pr-4">{formatDayShort(c.date)}</td>
                      <td className="py-2 pr-4">
                        <span className={getBadgeClass('green')}>{RESOLUTION_LABELS[c.resolution] ?? c.resolution}</span>
                        {c.blocks?.length ? <span className="ml-2 text-gray-500">{formatBlocks(c.blocks)}</span> : null}
                        {c.effects?.overtime_created ? <span className="ml-2 text-gray-500">+ horas autorizadas</span> : null}
                        {c.effects?.overtime_uncapped ? <span className="ml-2 text-gray-500">+ autorizadas pagadas igual</span> : null}
                      </td>
                      <td className="py-2 pr-4 text-gray-500">{c.note ?? ''}</td>
                      <td className="py-2 pr-4 text-gray-500">{c.creator ? `${c.creator.first_name} ${c.creator.last_name}` : ''}</td>
                      <td className="py-2 text-right">
                        {c.locked ? (
                          <span className="text-xs text-gray-400" title="Para cambiarla, volvé la preliquidación a borrador">Confirmada</span>
                        ) : (
                          <button type="button" className="inline-flex items-center gap-1 text-gray-500 hover:text-red-600"
                            disabled={deshacer.isPending} onClick={() => deshacer.mutate(c.id)} title="El día vuelve a calcularse solo">
                            <Undo2 className="h-4 w-4" /> Deshacer
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {deshacer.error ? <p className="mt-2 text-sm text-red-600">{(deshacer.error as Error).message}</p> : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
