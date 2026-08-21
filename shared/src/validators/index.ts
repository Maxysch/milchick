import { z } from 'zod';

// ─── Auth ───
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});
export type LoginInput = z.infer<typeof loginSchema>;

// ─── Profile ───
// Los porcentajes van en tanto por uno: 0.04 = 4%
const pct = z.number().min(0).max(1);

export const createProfileSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  employee_id: z.string().nullable().optional(),
  role: z.enum(['admin', 'supervisor', 'agent']),
  hire_date: z.string().nullable().optional(),
  // Parámetros de liquidación
  reg_people_pct: pct.optional(),
  reg_quantitative_pct: pct.optional(),
  reg_qualitative_pct: pct.optional(),
  super_reg_pct: pct.optional(),
  equipment_pct: pct.optional(),
  seniority_months: z.number().int().min(0).optional(),
  holiday_compensation_factor: z.number().min(0).max(2).optional(),
  vacation_plus_factor: z.number().min(0).max(2).optional(),
});
export type CreateProfileInput = z.infer<typeof createProfileSchema>;

export const updateProfileSchema = createProfileSchema.partial().omit({ password: true, email: true });
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

// ─── Client ───
export const createClientSchema = z.object({
  name: z.string().min(1),
  is_active: z.boolean().default(true),
});
export type CreateClientInput = z.infer<typeof createClientSchema>;

export const updateClientSchema = createClientSchema.partial();
export type UpdateClientInput = z.infer<typeof updateClientSchema>;

// ─── Agent Rate ───
export const createAgentRateSchema = z.object({
  profile_id: z.string().uuid(),
  amount_per_hour: z.number().positive(),
  effective_from: z.string(), // ISO date
});
export type CreateAgentRateInput = z.infer<typeof createAgentRateSchema>;

// ─── Schedule ───
export const createScheduleSchema = z.object({
  profile_id: z.string().uuid(),
  client_id: z.string().uuid(),
  day_of_week: z.number().int().min(0).max(6),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  end_time: z.string().regex(/^\d{2}:\d{2}$/),
  effective_from: z.string(),
  effective_until: z.string().nullable().optional(),
});
export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;

export const updateScheduleSchema = createScheduleSchema.partial().omit({ profile_id: true });
export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>;

