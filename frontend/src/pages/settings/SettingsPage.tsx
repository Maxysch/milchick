import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { api } from '../../lib/api';
import { formatCurrency, formatDate, RATE_FACTOR_LABELS } from '../../lib/utils';
import {
  cardClass,
  ErrorState,
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
  const [factors, setFactors] = useState<Record<string, string>>({});
  const [startDay, setStartDay] = useState('1');
  const [threshold, setThreshold] = useState('30');

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
    setThreshold(String(settingsQuery.data.settlement_settings?.additional_threshold_minutes ?? 30));
  }, [settingsQuery.data]);

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
      api.put('/settings/period', {
        period_start_day: Number(startDay),
        additional_threshold_minutes: Number(threshold),
      }),
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
            Esto aplica a <strong>todos los agentes</strong>. Cambiarlo no recalcula las
            preliquidaciones ya generadas: sólo afecta a las que se generen de ahora en más.
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
                className={`${inputClass} w-28`}
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

          <div className="mt-6 border-t border-gray-200 pt-4">
            <h3 className="text-sm font-medium text-gray-900">
              Excedente mínimo para liquidar horas cargadas
            </h3>
            <p className="mt-1 mb-3 text-sm text-gray-500">
              Las horas que carga el supervisor se pagan sólo hasta lo que el agente
              efectivamente trabajó fuera de su esquema, y nada si ese excedente no llega
              a este mínimo. Cuenta lo de antes de entrar más lo de después de salir.
            </p>
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Minutos</label>
                <input
                  className={`${inputClass} w-28`}
                  type="number"
                  min="0"
                  max="240"
                  step="5"
                  value={threshold}
                  onChange={(event) => setThreshold(event.target.value)}
                />
              </div>
              <div className="pb-2 text-sm text-gray-600">
                Con {Number(threshold) || 0} min, un día de 7 h de esquema necesita{' '}
                <strong className="text-gray-900">
                  más de {(7 + (Number(threshold) || 0) / 60).toFixed(2)} h
                </strong>{' '}
                trabajadas para que se pague una adicional
              </div>
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
              {savePeriodMutation.isPending ? 'Guardando...' : 'Guardar período y umbral'}
            </button>
            {savePeriodMutation.isSuccess ? (
              <span className="text-sm text-green-700">Guardado</span>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
