import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { supabaseAdmin } from '../config/supabase.js';

/**
 * Tool to query worked hours for a profile in a date range
 */
export const getWorkedHours = tool(
  async ({ profile_id, date_from, date_to }) => {
    const { data, error } = await supabaseAdmin
      .from('normalized_entries')
      .select('date, normalized_in, normalized_out, daytime_hours, nighttime_hours')
      .eq('profile_id', profile_id)
      .gte('date', date_from)
      .lte('date', date_to)
      .order('date');

    if (error) return `Error: ${error.message}`;

    if (!data || data.length === 0) return 'No hay horas registradas para ese período.';

    const totalDaytime = data.reduce((sum, e) => sum + e.daytime_hours, 0);
    const totalNighttime = data.reduce((sum, e) => sum + e.nighttime_hours, 0);

    const summary = data.map(e =>
      `${e.date}: ${e.normalized_in}-${e.normalized_out} (diurnas: ${e.daytime_hours}h, nocturnas: ${e.nighttime_hours}h)`
    ).join('\n');

    return `Horas trabajadas del ${date_from} al ${date_to}:\n${summary}\n\nTotal diurnas: ${totalDaytime}h, Total nocturnas: ${totalNighttime}h, Total: ${totalDaytime + totalNighttime}h`;
  },
  {
    name: 'get_worked_hours',
    description: 'Consulta las horas trabajadas (normalizadas) de un agente en un rango de fechas. Devuelve el desglose diario y totales por tipo (diurna/nocturna).',
    schema: z.object({
      profile_id: z.string().describe('UUID del perfil del agente'),
      date_from: z.string().describe('Fecha inicio (YYYY-MM-DD)'),
      date_to: z.string().describe('Fecha fin (YYYY-MM-DD)'),
    }),
  }
);

/**
 * Tool to query the active schedule for a profile
 */
export const getSchedule = tool(
  async ({ profile_id, date }) => {
    const dayOfWeek = new Date(date + 'T12:00:00').getDay();

    const { data, error } = await supabaseAdmin
      .from('schedules')
      .select('*, clients(name)')
      .eq('profile_id', profile_id)
      .lte('effective_from', date)
      .or(`effective_until.is.null,effective_until.gte.${date}`)
      .order('day_of_week')
      .order('start_time');

    if (error) return `Error: ${error.message}`;
    if (!data || data.length === 0) return 'No hay esquema activo para esa fecha.';

    const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

    const byDay = data.reduce((acc: Record<number, typeof data>, s) => {
      if (!acc[s.day_of_week]) acc[s.day_of_week] = [];
      acc[s.day_of_week].push(s);
      return acc;
    }, {});

    const lines = Object.entries(byDay).map(([day, entries]) => {
      const dayName = dayNames[parseInt(day)];
      const slots = (entries as typeof data).map(e =>
        `  ${e.start_time}-${e.end_time} (${(e as Record<string, unknown>).clients ? ((e as Record<string, unknown>).clients as Record<string, string>).name : 'Sin cliente'})`
      ).join('\n');
      return `${dayName}:\n${slots}`;
    }).join('\n');

    return `Esquema vigente al ${date} (día consultado: ${dayNames[dayOfWeek]}):\n${lines}`;
  },
  {
    name: 'get_schedule',
    description: 'Consulta el cronograma/esquema horario vigente de un agente para una fecha dada. Muestra todos los días de la semana con sus bloques horarios.',
    schema: z.object({
      profile_id: z.string().describe('UUID del perfil del agente'),
      date: z.string().describe('Fecha de referencia para la vigencia (YYYY-MM-DD)'),
    }),
  }
);

/**
 * Tool to query exceptions (vacations, absences, etc.)
 */
export const getExceptions = tool(
  async ({ profile_id, date_from, date_to }) => {
    const { data, error } = await supabaseAdmin
      .from('exceptions')
      .select('exception_type, date_from, date_to, notes, clients(name)')
      .eq('profile_id', profile_id)
      .gte('date_to', date_from)
      .lte('date_from', date_to)
      .order('date_from');

    if (error) return `Error: ${error.message}`;
    if (!data || data.length === 0) return 'No hay excepciones para ese período.';

    const typeLabels: Record<string, string> = {
      vacation: 'Vacaciones',
      absence: 'Ausencia',
      schedule_change: 'Cambio de jornada',
      extraordinary_coverage: 'Cobertura extraordinaria',
    };

    const lines = data.map(e => {
      const client = (e as Record<string, unknown>).clients
        ? ` - Cliente: ${((e as Record<string, unknown>).clients as Record<string, string>).name}`
        : '';
      return `${typeLabels[e.exception_type] || e.exception_type}: ${e.date_from} al ${e.date_to}${client}${e.notes ? ` (${e.notes})` : ''}`;
    }).join('\n');

    return `Excepciones del ${date_from} al ${date_to}:\n${lines}`;
  },
  {
    name: 'get_exceptions',
    description: 'Consulta las excepciones (vacaciones, ausencias, cambios de jornada, coberturas extraordinarias) de un agente en un rango de fechas.',
    schema: z.object({
      profile_id: z.string().describe('UUID del perfil del agente'),
      date_from: z.string().describe('Fecha inicio (YYYY-MM-DD)'),
      date_to: z.string().describe('Fecha fin (YYYY-MM-DD)'),
    }),
  }
);