// ─── Clock Entry ───
export const createClockEntrySchema = z.object({
  profile_id: z.string().uuid(),
  date: z.string(),
  clock_in: z.string().regex(/^\d{2}:\d{2}$/),
  clock_out: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  client_id: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type CreateClockEntryInput = z.infer<typeof createClockEntrySchema>;

export const updateClockEntrySchema = createClockEntrySchema.partial().omit({ profile_id: true });
export type UpdateClockEntryInput = z.infer<typeof updateClockEntrySchema>;

// ─── Exception ───
export const createExceptionSchema = z.object({
  profile_id: z.string().uuid(),
  exception_type: z.enum(['vacation', 'paid_leave', 'absence', 'schedule_change', 'extraordinary_coverage']),
  date_from: z.string(),
  date_to: z.string(),
  client_id: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type CreateExceptionInput = z.infer<typeof createExceptionSchema>;

// ─── Overtime ───
export const createOvertimeSchema = z.object({
  profile_id: z.string().uuid(),
  date: z.string(),
  hours: z.number().positive(),
  tier: z.enum(['normal', 'additional', 'overtime_50', 'overtime_100']).default('overtime_50'),
  start_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  end_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  client_id: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type CreateOvertimeInput = z.infer<typeof createOvertimeSchema>;

// ─── Holiday ───
export const createHolidaySchema = z.object({
  name: z.string().min(1),
  date: z.string(),
  holiday_type: z.enum(['national', 'company']),
  year: z.number().int(),
});
export type CreateHolidayInput = z.infer<typeof createHolidaySchema>;

// ─── Settlement Rules ───
export const createSettlementRuleSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  rule_text: z.string().min(1),
  is_active: z.boolean().default(true),
});
export type CreateSettlementRuleInput = z.infer<typeof createSettlementRuleSchema>;

// ─── Normalization Rules ───
export const createNormalizationRuleSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  rule_text: z.string().min(1),
  is_active: z.boolean().default(true),
});
export type CreateNormalizationRuleInput = z.infer<typeof createNormalizationRuleSchema>;

// ─── Pre-Settlement ───
export const generatePreSettlementSchema = z.object({
  profile_id: z.string().uuid(),
  period_from: z.string(),
  period_to: z.string(),
});
export type GeneratePreSettlementInput = z.infer<typeof generatePreSettlementSchema>;

export const updatePreSettlementDailySchema = z.object({
  hours: z.number().min(0).optional(),
  rate_per_hour: z.number().min(0).optional(),
});
export type UpdatePreSettlementDailyInput = z.infer<typeof updatePreSettlementDailySchema>;

export const createPreSettlementItemSchema = z.object({
  pre_settlement_id: z.string().uuid(),
  concept: z.string().min(1),
  description: z.string().nullable().optional(),
  amount: z.number(),
  is_percentage: z.boolean().default(false),
  percentage_base: z.string().nullable().optional(),
  // Forma de cálculo. `percentage` y `hourly` se recomponen cuando cambia el subtotal.
  kind: z.enum(['fixed', 'percentage', 'hourly']).default('fixed'),
  percentage: z.number().min(0).max(10).nullable().optional(),
  quantity: z.number().min(0).nullable().optional(),
  band: z.enum(['day_ld', 'night_ld', 'day_hd', 'night_hd']).nullable().optional(),
  tier: z.enum(['normal', 'additional', 'overtime_50', 'overtime_100']).nullable().optional(),
  factor: z.number().min(0).max(10).nullable().optional(),
  // Rastro de cómo se armó la cantidad: "45 min × 21 días"
  unit_minutes: z.number().int().min(0).nullable().optional(),
  days: z.number().int().min(0).nullable().optional(),
}).refine(
  (v) => v.kind !== 'hourly' || (v.quantity != null && v.band != null && v.tier != null),
  { message: 'Un ítem por horas necesita cantidad, banda y tramo' }
).refine(
  (v) => v.kind !== 'percentage' || v.percentage != null,
  { message: 'Un ítem por porcentaje necesita el porcentaje' }
);
export type CreatePreSettlementItemInput = z.infer<typeof createPreSettlementItemSchema>;

export const updatePreSettlementItemSchema = z.object({
  concept: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  amount: z.number().optional(),
  kind: z.enum(['fixed', 'percentage', 'hourly']).optional(),
  percentage: z.number().min(0).max(10).nullable().optional(),
  quantity: z.number().min(0).nullable().optional(),
  band: z.enum(['day_ld', 'night_ld', 'day_hd', 'night_hd']).nullable().optional(),
  tier: z.enum(['normal', 'additional', 'overtime_50', 'overtime_100']).nullable().optional(),
  factor: z.number().min(0).max(10).nullable().optional(),
  unit_minutes: z.number().int().min(0).nullable().optional(),
  days: z.number().int().min(0).nullable().optional(),
});
export type UpdatePreSettlementItemInput = z.infer<typeof updatePreSettlementItemSchema>;

// ─── Configuración global de liquidación ───
export const updateRateFactorsSchema = z.object({
  factors: z.array(z.object({
    factor_key: z.enum(['nighttime', 'hd', 'additional', 'overtime_50', 'overtime_100']),
    factor_value: z.number().positive().max(10),
  })).min(1),
});
export type UpdateRateFactorsInput = z.infer<typeof updateRateFactorsSchema>;

export const updateSettlementSettingsSchema = z.object({
  period_start_day: z.number().int().min(1).max(28),
  /** Excedente mínimo del día para que se liquiden las horas cargadas */
  additional_threshold_minutes: z.number().int().min(0).max(240).optional(),
});
export type UpdateSettlementSettingsInput = z.infer<typeof updateSettlementSettingsSchema>;

// ─── Revisión de desvíos ───
export const reviewWarningSchema = z.object({
  status: z.enum(['pending', 'accepted', 'corrected']),
  note: z.string().nullable().optional(),
});
export type ReviewWarningInput = z.infer<typeof reviewWarningSchema>;

// ─── Evaluación mensual del agente ───
export const upsertPeriodParamsSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  agents: z.array(z.object({
    profile_id: z.string().uuid(),
    reg_people_pct: pct,
    reg_quantitative_pct: pct,
    reg_qualitative_pct: pct,
    super_reg_pct: pct,
    monotributo_reimbursement: z.number().min(0).default(0),
    notes: z.string().nullable().optional(),
  })).min(1),
});
export type UpsertPeriodParamsInput = z.infer<typeof upsertPeriodParamsSchema>;

// ─── Línea diaria agregada a mano ───
export const addDailyLineSchema = z.object({
  date: z.string(),
  band: z.enum(['day_ld', 'night_ld', 'day_hd', 'night_hd']),
  tier: z.enum(['normal', 'additional', 'overtime_50', 'overtime_100']),
  hours: z.number().positive(),
  client_id: z.string().uuid().nullable().optional(),
});
export type AddDailyLineInput = z.infer<typeof addDailyLineSchema>;
