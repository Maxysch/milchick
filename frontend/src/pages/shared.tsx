import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { cn, DAY_NAMES } from '../lib/utils';

export type Role = 'admin' | 'supervisor' | 'agent';
export type ExceptionType = 'vacation' | 'absence' | 'schedule_change' | 'extraordinary_coverage';
export type Band = 'day_ld' | 'night_ld' | 'day_hd' | 'night_hd';
export type Tier = 'normal' | 'additional' | 'overtime_50' | 'overtime_100';
export type LineSource = 'schedule' | 'exception' | 'overtime' | 'manual' | 'adjustment';
export type PreSettlementStatus = 'draft' | 'confirmed' | 'cancelled';

export interface Profile {
  id: string;
  employee_id: string | null;
  first_name: string;
  last_name: string;
  email: string;
  role: Role;
  is_active: boolean;
}

export interface Client {
  id: string;
  name: string;
  is_active: boolean;
}

export interface AgentRate {
  id: string;
  profile_id: string;
  amount_per_hour: number;
  effective_from: string;
}

export interface ScheduleEntry {
  id: string;
  profile_id: string;
  client_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  effective_from: string;
  effective_until: string | null;
  clients?: NameRelation | null;
}

export interface ClockEntry {
  id: string;
  profile_id: string;
  date: string;
  clock_in: string;
  clock_out: string | null;
  client_id: string | null;
  notes: string | null;
  clients?: NameRelation | null;
}

export interface ExceptionRecord {
  id: string;
  profile_id: string;
  exception_type: ExceptionType;
  date_from: string;
  date_to: string;
  client_id: string | null;
  notes: string | null;
  clients?: NameRelation | null;
}

export interface OvertimeRecord {
  id: string;
  profile_id: string;
  date: string;
  /** Recargo aplicado. `normal` = horas fuera del esquema a tarifa común. */
  tier: Tier;
  hours: number;
  start_time: string | null;
  end_time: string | null;
  client_id: string | null;
  notes: string | null;
  clients?: NameRelation | null;
}

export interface AdjustmentRecord {
  type?: string;
  original?: string | null;
  adjusted?: string | null;
  reason?: string;
}

export interface NormalizationResult {
  id?: string;
  clock_entry_id?: string;
  profile_id: string;
  date: string;
  normalized_in: string;
  normalized_out: string;
  daytime_hours: number;
  nighttime_hours: number;
  adjustments: AdjustmentRecord[] | null;
  previously_normalized?: boolean;
}

export interface NormalizationRule {
  id: string;
  name: string;
  description: string;
  rule_text: string;
  is_active: boolean;
}

export interface PreSettlementRecord {
  id: string;
  profile_id: string;
  period_from: string;
  period_to: string;
  status: PreSettlementStatus;
  total_amount: number;
  profiles?: ProfileRelation | null;
}

export interface TimeEntry {
  clock_in: string;
  clock_out: string | null;
}

export interface NormalizedTimeEntry {
  normalized_in: string;
  normalized_out: string;
}

export interface PreSettlementDailyLine {
  id: string;
  pre_settlement_id: string;
  date: string;
  band: Band;
  tier: Tier;
  hours: number;
  rate_per_hour: number;
  amount: number;
  is_projected: boolean;
  client_id: string | null;
  source: LineSource;
  /** Horas que había calculado el motor, si la línea se corrigió a mano */
  original_hours?: number | null;
  corrected_at?: string | null;
  corrector?: { first_name: string; last_name: string } | null;
  clients?: NameRelation | null;
  clock_times?: TimeEntry[] | null;
  /** Excepción vigente ese día (vacaciones, licencia, ausencia…) */
  day_exception?: { exception_type: string; notes: string | null } | null;
  /** Horas fuera del esquema cargadas ese día */
  day_overtime?: {
    hours: number;
    tier: Tier;
    start_time: string | null;
    end_time: string | null;
    notes: string | null;
  }[] | null;
  normalized_times?: NormalizedTimeEntry[] | null;
}

export type ItemKind = 'fixed' | 'percentage' | 'hourly';

export interface PreSettlementItem {
  id: string;
  pre_settlement_id: string;
  concept: string;
  description: string | null;
  amount: number;
  is_percentage: boolean;
  percentage_base: string | null;
  /** Forma de cálculo: percentage y hourly se recomponen con el subtotal */
  kind?: ItemKind;
  percentage?: number | null;
  quantity?: number | null;
  band?: Band | null;
  tier?: Tier | null;
  factor?: number | null;
  unit_minutes?: number | null;
  days?: number | null;
}

export interface PreSettlementWarnings {
  has_projected: boolean;
}

export type WarningCode =
  | 'no_clock_in'
  | 'no_clock_out'
  | 'arrived_late'
  | 'left_early'
  | 'worked_without_schedule'
  | 'worked_more_than_schedule'
  | 'additional_without_excess'
  | 'additional_over_worked'
  | 'absence'
  | 'missing_period_params';

export type WarningStatus = 'pending' | 'accepted' | 'corrected';

/** Desvío entre lo que se pagó (esquema) y lo que dicen las marcaciones. */
export interface SettlementWarning {
  id: string;
  date: string;
  code: WarningCode;
  detail: string;
  status: WarningStatus;
  note: string | null;
  reviewed_at: string | null;
  daily_lines: PreSettlementDailyLine[];
  clock_times: TimeEntry[] | null;
}

