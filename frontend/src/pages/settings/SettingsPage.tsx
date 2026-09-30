import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { api } from '../../lib/api';
import { useProfile } from '../../hooks/useProfile';
import ConceptCatalog from '../../components/settings/ConceptCatalog';
import { formatCurrency, formatDate, RATE_FACTOR_LABELS } from '../../lib/utils';
import {
  cardClass,
  ErrorState,
  fieldClass,
  GlobalSettings,
  inputClass,
  LoadingState,
  pageTitleClass,
  primaryButtonClass,
  RateFactorRow,
} from '../shared';

/** Orden en que se muestran, de menor a mayor recargo. */
const FACTOR_ORDER = ['nighttime', 'hd', 'additional', 'overtime_50', 'overtime_100'];

/** Tarifa de referencia para la vista previa; sólo sirve para dar magnitud. */
const SAMPLE_RATE = 4040.16029;

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { profile } = useProfile();
  const [factors, setFactors] = useState<Record<string, string>>({});
  const [startDay, setStartDay] = useState('1');
  const [threshold, setThreshold] = useState('30');
  const [margins, setMargins] = useState({ late: '20', early: '20', newHire: '14', missing: false, incomplete: false });

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<GlobalSettings>('/settings'),
  });

  useEffect(() => {
    if (!settingsQuery.data) return;
    const next: Record<string, string> = {};
    for (const f of settingsQuery.data.rate_factors) next[f.factor_key] = String(f.factor_value);
    setFactors(next);
    setStartDay(String(settingsQuery.data.settlement_settings?.period_start_day ?? 1));
    const st = settingsQuery.data.settlement_settings;
    setThreshold(String(st?.additional_threshold_minutes ?? 30));
    setMargins({
      late: String(st?.late_arrival_margin_minutes ?? 20),
      early: String(st?.early_departure_margin_minutes ?? 20),
      newHire: String(st?.new_hire_review_days ?? 14),
      missing: st?.missing_clock_blocks ?? false,
      incomplete: st?.incomplete_clock_blocks ?? false,
    });
  }, [settingsQuery.data]);

  const saveMarginsMutation = useMutation({
    mutationFn: () =>
      api.put('/settings/period', {
        additional_threshold_minutes: Number(threshold),
        late_arrival_margin_minutes: Number(margins.late),
        early_departure_margin_minutes: Number(margins.early),
        new_hire_review_days: Number(margins.newHire),
        missing_clock_blocks: margins.missing,
        incomplete_clock_blocks: margins.incomplete,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      queryClient.invalidateQueries({ queryKey: ['normalization-queue'] });
      queryClient.invalidateQueries({ queryKey: ['pre-settlement'] });
    },
  });

  const saveFactorsMutation = useMutation({
    mutationFn: () =>
      api.put<RateFactorRow[]>('/settings/rate-factors', {
        factors: Object.entries(factors).map(([factor_key, value]) => ({
          factor_key,
          factor_value: Number(value),
        })),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });

  // La vista previa la calcula el backend, así que no hay dos fórmulas que
  // puedan quedar desalineadas.
  const preview = useQuery({
    queryKey: ['period-preview', startDay],
    queryFn: () =>
      api.get<{ from: string; to: string }>(
        `/pre-settlements/period?year=2026&month=7&start_day=${Number(startDay) || 1}`
      ),
    enabled: Number(startDay) >= 1 && Number(startDay) <= 28,
  });

  const savePeriodMutation = useMutation({
    mutationFn: () =>
      api.put('/settings/period', { period_start_day: Number(startDay) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });

  if (settingsQuery.isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-8">
        <div className="mx-auto max-w-4xl"><LoadingState message="Cargando configuración..." /></div>
      </div>
    );
  }

  if (settingsQuery.error) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-8">
        <div className="mx-auto max-w-4xl"><ErrorState message={(settingsQuery.error as Error).message} /></div>
      </div>
    );
  }

  const ordered = [...(settingsQuery.data?.rate_factors ?? [])].sort(
    (a, b) => FACTOR_ORDER.indexOf(a.factor_key) - FACTOR_ORDER.indexOf(b.factor_key)
  );

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <h1 className={pageTitleClass}>Configuración</h1>

        <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
          <Info className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-600" />
          <div className="text-sm text-blue-800">
            Esto aplica a <strong>todos los agentes</strong>. Al guardar, las preliquidaciones en
            borrador se recalculan solas; las confirmadas no se tocan.
          </div>
        </div>

        {/* ── Multiplicadores ── */}
        <section className={cardClass}>
          <h2 className="text-lg font-semibold text-gray-900">Multiplicadores</h2>
          <p className="mt-1 mb-4 text-sm text-gray-500">
            Cada agente tiene una sola tarifa base. Todo lo demás sale de multiplicarla
            por estos factores. La columna de la derecha muestra el efecto sobre una
            tarifa de {formatCurrency(SAMPLE_RATE)}.
          </p>

          <div className="space-y-3">
            {ordered.map((f) => (
              <div key={f.factor_key} className="grid items-center gap-3 sm:grid-cols-[1fr_8rem_10rem]">
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    {RATE_FACTOR_LABELS[f.factor_key] ?? f.factor_key}
                  </div>
                  <div className="text-xs text-gray-500">{f.description}</div>
                </div>
                <input
                  className={inputClass}
                  type="number"
                  min="0.5"
                  max="10"
                  step="0.0025"
                  value={factors[f.factor_key] ?? ''}
                  onChange={(event) =>
                    setFactors((current) => ({ ...current, [f.factor_key]: event.target.value }))
                  }
                />
                <div className="text-sm text-gray-600">
                  {formatCurrency(SAMPLE_RATE * (Number(factors[f.factor_key]) || 0))}
                </div>
              </div>
            ))}
          </div>

          {saveFactorsMutation.error ? (
            <p className="mt-3 text-sm text-red-600">{(saveFactorsMutation.error as Error).message}</p>
          ) : null}

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              className={primaryButtonClass}
              disabled={saveFactorsMutation.isPending}
              onClick={() => saveFactorsMutation.mutate()}
            >
              {saveFactorsMutation.isPending ? 'Guardando...' : 'Guardar multiplicadores'}
            </button>
            {saveFactorsMutation.isSuccess ? (
              <span className="text-sm text-green-700">Guardado</span>
            ) : null}
          </div>
        </section>

        {/* ── Período ── */}
        <section className={cardClass}>
          <h2 className="text-lg font-semibold text-gray-900">Período de liquidación</h2>
          <p className="mt-1 mb-4 text-sm text-gray-500">
            Con día 1 el período es el mes calendario. Con cualquier otro arranca ese día
            del mes anterior y cierra el día previo del mes que se liquida.
          </p>

          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Día de corte</label>
              <input
                className={`${fieldClass} w-28`}
                type="number"
                min="1"
                max="28"
                value={startDay}
                onChange={(event) => setStartDay(event.target.value)}
              />
            </div>
            <div className="pb-2 text-sm text-gray-600">
              {preview.data ? (
                <>
                  Julio 2026 iría{' '}
                  <strong className="text-gray-900">
                    del {formatDate(preview.data.from)} al {formatDate(preview.data.to)}
                  </strong>
                </>
              ) : null}
            </div>
          </div>

          {savePeriodMutation.error ? (
            <p className="mt-3 text-sm text-red-600">{(savePeriodMutation.error as Error).message}</p>
          ) : null}

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              className={primaryButtonClass}
              disabled={savePeriodMutation.isPending}
              onClick={() => savePeriodMutation.mutate()}
            >
              {savePeriodMutation.isPending ? 'Guardando...' : 'Guardar período'}
            </button>
            {savePeriodMutation.isSuccess ? (
              <span className="text-sm text-green-700">Guardado</span>
            ) : null}
          </div>
        </section>

        {/* ── Normalización ── */}
        <section className={cardClass}>
          <h2 className="text-lg font-semibold text-gray-900">Normalización</h2>
          <p className="mt-1 mb-4 text-sm text-gray-500">
            Un día se paga solo cuando la marcación acompaña al plan dentro de estos márgenes. Si no, queda
            para normalizar y la preliquidación no se confirma hasta resolverlo. Llegar antes no cuenta:
            no cambia lo que se paga.
          </p>

          <div className="grid gap-5 sm:grid-cols-3">
            {([
              ['late', 'Llegó tarde', 'Minutos de tolerancia en el ingreso de cada tramo'],
              ['early', 'Se fue antes', 'Minutos de tolerancia en el egreso de cada tramo'],
            ] as const).map(([k, label, hint]) => (
              <div key={k}>
                <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
                <input className={`${fieldClass} w-28`} type="number" min="0" max="240" step="5"
                  value={margins[k]} onChange={(e) => setMargins({ ...margins, [k]: e.target.value })} />
                <p className="mt-1 text-xs text-gray-500">{hint}</p>
              </div>
            ))}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Trabajó de más</label>
              <input className={`${fieldClass} w-28`} type="number" min="0" max="240" step="5"
                value={threshold} onChange={(e) => setThreshold(e.target.value)} />
              <p className="mt-1 text-xs text-gray-500">
                Por encima de esto se revisa, y es el mínimo para pagar horas autorizadas. Cuenta lo de antes de
                entrar más lo de después de salir.
              </p>
            </div>
          </div>

          <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
            En julio y agosto 2026, de los días con excedente de entre 30 y 45 minutos, la planilla pagó algo de más
            en 2 de 32. Subir este valor a 45 saca esos días de la bandeja.
          </p>

          <div className="mt-6 space-y-3 border-t border-gray-200 pt-4">
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={margins.missing}
                onChange={(e) => setMargins({ ...margins, missing: e.target.checked })} />
              <span>
                Un día sin ninguna marcación se revisa
                <span className="block text-xs text-gray-500">
                  Apagado, se paga el plan y queda un aviso. En julio y agosto, en los agentes con antigüedad la planilla
                  pagó el plan en todos los días así: siempre fue "se olvidó de marcar".
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={margins.incomplete}
                onChange={(e) => setMargins({ ...margins, incomplete: e.target.checked })} />
              <span>
                Un ingreso sin egreso se revisa
                <span className="block text-xs text-gray-500">Mismo criterio que el anterior, para las marcaciones a medias.</span>
              </span>
            </label>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Agentes nuevos: se revisa todo durante</label>
                <div className="flex items-center gap-2">
                  <input className={`${fieldClass} w-24`} type="number" min="0" max="90"
                    value={margins.newHire} onChange={(e) => setMargins({ ...margins, newHire: e.target.value })} />
                  <span className="text-sm text-gray-600">días desde la fecha de ingreso</span>
                </div>
              </div>
              <p className="basis-full text-xs text-gray-500">
                Es donde está el riesgo: inducción y capacitación no siguen el esquema. En agosto, los cinco ingresos
                del 07/08 tuvieron sus dos primeras semanas distintas del plan.
              </p>
            </div>
          </div>

          {saveMarginsMutation.error ? (
            <p className="mt-3 text-sm text-red-600">{(saveMarginsMutation.error as Error).message}</p>
          ) : null}
          <div className="mt-4 flex items-center gap-3">
            <button type="button" className={primaryButtonClass} disabled={saveMarginsMutation.isPending}
              onClick={() => saveMarginsMutation.mutate()}>
              {saveMarginsMutation.isPending ? 'Guardando y recalculando...' : 'Guardar márgenes'}
            </button>
            {saveMarginsMutation.isSuccess ? <span className="text-sm text-green-700">Guardado</span> : null}
          </div>
        </section>

        {/* ── Conceptos de los ítems ── */}
        <ConceptCatalog esAdmin={profile?.role === 'admin'} />
      </div>
    </div>
  );
}
