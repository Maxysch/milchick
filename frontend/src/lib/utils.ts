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

export const BAND_LABELS: Record<string, string> = {
  day_ld: 'Diurna LD',
  night_ld: 'Nocturna LD',
  day_hd: 'Diurna HD',
  night_hd: 'Nocturna HD',
};

export const TIER_LABELS: Record<string, string> = {
  normal: 'Normal',
  additional: 'Adicional',
  overtime_50: 'Extra 50%',
  overtime_100: 'Extra 100%',
};

export const LINE_SOURCE_LABELS: Record<string, string> = {
  schedule: 'Esquema',
  exception: 'Excepción',
  overtime: 'Extra',
  manual: 'Editado a mano',
};

/** Etiqueta de una línea diaria: "Diurna LD" o "Diurna LD · Extra 50%". */
export function hourLabel(band: string, tier: string): string {
  const b = BAND_LABELS[band] ?? band;
  return tier === 'normal' ? b : `${b} · ${TIER_LABELS[tier] ?? tier}`;
}

export const CONCEPT_LABELS: Record<string, string> = {
  reg: 'Premio a la Excelencia (REG)',
  super_reg: 'SUPER REG',
  seniority: 'Antigüedad',
  equipment: 'Reintegro por uso de equipos',
  holiday_compensation: 'Compensación feriado no trabajado',
  vacation_plus: 'Plus vacacional',
};

export const WARNING_LABELS: Record<string, string> = {
  no_clock_in: 'Sin marcación de ingreso',
  no_clock_out: 'Sin marcación de egreso',
  left_early: 'Se retiró antes',
  arrived_late: 'Ingresó tarde',
  worked_without_schedule: 'Trabajó sin esquema asignado',
};

export const EXCEPTION_TYPE_LABELS: Record<string, string> = {
  vacation: 'Vacaciones',
  paid_leave: 'Licencia paga',
  absence: 'Ausencia',
  schedule_change: 'Cambio de jornada',
  extraordinary_coverage: 'Cobertura extraordinaria',
};
