// ─── Roles ───
export type Role = 'admin' | 'supervisor' | 'agent';

// ─── Profile ───
export interface Profile {
  id: string;
  employee_id: string | null;
  first_name: string;
  last_name: string;
  email: string;
  role: Role;
  is_active: boolean;
  hire_date: string | null;
  /** Parámetros de liquidación del agente (ver SettlementParams en el backend) */
  reg_people_pct: number;
  reg_quantitative_pct: number;
  reg_qualitative_pct: number;
  super_reg_pct: number;
  equipment_pct: number;
  seniority_months: number;
  holiday_compensation_factor: number;
  vacation_plus_factor: number;
  created_at: string;
  updated_at: string;
}

// ─── Client ───
export interface Client {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Agent Rates ───
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0=Sunday (used by schedules)

export interface AgentRate {
  id: string;
  profile_id: string;
  amount_per_hour: number;
  effective_from: string;
  created_at: string;
  updated_at: string;
}

// ─── Rate Factors ───
export type RateFactorKey =
  | 'nighttime'     // recargo nocturno
  | 'hd'            // recargo de la franja HD (vie 20:00 a dom 24:00)
  | 'additional'    // horas fuera del esquema, sin llegar a extra
  | 'overtime_50'
  | 'overtime_100';

export interface RateFactor {
  id: string;
  factor_key: RateFactorKey;
  factor_value: number;
  description: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Schedule ───
export interface Schedule {
  id: string;
  profile_id: string;
  client_id: string;
  day_of_week: DayOfWeek;
  start_time: string; // HH:mm
  end_time: string;   // HH:mm
  effective_from: string; // date
  effective_until: string | null; // date, null = vigente
  created_at: string;
  updated_at: string;
}

// ─── Clock Entry ───
export interface ClockEntry {
  id: string;
  profile_id: string;
  date: string;
  clock_in: string;  // HH:mm
  clock_out: string | null; // HH:mm
  client_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Exception ───
export type ExceptionType =
  | 'vacation'
  | 'paid_leave'          // licencia paga: se liquida, pero no es vacaciones
  | 'absence'
  | 'schedule_change'
  | 'extraordinary_coverage';

export interface Exception {
  id: string;
  profile_id: string;
  exception_type: ExceptionType;
  date_from: string;
  date_to: string;
  client_id: string | null; // for extraordinary_coverage
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// ─── Overtime ───
export interface Overtime {
  id: string;
  profile_id: string;
  date: string;
  hours: number;
  tier: Tier;
  start_time: string | null; // HH:mm, optional
  end_time: string | null;   // HH:mm, optional
  client_id: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// ─── Holiday ───
export type HolidayType = 'national' | 'company';

export interface Holiday {
  id: string;
  name: string;
  date: string;
  holiday_type: HolidayType;
  year: number;
  created_at: string;
  updated_at: string;
}

// ─── Normalized Entry ───
export interface NormalizedEntry {
  id: string;
  clock_entry_id: string;
  profile_id: string;
  date: string;
  normalized_in: string;  // HH:mm
  normalized_out: string;  // HH:mm
  daytime_hours: number;
  nighttime_hours: number;
  adjustments: string | null; // JSON description of what was adjusted
  created_at: string;
}

// ─── Pre-Settlement ───
export type PreSettlementStatus = 'draft' | 'confirmed' | 'cancelled';

export interface PreSettlement {
  id: string;
  profile_id: string;
  period_from: string;
  period_to: string;
  status: PreSettlementStatus;
  total_amount: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/**
 * Banda horaria. LD es la franja habitual de lunes a viernes; HD es el resto,
 * desde el viernes 20:00 hasta el domingo a medianoche.
 */
export type Band = 'day_ld' | 'night_ld' | 'day_hd' | 'night_hd';

/** Recargo aplicado sobre la banda. */
export type Tier = 'normal' | 'additional' | 'overtime_50' | 'overtime_100';

/** De dónde salió la línea, para poder auditar la preliquidación. */
export type LineSource = 'schedule' | 'exception' | 'overtime' | 'manual' | 'adjustment';

export interface PreSettlementDaily {
  id: string;
  pre_settlement_id: string;
  date: string;
  band: Band;
  tier: Tier;
  hours: number;          // editable
  rate_per_hour: number;  // editable
  amount: number;         // recalculado
  is_projected: boolean;
  client_id: string | null;
  source: LineSource;
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
export interface PreSettlementWarning {
  id: string;
  pre_settlement_id: string;
  date: string;
  code: WarningCode;
  detail: string;
  status: WarningStatus;
  note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface RateFactor2 {
  factor_key: RateFactorKey;
  factor_value: number;
}

export interface SettlementSettings {
  id: string;
  period_start_day: number;
  created_at: string;
  updated_at: string;
}

export interface PreSettlementItem {
  id: string;
  pre_settlement_id: string;
  concept: string;         // e.g. 'presentismo', 'premio', 'plus_vacacional'
  description: string | null;
  amount: number;          // editable
  is_percentage: boolean;
  percentage_base: string | null; // what it's a percentage of
  created_at: string;
}

// ─── Normalization & Settlement Rules ───
export interface NormalizationRule {
  id: string;
  name: string;
  description: string;
  rule_text: string; // natural language for LangChain
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface SettlementRule {
  id: string;
  name: string;
  description: string;
  rule_text: string; // natural language for LangChain
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}
