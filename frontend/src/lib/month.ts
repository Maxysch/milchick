import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api } from './api';

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Mes calendario anterior, por si la API no contesta */
function previousMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * El mes con el que se trabaja, en formato YYYY-MM (lo que espera
 * <input type="month">).
 *
 * Viene en la URL (`?mes=2026-08`) para que viaje en los links entre Cierre del
 * mes, Normalización, Preliquidación y Evaluación mensual: se elige una vez.
 * Sin mes en la URL es el último período que ya terminó, el que toca cerrar
 * —con corte el día 1, el mes anterior—. Mientras se averigua devuelve null.
 */
export function useWorkingMonth(): [string | null, (month: string) => void] {
  const [params, setParams] = useSearchParams();
  const enUrl = params.get('mes');
  const elegido = enUrl && MES.test(enUrl) ? enUrl : null;

  const porDefecto = useQuery({
    queryKey: ['period', 'to-close'],
    queryFn: () => api.get<{ year: number; month: number }>('/pre-settlements/period/to-close'),
    enabled: !elegido,
    staleTime: 60 * 60 * 1000,
  });

  const month =
    elegido ??
    (porDefecto.data
      ? `${porDefecto.data.year}-${String(porDefecto.data.month).padStart(2, '0')}`
      : porDefecto.isError
        ? previousMonth()
        : null);

  const setMonth = (m: string) => {
    const next = new URLSearchParams(params);
    if (MES.test(m)) next.set('mes', m);
    else next.delete('mes');
    setParams(next, { replace: true });
  };

  return [month, setMonth];
}

/** Un link que conserva el mes de trabajo */
export const withMonth = (path: string, month: string | null | undefined) =>
  month ? `${path}${path.includes('?') ? '&' : '?'}mes=${month}` : path;

/** El mes (YYYY-MM) de un período: el de su último día */
export const monthOfPeriod = (periodTo: string) => periodTo.slice(0, 7);
