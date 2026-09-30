import type { DayCase } from '../lib/normalization';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { cn, DAY_NAMES } from '../lib/utils';

export type Role = 'admin' | 'supervisor' | 'agent';
export type ExceptionType = 'vacation' | 'absence' | 'schedule_change' | 'extraordinary_coverage';
export type Band = 'day_ld' | 'night_ld' | 'day_hd' | 'night_hd';
export type Tier = 'normal' | 'additional' | 'overtime_50' | 'overtime_100';
export type LineSource = 'schedule' | 'exception' | 'overtime' | 'manual' | 'adjustment' | 'correction' | 'compensation';
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
  /** Horario del día, en cambio de jornada y cobertura. Reemplaza al esquema. */
  blocks?: { start_time: string; end_time: string }[] | null;
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
  /** Pagar aunque la marcación no lo respalde */
  uncapped?: boolean;
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
  recalculated_at?: string | null;
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
  /** Si el día se normalizó, cómo */
  day_correction?: DayCorrectionRecord | null;
  day_status?: string | null;
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
  | 'worked_other_hours'
  | 'worked_on_holiday'
  | 'clocked_on_leave'
  | 'additional_without_excess'
  | 'additional_over_worked'
  | 'additional_unverified'
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
  /** Bloquea la confirmación hasta normalizar el día */
  blocking: boolean;
  context: DayCase['context'];
  suggestion: DayCase['suggestion'];
  /** Qué pasó ese día, según el último cálculo */
  day: DaySummary | null;
}

export interface DaySummary {
  date: string;
  status: string;
  plan: { start_time: string; end_time: string }[];
  marked: { start_time: string; end_time: string }[];
  regularHours: number;
  exception: string | null;
  correction: string | null;
  newHire: boolean;
}

export interface DayCorrectionRecord {
  id: string;
  date: string;
  resolution: string;
  blocks: { start_time: string; end_time: string }[] | null;
  lines: { band: Band; tier: Tier; hours: number }[] | null;
  note: string | null;
  effects: Record<string, string[]> | null;
  creator?: { first_name: string; last_name: string } | null;
}

export interface PreSettlementDetail extends PreSettlementRecord {
  daily: PreSettlementDailyLine[];
  items: PreSettlementItem[];
  totals_by_type: Record<string, { hours: number; amount: number }>;
  settlement_warnings: SettlementWarning[];
  pending_warnings: number;
  warnings: PreSettlementWarnings;
  /** Días que faltan normalizar */
  blocking_pending: number;
  blocking_dates: string[];
  corrections: DayCorrectionRecord[];
  day_summary: DaySummary[];
  day_status_count: Record<string, number>;
  can_confirm: boolean;
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
  blocking_pending: number;
}

export interface BulkResult {
  profile_id: string;
  name: string;
  status: 'generated' | 'updated' | 'skipped' | 'failed';
  pre_settlement_id?: string;
  total_amount?: number;
  warnings?: number;
  /** Días a normalizar */
  blocking?: number;
  reason?: string;
}

export interface DashboardSummary {
  active_agents: number;
  draft_settlements: number;
  /** Días que no cierran contra el plan (un día con dos motivos cuenta una vez) */
  days_to_normalize: number;
  to_normalize_by_month: { month: string; days: number }[];
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
    late_arrival_margin_minutes?: number;
    early_departure_margin_minutes?: number;
    missing_clock_blocks?: boolean;
    incomplete_clock_blocks?: boolean;
    new_hire_review_days?: number;
  };
}

type NameRelation = { name: string } | Array<{ name: string }>;
type ProfileRelation =
  | { first_name: string; last_name: string; employee_id?: string | null }
  | Array<{ first_name: string; last_name: string; employee_id?: string | null }>;

export const cardClass = 'bg-white rounded-lg shadow p-6';
export const pageTitleClass = 'text-2xl font-bold text-gray-900 mb-6';
/** Campo sin ancho, para los que llevan uno fijo: `${fieldClass} w-28`. Con inputClass el
 *  w-full le gana a cualquier otro ancho y el campo se estira */
export const fieldClass = 'border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none';
export const inputClass = `${fieldClass} w-full`;
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

/** Hoy (YYYY-MM-DD) en la hora del navegador. toISOString daría el día de UTC: después de las 21 h, mañana */
export function getToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function getMonthStart() {
  return `${getToday().slice(0, 7)}-01`;
}

export function normalizeTime(value: string | null | undefined) {
  return value ? value.slice(0, 5) : '—';
}
