import { Router, Response } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authMiddleware, requireRole, AuthRequest } from '../middleware/auth.js';
import { createNormalizationRuleSchema, createSettlementRuleSchema } from '@milchick/shared';

const router = Router();
router.use(authMiddleware);

// ─── Normalization Rules ───

router.get('/normalization', async (_req, res: Response) => {
  const { data, error } = await supabaseAdmin
    .from('normalization_rules')
    .select('*, creator:created_by(first_name, last_name)')
    .order('created_at', { ascending: false });

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

router.post('/normalization', requireRole('admin', 'supervisor'), async (req: AuthRequest, res: Response) => {
  const parsed = createNormalizationRuleSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const { data, error } = await supabaseAdmin
    .from('normalization_rules')
    .insert({ ...parsed.data, created_by: req.userId! })
    .select()
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json(data);
});

router.patch('/normalization/:id', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const { data, error } = await supabaseAdmin
    .from('normalization_rules')
    .update(req.body)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

router.delete('/normalization/:id', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const { error } = await supabaseAdmin
    .from('normalization_rules')
    .delete()
    .eq('id', req.params.id);

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(204).send();
});

// ─── Settlement Rules ───

router.get('/settlement', async (_req, res: Response) => {
  const { data, error } = await supabaseAdmin
    .from('settlement_rules')
    .select('*, creator:created_by(first_name, last_name)')
    .order('created_at', { ascending: false });

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

router.post('/settlement', requireRole('admin', 'supervisor'), async (req: AuthRequest, res: Response) => {
  const parsed = createSettlementRuleSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const { data, error } = await supabaseAdmin
    .from('settlement_rules')
    .insert({ ...parsed.data, created_by: req.userId! })
    .select()
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json(data);
});

router.patch('/settlement/:id', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const { data, error } = await supabaseAdmin
    .from('settlement_rules')
    .update(req.body)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

router.delete('/settlement/:id', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const { error } = await supabaseAdmin
    .from('settlement_rules')
    .delete()
    .eq('id', req.params.id);

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(204).send();
});

export default router;
