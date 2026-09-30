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

/**
 * Cómo se lee el tramo en el formulario de horas fuera del esquema. Distinto de
 * TIER_LABELS, que describe una línea ya liquidada.
 */
export const OVERTIME_TIER_OPTIONS = [
  { value: 'normal', label: 'Sin recargo — tarifa común', hint: '× 1,00' },
  { value: 'additional', label: 'Adicional — fuera del esquema', hint: '× 1,25' },
  { value: 'overtime_50', label: 'Extra al 50%', hint: '× 1,50' },
  { value: 'overtime_100', label: 'Extra al 100%', hint: '× 2,00' },
] as const;

export const LINE_SOURCE_LABELS: Record<string, string> = {
  schedule: 'Esquema',
  exception: 'Excepción',
  overtime: 'Autorizada',
  manual: 'Editado a mano',
  adjustment: 'Ajuste mes anterior',
  correction: 'Normalizado',
  compensation: 'Compensación',
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
  monotributo: 'Reintegro de monotributo',
};

export const WARNING_LABELS: Record<string, string> = {
  no_clock_in: 'No marcó',
  no_clock_out: 'Marcación incompleta',
  left_early: 'Se fue antes',
  arrived_late: 'Llegó tarde',
  worked_without_schedule: 'Trabajó sin esquema',
  worked_more_than_schedule: 'Trabajó de más',
  worked_other_hours: 'Marcó en otro horario',
  worked_on_holiday: 'Trabajó un feriado',
  clocked_on_leave: 'Marcó un día de licencia',
  additional_without_excess: 'Autorizado y no trabajado',
  additional_over_worked: 'Autorizado de más',
  additional_unverified: 'Autorizado sin marcación',
  absence: 'Ausencia',
  missing_period_params: 'Falta la evaluación mensual',
};

/** Cómo quedó resuelto un día que se normalizó. */
export const RESOLUTION_LABELS: Record<string, string> = {
  plan: 'Está bien así',
  marks: 'Se pagó lo marcado',
  custom: 'Se pagó otro horario',
  none: 'No se pagó',
  manual: 'Horas cargadas a mano',
};

/** Las acciones para normalizar un día, como se ofrecen en pantalla. */
export const ACTION_LABELS: Record<string, string> = {
  plan: 'Está bien así',
  marks: 'Pagar lo marcado',
  custom: 'Pagar otro horario',
  none: 'No pagar el día',
  authorize: 'Autorizar',
  pay_authorized: 'Pagar lo autorizado igual',
};

export const DAY_STATUS_LABELS: Record<string, string> = {
  auto: 'Se pagó solo',
  unverified: 'Sin marcación completa',
  needs_review: 'A normalizar',
  corrected: 'Normalizado',
  projected: 'Proyectado',
  leave: 'Licencia',
  holiday: 'Feriado',
  absence: 'Ausencia',
  off: 'Sin plan',
};

export interface TimeBlock {
  start_time: string;
  end_time: string;
}

/** "08:00–12:00 + 15:00–19:00", o "—" si no hay tramos */
export function formatBlocks(blocks: TimeBlock[] | null | undefined): string {
  if (!blocks || blocks.length === 0) return '—';
  return blocks.map((b) => `${b.start_time.slice(0, 5)}–${b.end_time.slice(0, 5)}`).join(' + ');
}

/** "lunes 3/8" */
export function formatDayShort(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return `${DAY_NAMES[d.getDay()].toLowerCase()} ${d.getDate()}/${d.getMonth() + 1}`;
}

/** "hace 3 min", "hace 2 h" */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'nunca';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.round(h / 24)} d`;
}

export const WARNING_STATUS_LABELS: Record<string, string> = {
  pending: 'Sin revisar',
  accepted: 'Revisado, está bien',
  corrected: 'Corregido',
};

export const RATE_FACTOR_LABELS: Record<string, string> = {
  nighttime: 'Recargo nocturno',
  hd: 'Recargo franja HD (vie 20:00 a dom 24:00)',
  additional: 'Horas adicionales',
  overtime_50: 'Horas extra al 50%',
  overtime_100: 'Horas extra al 100%',
};

export const SETTLEMENT_STATUS_LABELS: Record<string, string> = {
  draft: 'Borrador',
  confirmed: 'Confirmada',
  cancelled: 'Cancelada',
};

/** 0.0425 -> "4,25%" */
export function formatPercent(value: number): string {
  return `${(value * 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })}%`;
}

export const EXCEPTION_TYPE_LABELS: Record<string, string> = {
  vacation: 'Vacaciones',
  paid_leave: 'Licencia paga',
  absence: 'Ausencia',
  schedule_change: 'Cambio de jornada',
  extraordinary_coverage: 'Cobertura extraordinaria',
};
