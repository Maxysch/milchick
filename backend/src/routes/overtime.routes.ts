import { Router, Response } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authMiddleware, requireRole, AuthRequest } from '../middleware/auth.js';
import { afterChange, minDate } from './_util.js';
import { createOvertimeSchema, updateOvertimeSchema } from '@milchick/shared';

const router = Router();
router.use(authMiddleware);

// List overtime for a profile (filter by date range)
router.get('/profile/:profileId', async (req, res: Response) => {
  let query = supabaseAdmin
    .from('overtime')
    .select('*, clients(name), creator:created_by(first_name, last_name)')
    .eq('profile_id', req.params.profileId)
    .order('date', { ascending: false });

  if (req.query.from) query = query.gte('date', req.query.from as string);
  if (req.query.to) query = query.lte('date', req.query.to as string);

  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// Create overtime entry
router.post('/', requireRole('admin', 'supervisor'), async (req: AuthRequest, res: Response) => {
  const parsed = createOvertimeSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const { data, error } = await supabaseAdmin
    .from('overtime')
    .insert({ ...parsed.data, created_by: req.userId! })
    .select('*, clients(name)')
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  await afterChange({ profileId: data.profile_id, from: data.date });
  res.status(201).json(data);
});

// Update overtime entry
router.patch('/:id', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const parsed = updateOvertimeSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const { data: antes } = await supabaseAdmin.from('overtime').select('profile_id, date').eq('id', req.params.id).single();
  if (!antes) { res.status(404).json({ error: 'Registro no encontrado' }); return; }

  const { data, error } = await supabaseAdmin
    .from('overtime')
    .update(parsed.data)
    .eq('id', req.params.id)
    .select('*, clients(name)')
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  await afterChange({ profileId: antes.profile_id, from: minDate(antes.date, data.date) });
  res.json(data);
});

// Delete overtime entry
router.delete('/:id', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const { data: antes } = await supabaseAdmin.from('overtime').select('profile_id, date').eq('id', req.params.id).single();

  const { error } = await supabaseAdmin
    .from('overtime')
    .delete()
    .eq('id', req.params.id);

  if (error) { res.status(500).json({ error: error.message }); return; }
  if (antes) await afterChange({ profileId: antes.profile_id, from: antes.date });
  res.status(204).send();
});

export default router;
