import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string): string {
  return new Date(date + 'T12:00:00').toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
  }).format(amount);
}

export const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export const HOUR_TYPE_LABELS: Record<string, string> = {
  regular_daytime: 'Diurna',
  regular_nighttime: 'Nocturna',
  overtime_daytime: 'Extra diurna',
  overtime_nighttime: 'Extra nocturna',
  holiday_daytime: 'Feriado diurna',
  holiday_nighttime: 'Feriado nocturna',
};

export const EXCEPTION_TYPE_LABELS: Record<string, string> = {
  vacation: 'Vacaciones',
  absence: 'Ausencia',
  schedule_change: 'Cambio de jornada',
  extraordinary_coverage: 'Cobertura extraordinaria',
};