/**
 * Tool to query overtime entries
 */
export const getOvertime = tool(
  async ({ profile_id, date_from, date_to }) => {
    const { data, error } = await supabaseAdmin
      .from('overtime')
      .select('date, hours, start_time, end_time, notes, clients(name)')
      .eq('profile_id', profile_id)
      .gte('date', date_from)
      .lte('date', date_to)
      .order('date');

    if (error) return `Error: ${error.message}`;
    if (!data || data.length === 0) return 'No hay horas extra para ese período.';

    const totalHours = data.reduce((sum, e) => sum + e.hours, 0);
    const lines = data.map(e => {
      const time = e.start_time && e.end_time ? ` (${e.start_time}-${e.end_time})` : '';
      const client = (e as Record<string, unknown>).clients
        ? ` - ${((e as Record<string, unknown>).clients as Record<string, string>).name}`
        : '';
      return `${e.date}: ${e.hours}h${time}${client}${e.notes ? ` - ${e.notes}` : ''}`;
    }).join('\n');

    return `Horas extra del ${date_from} al ${date_to}:\n${lines}\n\nTotal: ${totalHours}h`;
  },
  {
    name: 'get_overtime',
    description: 'Consulta las horas extra de un agente en un rango de fechas.',
    schema: z.object({
      profile_id: z.string().describe('UUID del perfil del agente'),
      date_from: z.string().describe('Fecha inicio (YYYY-MM-DD)'),
      date_to: z.string().describe('Fecha fin (YYYY-MM-DD)'),
    }),
  }
);

/**
 * Tool to get settlement rules
 */
export const getSettlementRules = tool(
  async () => {
    const { data, error } = await supabaseAdmin
      .from('settlement_rules')
      .select('name, description, rule_text, is_active')
      .order('created_at');

    if (error) return `Error: ${error.message}`;
    if (!data || data.length === 0) return 'No hay reglas de liquidación configuradas.';

    const lines = data.map(r =>
      `${r.is_active ? '✅' : '❌'} ${r.name}: ${r.rule_text}${r.description ? ` (${r.description})` : ''}`
    ).join('\n');

    return `Reglas de liquidación:\n${lines}`;
  },
  {
    name: 'get_settlement_rules',
    description: 'Consulta las reglas de liquidación configuradas en el sistema.',
    schema: z.object({}),
  }
);

/**
 * Tool to get normalization rules
 */
export const getNormalizationRules = tool(
  async () => {
    const { data, error } = await supabaseAdmin
      .from('normalization_rules')
      .select('name, description, rule_text, is_active')
      .order('created_at');

    if (error) return `Error: ${error.message}`;
    if (!data || data.length === 0) return 'No hay reglas de normalización configuradas.';

    const lines = data.map(r =>
      `${r.is_active ? '✅' : '❌'} ${r.name}: ${r.rule_text}${r.description ? ` (${r.description})` : ''}`
    ).join('\n');

    return `Reglas de normalización:\n${lines}`;
  },
  {
    name: 'get_normalization_rules',
    description: 'Consulta las reglas de normalización de horarios configuradas en el sistema.',
    schema: z.object({}),
  }
);

/**
 * Tool to get agent rates
 */
export const getAgentRates = tool(
  async ({ profile_id }) => {
    const { data, error } = await supabaseAdmin
      .from('agent_rates')
      .select('amount_per_hour, effective_from')
      .eq('profile_id', profile_id)
      .order('effective_from', { ascending: false });

    if (error) return `Error: ${error.message}`;
    if (!data || data.length === 0) return 'No hay tarifas configuradas para este agente.';

    // Also fetch global factors
    const { data: factors } = await supabaseAdmin
      .from('rate_factors')
      .select('factor_key, factor_value, description');

    const lines = data.map((r: { amount_per_hour: number; effective_from: string }) =>
      `Base: $${r.amount_per_hour}/h (desde ${r.effective_from})`
    ).join('\n');

    const factorLines = (factors || []).map((f: { factor_key: string; factor_value: number; description: string }) =>
      `  ${f.factor_key}: ×${f.factor_value} (${f.description})`
    ).join('\n');

    return `Tarifas base del agente:\n${lines}\n\nFactores globales:\n${factorLines}`;
  },
  {
    name: 'get_agent_rates',
    description: 'Consulta las tarifas base configuradas de un agente y los factores globales de multiplicación.',
    schema: z.object({
      profile_id: z.string().describe('UUID del perfil del agente'),
    }),
  }
);

