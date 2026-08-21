import { Router, Response } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { updateRateFactorsSchema, updateSettlementSettingsSchema } from '@milchick/shared';

const router = Router();
router.use(authMiddleware);

/**
 * Configuración global de liquidación: los multiplicadores de banda y tramo, y
 * el día en que corta el período. Hasta ahora sólo se podían tocar por SQL.
 */
router.get('/', async (_req, res: Response) => {
  const [{ data: factors, error: factorsError }, { data: settings }] = await Promise.all([
    supabaseAdmin.from('rate_factors').select('*').order('factor_key'),
    supabaseAdmin.from('settlement_settings').select('*').limit(1).maybeSingle(),
  ]);

  if (factorsError) {
    res.status(500).json({ error: factorsError.message });
    return;
  }

  res.json({
    rate_factors: factors ?? [],
    settlement_settings: settings ?? { period_start_day: 26 },
  });
});

router.put('/rate-factors', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const parsed = updateRateFactorsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  for (const factor of parsed.data.factors) {
    const { error } = await supabaseAdmin
      .from('rate_factors')
      .update({ factor_value: factor.factor_value })
      .eq('factor_key', factor.factor_key);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
  }

  const { data } = await supabaseAdmin.from('rate_factors').select('*').order('factor_key');
  res.json(data);
});

router.put('/period', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const parsed = updateSettlementSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { data: existing } = await supabaseAdmin
    .from('settlement_settings')
    .select('id')
    .limit(1)
    .maybeSingle();

  const payload = {
    period_start_day: parsed.data.period_start_day,
    ...(parsed.data.additional_threshold_minutes !== undefined
      ? { additional_threshold_minutes: parsed.data.additional_threshold_minutes }
      : {}),
  };

  const { data, error } = existing
    ? await supabaseAdmin
        .from('settlement_settings')
        .update(payload)
        .eq('id', existing.id)
        .select()
        .single()
    : await supabaseAdmin.from('settlement_settings').insert(payload).select().single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data);
});

export default router;