export interface PreSettlementDetail extends PreSettlementRecord {
  daily: PreSettlementDailyLine[];
  items: PreSettlementItem[];
  totals_by_type: Record<string, { hours: number; amount: number }>;
  settlement_warnings: SettlementWarning[];
  pending_warnings: number;
  warnings: PreSettlementWarnings;
}

export interface PeriodSummaryRow {
  pre_settlement_id: string;
  profile_id: string;
  employee_id: string | null;
  name: string;
  status: string;
  hours: number;
  subtotal: number;
  concepts: Record<string, number>;
  manual_items: number;
  net: number;
  pending_warnings: number;
}

export interface BulkResult {
  profile_id: string;
  name: string;
  status: 'generated' | 'skipped' | 'failed';
  pre_settlement_id?: string;
  total_amount?: number;
  warnings?: number;
  reason?: string;
}

export interface DashboardSummary {
  active_agents: number;
  draft_settlements: number;
  pending_warnings: number;
  missing_clock_in_today: { profile_id: string; name: string; starts_at: string }[];
  open_clock_entries: { profile_id: string; name: string; date: string; clock_in: string }[];
  agents_without_schedule: { profile_id: string; name: string }[];
  agents_without_rate: { profile_id: string; name: string }[];
}

export interface RateFactorRow {
  id: string;
  factor_key: string;
  factor_value: number;
  description: string | null;
}

export interface GlobalSettings {
  rate_factors: RateFactorRow[];
  settlement_settings: {
    id?: string;
    period_start_day: number;
    additional_threshold_minutes?: number;
  };
}

type NameRelation = { name: string } | Array<{ name: string }>;
type ProfileRelation =
  | { first_name: string; last_name: string; employee_id?: string | null }
  | Array<{ first_name: string; last_name: string; employee_id?: string | null }>;

export const cardClass = 'bg-white rounded-lg shadow p-6';
export const pageTitleClass = 'text-2xl font-bold text-gray-900 mb-6';
export const inputClass = 'border border-gray-300 rounded-lg px-3 py-2 w-full focus:ring-2 focus:ring-blue-500 focus:outline-none';
export const selectClass = inputClass;
export const textareaClass = `${inputClass} min-h-24`;
export const primaryButtonClass = 'bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60';
export const secondaryButtonClass = 'bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-60';
export const dangerButtonClass = 'bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60';
export const tableClass = 'min-w-full divide-y divide-gray-200';
export const thClass = 'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500';
export const tdClass = 'px-4 py-3 text-sm text-gray-700 align-top';
export const WEEK_DAYS = [1, 2, 3, 4, 5, 6, 0] as const;
export const DAY_OPTIONS = DAY_NAMES.map((label, value) => ({ label, value }));

export function useProfilesQuery() {
  return useQuery({
    queryKey: ['profiles'],
    queryFn: () => api.get<Profile[]>('/profiles'),
  });
}

export function useClientsQuery() {
  return useQuery({
    queryKey: ['clients'],
    queryFn: () => api.get<Client[]>('/clients'),
  });
}

export function PageSection({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className={cardClass}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function LoadingState({ message = 'Cargando...' }: { message?: string }) {
  return <div className={cardClass}><p className="text-sm text-gray-500">{message}</p></div>;
}

export function ErrorState({ message }: { message: string }) {
  return <div className={cardClass}><p className="text-sm text-red-600">{message}</p></div>;
}

export function EmptyState({ message }: { message: string }) {
  return <div className="rounded-lg border border-dashed border-gray-300 p-6 text-sm text-gray-500">{message}</div>;
}

export function getBadgeClass(tone: 'green' | 'red' | 'yellow' | 'gray' | 'blue' | 'purple') {
  return cn('px-2 py-1 rounded-full text-xs font-medium', {
    'bg-green-100 text-green-700': tone === 'green',
    'bg-red-100 text-red-700': tone === 'red',
    'bg-yellow-100 text-yellow-700': tone === 'yellow',
    'bg-gray-100 text-gray-700': tone === 'gray',
    'bg-blue-100 text-blue-700': tone === 'blue',
    'bg-purple-100 text-purple-700': tone === 'purple',
  });
}

export function formatProfileName(profile?: Pick<Profile, 'first_name' | 'last_name' | 'employee_id'> | null) {
  if (!profile) return '—';
  const name = `${profile.first_name} ${profile.last_name}`.trim();
  return profile.employee_id ? `${name} · ${profile.employee_id}` : name;
}

export function getRelationName(relation?: NameRelation | null) {
  if (!relation) return '—';
  if (Array.isArray(relation)) {
    return relation[0]?.name ?? '—';
  }
  return relation.name;
}

export function getProfileRelationName(relation?: ProfileRelation | null) {
  if (!relation) return '—';
  if (Array.isArray(relation)) {
    return relation[0] ? formatProfileName(relation[0] as Pick<Profile, 'first_name' | 'last_name' | 'employee_id'>) : '—';
  }
  return formatProfileName(relation as Pick<Profile, 'first_name' | 'last_name' | 'employee_id'>);
}

export function getToday() {
  return new Date().toISOString().split('T')[0];
}

export function getMonthStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
}

export function normalizeTime(value: string | null | undefined) {
  return value ? value.slice(0, 5) : '—';
}