/**
 * Tool to get pre-settlement detail
 */
export const getPreSettlementDetail = tool(
  async ({ pre_settlement_id }) => {
    const { data: ps } = await supabaseAdmin
      .from('pre_settlements')
      .select('*, profiles(first_name, last_name)')
      .eq('id', pre_settlement_id)
      .single();

    if (!ps) return 'Preliquidación no encontrada.';

    const { data: daily } = await supabaseAdmin
      .from('pre_settlement_daily')
      .select('date, band, tier, hours, rate_per_hour, amount, is_projected, source')
      .eq('pre_settlement_id', pre_settlement_id)
      .order('date');

    const { data: items } = await supabaseAdmin
      .from('pre_settlement_items')
      .select('concept, description, amount, is_percentage')
      .eq('pre_settlement_id', pre_settlement_id);

    const typeLabels: Record<string, string> = {
      day_ld: 'Diurna LD',
      night_ld: 'Nocturna LD',
      day_hd: 'Diurna HD',
      night_hd: 'Nocturna HD',
    };

    const tierLabels: Record<string, string> = {
      normal: '',
      additional: ' Adicional',
      overtime_50: ' Extra 50%',
      overtime_100: ' Extra 100%',
    };

    const describe = (band: string, tier: string) =>
      `${typeLabels[band] ?? band}${tierLabels[tier] ?? ` ${tier}`}`;

    const profile = (ps as Record<string, unknown>).profiles as Record<string, string>;
    let result = `Preliquidación de ${profile.first_name} ${profile.last_name}\nPeríodo: ${ps.period_from} al ${ps.period_to}\nEstado: ${ps.status}\n\n`;

    if (daily && daily.length > 0) {
      result += 'Desglose diario:\n';
      for (const d of daily) {
        result += `  ${d.date} | ${describe(d.band, d.tier)} | ${d.hours}h × $${d.rate_per_hour} = $${d.amount}${d.is_projected ? ' (proyectado)' : ''}\n`;
      }

      // Totals by type
      const byType: Record<string, { hours: number; amount: number }> = {};
      for (const d of daily) {
        const key = describe(d.band, d.tier);
        if (!byType[key]) byType[key] = { hours: 0, amount: 0 };
        byType[key].hours += d.hours;
        byType[key].amount += d.amount;
      }

      result += '\nTotales por tipo:\n';
      for (const [type, totals] of Object.entries(byType)) {
        result += `  ${type}: ${totals.hours}h = $${totals.amount}\n`;
      }
    }

    if (items && items.length > 0) {
      result += '\nÍtems adicionales:\n';
      for (const item of items) {
        result += `  ${item.concept}: $${item.amount}${item.is_percentage ? ' (%)' : ''}${item.description ? ` - ${item.description}` : ''}\n`;
      }
    }

    result += `\nTotal: $${ps.total_amount}`;
    return result;
  },
  {
    name: 'get_pre_settlement_detail',
    description: 'Obtiene el detalle completo de una preliquidación: desglose diario por tipo de hora, ítems adicionales, y totales.',
    schema: z.object({
      pre_settlement_id: z.string().describe('UUID de la preliquidación'),
    }),
  }
);

/**
 * Tool to list agents/profiles
 */
export const listProfiles = tool(
  async () => {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('id, first_name, last_name, employee_id, role, is_active')
      .order('last_name');

    if (error) return `Error: ${error.message}`;
    if (!data || data.length === 0) return 'No hay agentes registrados.';

    const lines = data.map(p =>
      `${p.first_name} ${p.last_name} (${p.employee_id || 'sin legajo'}) - ${p.role} - ${p.is_active ? 'Activo' : 'Inactivo'} [ID: ${p.id}]`
    ).join('\n');

    return `Agentes:\n${lines}`;
  },
  {
    name: 'list_profiles',
    description: 'Lista todos los agentes/perfiles del sistema con su ID, nombre, legajo, rol y estado.',
    schema: z.object({}),
  }
);

export const allTools = [
  getWorkedHours,
  getSchedule,
  getExceptions,
  getOvertime,
  getSettlementRules,
  getNormalizationRules,
  getAgentRates,
  getPreSettlementDetail,
  listProfiles,
];
