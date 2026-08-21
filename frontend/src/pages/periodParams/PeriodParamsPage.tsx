import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Info } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import { api } from '../../lib/api';
import {
  cardClass,
  ErrorState,
  getBadgeClass,
  inputClass,
  LoadingState,
  pageTitleClass,
  primaryButtonClass,
} from '../shared';

interface PeriodParamRow {
  profile_id: string;
  name: string;
  employee_id: string | null;
  loaded: boolean;
  reg_people_pct: number;
  reg_quantitative_pct: number;
  reg_qualitative_pct: number;
  super_reg_pct: number;
  monotributo_reimbursement: number;
  notes: string | null;
}

/** Los porcentajes se editan como entero (4 = 4%) y se guardan en tanto por uno. */
type Draft = Record<
  string,
  { people: string; quant: string; qual: string; superReg: string; monotributo: string }
>;

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default function PeriodParamsPage() {
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(currentMonth());
  const [draft, setDraft] = useState<Draft>({});

  const [year, monthNumber] = month.split('-').map(Number);

  const rowsQuery = useQuery({
    queryKey: ['period-params', year, monthNumber],
    queryFn: () => api.get<PeriodParamRow[]>(`/period-params?year=${year}&month=${monthNumber}`),
    enabled: Number.isFinite(year) && Number.isFinite(monthNumber),
  });

  useEffect(() => {
    if (!rowsQuery.data) return;
    const next: Draft = {};
    for (const r of rowsQuery.data) {
      next[r.profile_id] = {
        people: String(r.reg_people_pct * 100),
        quant: String(r.reg_quantitative_pct * 100),
        qual: String(r.reg_qualitative_pct * 100),
        superReg: String(r.super_reg_pct * 100),
        monotributo: String(r.monotributo_reimbursement),
      };
    }
    setDraft(next);
  }, [rowsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.put('/period-params', {
        year,
        month: monthNumber,
        agents: (rowsQuery.data ?? []).map((r) => {
          const d = draft[r.profile_id];
          return {
            profile_id: r.profile_id,
            reg_people_pct: Number(d?.people ?? 0) / 100,
            reg_quantitative_pct: Number(d?.quant ?? 0) / 100,
            reg_qualitative_pct: Number(d?.qual ?? 0) / 100,
            super_reg_pct: Number(d?.superReg ?? 0) / 100,
            monotributo_reimbursement: Number(d?.monotributo ?? 0),
          };
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['period-params'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const rows = rowsQuery.data ?? [];
  const missing = rows.filter((r) => !r.loaded).length;

  const set = (id: string, field: keyof Draft[string], value: string) =>
    setDraft((current) => ({
      ...current,
      [id]: { ...current[id], [field]: value },
    }));

  const regTotal = (id: string) => {
    const d = draft[id];
    return Number(d?.people ?? 0) + Number(d?.quant ?? 0) + Number(d?.qual ?? 0);
  };

  const cell = 'px-3 py-2';
  const numberInput = `${inputClass} w-20 text-right`;

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <h1 className={pageTitleClass}>Evaluación mensual</h1>

        <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
          <Info className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-600" />
          <div className="text-sm text-blue-800">
            El Premio a la Excelencia y el SUPER REG dependen de cómo performó cada agente
            <strong> ese mes</strong>, y el reintegro de monotributo cambia con la categoría,
            así que se cargan por período. Los porcentajes de un mes sin cargar arrancan con
            el valor por defecto del agente, pero eso es sólo una red: hay que revisarlo
            antes de liquidar. El monotributo arranca siempre en cero.
          </div>
        </div>

        <section className={cardClass}>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Mes</label>
              <input
                className={`${inputClass} w-44`}
                type="month"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {missing > 0 ? (
                <span className={getBadgeClass('yellow')}>
                  <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
                  {missing} sin cargar
                </span>
              ) : rows.length > 0 ? (
                <span className={getBadgeClass('green')}>Todos cargados</span>
              ) : null}
              <button
                type="button"
                className={primaryButtonClass}
                disabled={saveMutation.isPending || rows.length === 0}
                onClick={() => saveMutation.mutate()}
              >
                {saveMutation.isPending ? 'Guardando...' : 'Guardar el mes'}
              </button>
              {saveMutation.isSuccess ? (
                <span className="text-sm text-green-700">Guardado</span>
              ) : null}
            </div>
          </div>

          {saveMutation.error ? (
            <p className="mb-3 text-sm text-red-600">{(saveMutation.error as Error).message}</p>
          ) : null}

          {rowsQuery.isLoading ? <LoadingState message="Cargando..." /> : null}
          {rowsQuery.error ? <ErrorState message={(rowsQuery.error as Error).message} /> : null}

          {rows.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className={`${cell} text-left text-xs font-semibold uppercase tracking-wide text-gray-500`}>Agente</th>
                    <th className={`${cell} text-right text-xs font-semibold uppercase tracking-wide text-gray-500`}>Gestión de personas</th>
                    <th className={`${cell} text-right text-xs font-semibold uppercase tracking-wide text-gray-500`}>Cuantitativo</th>
                    <th className={`${cell} text-right text-xs font-semibold uppercase tracking-wide text-gray-500`}>Cualitativo</th>
                    <th className={`${cell} text-right text-xs font-semibold uppercase tracking-wide text-gray-500`}>REG total</th>
                    <th className={`${cell} text-right text-xs font-semibold uppercase tracking-wide text-gray-500`}>SUPER REG</th>
                    <th className={`${cell} text-right text-xs font-semibold uppercase tracking-wide text-gray-500`}>Reintegro monotributo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {rows.map((r) => (
                    <tr key={r.profile_id} className={r.loaded ? undefined : 'bg-amber-50/40'}>
                      <td className={`${cell} text-sm text-gray-700`}>
                        {r.name}
                        {!r.loaded && (
                          <span className="ml-2 text-xs text-amber-700">sin cargar</span>
                        )}
                      </td>
                      {(['people', 'quant', 'qual'] as const).map((field) => (
                        <td key={field} className={`${cell} text-right`}>
                          <input
                            className={numberInput}
                            type="number"
                            min="0"
                            max="100"
                            step="0.5"
                            value={draft[r.profile_id]?.[field] ?? ''}
                            onChange={(event) => set(r.profile_id, field, event.target.value)}
                          />
                        </td>
                      ))}
                      <td className={`${cell} text-right text-sm font-medium text-gray-900`}>
                        {regTotal(r.profile_id).toLocaleString('es-AR', { maximumFractionDigits: 2 })}%
                      </td>
                      <td className={`${cell} text-right`}>
                        <input
                          className={numberInput}
                          type="number"
                          min="0"
                          max="100"
                          step="0.5"
                          value={draft[r.profile_id]?.superReg ?? ''}
                          onChange={(event) => set(r.profile_id, 'superReg', event.target.value)}
                        />
                      </td>
                      <td className={`${cell} text-right`}>
                        <input
                          className={`${inputClass} w-32 text-right`}
                          type="number"
                          min="0"
                          step="0.01"
                          value={draft[r.profile_id]?.monotributo ?? ''}
                          onChange={(event) => set(r.profile_id, 'monotributo', event.target.value)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50">
                  <tr>
                    <td className={`${cell} text-sm font-medium text-gray-700`} colSpan={5}>
                      Total del mes en reintegros de monotributo
                    </td>
                    <td className={`${cell} text-right text-sm font-semibold text-gray-900`}>
                      {formatCurrency(
                        rows.reduce((s, r) => s + (Number(draft[r.profile_id]?.monotributo) || 0), 0)
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
