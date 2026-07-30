import { Router, Response } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { createAgentRateSchema } from '@milchick/shared';

const router = Router();
router.use(authMiddleware);

// List rates for a profile
router.get('/profile/:profileId', async (req, res: Response) => {
  const { data, error } = await supabaseAdmin
    .from('agent_rates')
    .select('*')
    .eq('profile_id', req.params.profileId)
    .order('day_of_week')
    .order('time_slot')
    .order('rate_type');

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// Create rate
router.post('/', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const parsed = createAgentRateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const { data, error } = await supabaseAdmin
    .from('agent_rates')
    .insert(parsed.data)
    .select()
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json(data);
});

// Bulk upsert rates for a profile
router.put('/profile/:profileId', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const rates = req.body.rates;
  if (!Array.isArray(rates)) {
    res.status(400).json({ error: 'rates must be an array' });
    return;
  }

  // Validate each rate
  for (const rate of rates) {
    const parsed = createAgentRateSchema.safeParse({ ...rate, profile_id: req.params.profileId });
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
  }

  // Delete existing rates for this profile with the same effective_from
  const effectiveDates = [...new Set(rates.map((r: { effective_from: string }) => r.effective_from))];
  for (const date of effectiveDates) {
    await supabaseAdmin
      .from('agent_rates')
      .delete()
      .eq('profile_id', req.params.profileId)
      .eq('effective_from', date);
  }

  // Insert new rates
  const ratesWithProfile = rates.map((r: Record<string, unknown>) => ({
    ...r,
    profile_id: req.params.profileId,
  }));

  const { data, error } = await supabaseAdmin
    .from('agent_rates')
    .insert(ratesWithProfile)
    .select();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// Update rate
router.patch('/:id', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const { data, error } = await supabaseAdmin
    .from('agent_rates')
    .update(req.body)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// Delete rate
router.delete('/:id', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const { error } = await supabaseAdmin
    .from('agent_rates')
    .delete()
    .eq('id', req.params.id);

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(204).send();
});

export default router;
