import { Router, Response } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authMiddleware, requireRole, AuthRequest } from '../middleware/auth.js';
import { upsertPeriodParamsSchema } from '@milchick/shared';

const router = Router();
router.use(authMiddleware);

/**
 * Evaluación mensual de todos los agentes.
 *
 * Devuelve una fila por agente activo aunque todavía no tenga la evaluación del
 * mes cargada: en ese caso viene precargada con los valores por defecto del
 * perfil y `loaded: false`, para que la pantalla muestre qué falta.
 */
router.get('/', async (req, res: Response) => {
  const year = Number(req.query.year);
  const month = Number(req.query.month);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    res.status(400).json({ error: 'Se requieren year y month (1-12)' });
    return;
  }

  const [{ data: profiles, error: profilesError }, { data: params }] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select(
        'id, first_name, last_name, employee_id, reg_people_pct, ' +
          'reg_quantitative_pct, reg_qualitative_pct, super_reg_pct'
      )
      .eq('role', 'agent')
      .eq('is_active', true)
      .order('last_name'),
    supabaseAdmin
      .from('agent_period_params')
      .select('*')
      .eq('year', year)
      .eq('month', month),
  ]);

  if (profilesError) {
    res.status(500).json({ error: profilesError.message });
    return;
  }

  const loadedRows = (params ?? []) as unknown as Record<string, unknown>[];
  const byProfile = new Map(loadedRows.map((p) => [p.profile_id as string, p]));

  res.json(
    ((profiles ?? []) as unknown as Record<string, unknown>[]).map((p) => {
      const loaded = byProfile.get(p.id as string);
      const source = loaded ?? p;
      return {
        profile_id: p.id,
        name: `${p.last_name}, ${p.first_name}`,
        employee_id: p.employee_id,
        loaded: Boolean(loaded),
        reg_people_pct: Number(source.reg_people_pct ?? 0),
        reg_quantitative_pct: Number(source.reg_quantitative_pct ?? 0),
        reg_qualitative_pct: Number(source.reg_qualitative_pct ?? 0),
        super_reg_pct: Number(source.super_reg_pct ?? 0),
        // Sólo vive a nivel período: no se precarga desde el perfil
        monotributo_reimbursement: Number(loaded?.monotributo_reimbursement ?? 0),
        notes: (loaded?.notes as string | null) ?? null,
      };
    })
  );
});

/** Guarda la evaluación del mes para varios agentes de una. */
router.put('/', requireRole('admin', 'supervisor'), async (req: AuthRequest, res: Response) => {
  const parsed = upsertPeriodParamsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { year, month, agents } = parsed.data;

  const { error } = await supabaseAdmin.from('agent_period_params').upsert(
    agents.map((a) => ({
      profile_id: a.profile_id,
      year,
      month,
      reg_people_pct: a.reg_people_pct,
      reg_quantitative_pct: a.reg_quantitative_pct,
      reg_qualitative_pct: a.reg_qualitative_pct,
      super_reg_pct: a.super_reg_pct,
      monotributo_reimbursement: a.monotributo_reimbursement,
      notes: a.notes ?? null,
      created_by: req.userId!,
    })),
    { onConflict: 'profile_id,year,month' }
  );

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ saved: agents.length });
});

export default router;
