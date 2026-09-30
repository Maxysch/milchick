import { Router, Response } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { afterChange } from './_util.js';
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

  // Los multiplicadores cambian el valor de todas las horas
  await afterChange({});
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

  // Lo que no viene, no se toca
  const payload = Object.fromEntries(
    Object.entries({
      period_start_day: parsed.data.period_start_day,
      additional_threshold_minutes: parsed.data.additional_threshold_minutes,
      late_arrival_margin_minutes: parsed.data.late_arrival_margin_minutes,
      early_departure_margin_minutes: parsed.data.early_departure_margin_minutes,
      missing_clock_blocks: parsed.data.missing_clock_blocks,
      incomplete_clock_blocks: parsed.data.incomplete_clock_blocks,
      new_hire_review_days: parsed.data.new_hire_review_days,
    }).filter(([, v]) => v !== undefined)
  );

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
  // El corte del período, los márgenes y el umbral cambian qué se paga y qué
  // hay que normalizar: todos los borradores se recalculan
  await afterChange({});
  res.json(data);
});

export default router;
