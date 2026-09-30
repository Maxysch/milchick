import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { TimeBlock } from './utils';

export type ResolveAction = 'plan' | 'marks' | 'custom' | 'none' | 'authorize' | 'pay_authorized';

export interface Suggestion {
  action: ResolveAction;
  hours?: number;
  tier?: string;
  reason: string;
}

/** Un día a normalizar, como lo arma la bandeja. */
export interface DayCase {
  profile_id: string;
  agent?: string;
  pre_settlement_id?: string;
  date: string;
  codes: string[];
  details: string[];
  plan: TimeBlock[];
  marked: TimeBlock[];
  new_hire: boolean;
  /** La excepción del día: en un feriado o una licencia, "dejarlo así" no paga el esquema */
  exception?: string | null;
  suggestion: Suggestion | null;
  context: {
    suggestedHours?: number;
    authorizedHours?: number;
    excessHours?: number;
    lateMinutes?: number;
    earlyMinutes?: number;
  } | null;
}

export interface Queue {
  period: { from: string; to: string };
  items: DayCase[];
  by_agent: { profile_id: string; agent: string; days: number }[];
  totals: { days: number; with_suggestion: number; new_hires: number };
  without_draft: { profile_id: string; agent: string }[];
  params_missing: { profile_id: string; agent: string }[];
  oldest_recalculation: string | null;
}

export interface ResolvePayload {
  profile_id: string;
  date: string;
  action: ResolveAction;
  blocks?: TimeBlock[];
  hours?: number;
  tier?: string;
  note?: string | null;
}

/** Lo que cambia cuando se resuelve un día: la bandeja, la preliquidación, el cierre. */
export function useInvalidateSettlement() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      ['normalization-queue', 'pre-settlement', 'pre-settlements', 'pre-settlement-summary', 'close', 'dashboard', 'corrections']
        .map((k) => qc.invalidateQueries({ queryKey: [k] }))
    );
}

export function useResolveDay() {
  const invalidate = useInvalidateSettlement();
  return useMutation({
    mutationFn: (payload: ResolvePayload) => api.post('/normalization/resolve', payload),
    onSuccess: invalidate,
  });
}

export function useResolveMany() {
  const invalidate = useInvalidateSettlement();
  return useMutation({
    mutationFn: (items: ResolvePayload[]) =>
      api.post<{ resolved: number; failed: { profile_id: string; date: string; error: string }[] }>(
        '/normalization/resolve-bulk',
        { items }
      ),
    onSuccess: invalidate,
  });
}

/** Qué acciones tienen sentido para un día, según lo que pasó. */
export function actionsFor(day: DayCase): ResolveAction[] {
  const c = new Set(day.codes);
  const out: ResolveAction[] = ['plan'];
  if (day.marked.length > 0) out.push('marks');
  if (['worked_more_than_schedule', 'worked_without_schedule', 'worked_on_holiday', 'clocked_on_leave'].some((x) => c.has(x))) {
    out.push('authorize');
  }
  if (c.has('additional_without_excess') || c.has('additional_over_worked')) out.push('pay_authorized');
  out.push('custom');
  // En un feriado o una ausencia, dejar el día como está ya es no pagar horas
  const dejarEsNoPagar = c.has('worked_on_holiday') || (c.has('clocked_on_leave') && day.exception === 'absence');
  if (!dejarEsNoPagar) out.push('none');
  return out;
}
