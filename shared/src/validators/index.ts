import { z } from 'zod';

// ─── Auth ───
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});
export type LoginInput = z.infer<typeof loginSchema>;

// ─── Profile ───
export const createProfileSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  employee_id: z.string().nullable().optional(),
  role: z.enum(['admin', 'supervisor', 'agent']),
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
  day_of_week: z.number().int().min(0).max(6),
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
  exception_type: z.enum(['vacation', 'absence', 'schedule_change', 'extraordinary_coverage']),
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
});
export type CreatePreSettlementItemInput = z.infer<typeof createPreSettlementItemSchema>;

export const updatePreSettlementItemSchema = createPreSettlementItemSchema.partial().omit({
  pre_settlement_id: true,
});
export type UpdatePreSettlementItemInput = z.infer<typeof updatePreSettlementItemSchema>;
