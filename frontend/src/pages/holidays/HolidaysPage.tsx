import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Info, Trash2 } from 'lucide-react';
import type { Holiday } from '@milchick/shared';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/utils';
import {
  cardClass,
  EmptyState,
  ErrorState,
  fieldClass,
  getBadgeClass,
  inputClass,
  LoadingState,
  pageTitleClass,
  primaryButtonClass,
  selectClass,
} from '../shared';

const TIPO_LABELS: Record<string, string> = {
  national: 'Nacional',
  company: 'De la empresa',
};

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** El día de la semana importa: un feriado en fin de semana no suele tener esquema. */
function diaDeLaSemana(fecha: string) {
  return DIAS[new Date(`${fecha}T12:00:00`).getDay()];
}

export default function HolidaysPage() {
  const queryClient = useQueryClient();
  const [year, setYear] = useState(new Date().getFullYear());
  const [form, setForm] = useState({ name: '', date: '', holiday_type: 'national' });

  const query = useQuery({
    queryKey: ['holidays', year],
    queryFn: () => api.get<Holiday[]>(`/holidays?year=${year}`),
  });

  const crear = useMutation({
    mutationFn: () =>
      api.post('/holidays', {
        name: form.name.trim(),
        date: form.date,
        holiday_type: form.holiday_type,
        // El año sale de la fecha: pedirlo aparte sólo da lugar a que no coincidan
        year: Number(form.date.slice(0, 4)),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['holidays'] });
      setForm({ name: '', date: '', holiday_type: form.holiday_type });
    },
  });

  const borrar = useMutation({
    mutationFn: (id: string) => api.delete(`/holidays/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['holidays'] }),
  });

  const feriados = query.data ?? [];
  const completo = form.name.trim() !== '' && form.date !== '';
  const cell = 'px-4 py-3';
  const th = `${cell} text-left text-xs font-semibold uppercase tracking-wide text-gray-500`;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className={pageTitleClass}>Feriados</h1>

      <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
        <Info className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-600" />
        <div className="text-sm text-blue-800">
          Un feriado no trabajado no paga horas: las del esquema pasan a la{' '}
          <strong>compensación por feriado</strong>. Si un agente igual trabajó, se
          carga una excepción de <strong>cobertura extraordinaria</strong> para ese día.
          <br />
          Un feriado que falta se liquida como día normal, así que conviene cargar el
          año entero de una vez.
        </div>
      </div>

      <section className={cardClass}>
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Agregar un feriado</h2>
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-56 flex-1">
            <label className="mb-1 block text-sm font-medium text-gray-700">Nombre</label>
            <input
              className={inputClass}
              value={form.name}
              placeholder="Día del Trabajador"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Fecha</label>
            <input
              className={inputClass}
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Tipo</label>
            <select
              className={selectClass}
              value={form.holiday_type}
              onChange={(e) => setForm({ ...form, holiday_type: e.target.value })}
            >
              {Object.entries(TIPO_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className={primaryButtonClass}
            disabled={!completo || crear.isPending}
            onClick={() => crear.mutate()}
          >
            {crear.isPending ? 'Agregando...' : 'Agregar'}
          </button>
        </div>
        {crear.error ? (
          <p className="mt-3 text-sm text-red-600">{(crear.error as Error).message}</p>
        ) : null}
      </section>

      <section className={cardClass}>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Año</label>
            <input
              className={`${fieldClass} w-28`}
              type="number"
              min="2020"
              max="2100"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            />
          </div>
          {feriados.length > 0 ? (
            <span className={getBadgeClass('gray')}>
              {feriados.length} {feriados.length === 1 ? 'feriado' : 'feriados'}
            </span>
          ) : null}
        </div>

        {query.isLoading ? <LoadingState /> : null}
        {query.error ? <ErrorState message={(query.error as Error).message} /> : null}
        {!query.isLoading && !query.error && feriados.length === 0 ? (
          <EmptyState message={`No hay feriados cargados para ${year}.`} />
        ) : null}

        {feriados.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className={th}>Fecha</th>
                  <th className={th}>Día</th>
                  <th className={th}>Nombre</th>
                  <th className={th}>Tipo</th>
                  <th className={`${cell} text-right text-xs font-semibold uppercase tracking-wide text-gray-500`}>
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {feriados.map((f) => (
                  <tr key={f.id}>
                    <td className={`${cell} text-sm text-gray-700`}>{formatDate(f.date)}</td>
                    <td className={`${cell} text-sm text-gray-500`}>{diaDeLaSemana(f.date)}</td>
                    <td className={`${cell} text-sm text-gray-900`}>{f.name}</td>
                    <td className={`${cell} text-sm`}>
                      <span className={getBadgeClass(f.holiday_type === 'national' ? 'blue' : 'gray')}>
                        {TIPO_LABELS[f.holiday_type] ?? f.holiday_type}
                      </span>
                    </td>
                    <td className={`${cell} text-right`}>
                      <button
                        type="button"
                        title="Borrar"
                        className="text-gray-400 hover:text-red-600"
                        disabled={borrar.isPending}
                        onClick={() => borrar.mutate(f.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {borrar.error ? (
          <p className="mt-3 text-sm text-red-600">{(borrar.error as Error).message}</p>
        ) : null}
      </section>
    </div>
  );
}
