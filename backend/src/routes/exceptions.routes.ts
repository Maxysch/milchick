import { Router, Response } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authMiddleware, requireRole, AuthRequest } from '../middleware/auth.js';
import { createExceptionSchema } from '@milchick/shared';

const router = Router();
router.use(authMiddleware);

// List exceptions for a profile (filter by date range and type)
router.get('/profile/:profileId', async (req, res: Response) => {
  let query = supabaseAdmin
    .from('exceptions')
    .select('*, clients(name), creator:created_by(first_name, last_name)')
    .eq('profile_id', req.params.profileId)
    .order('date_from', { ascending: false });

  if (req.query.from) query = query.gte('date_to', req.query.from as string);
  if (req.query.to) query = query.lte('date_from', req.query.to as string);
  if (req.query.type) query = query.eq('exception_type', req.query.type as string);

  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// List all exceptions in a date range
router.get('/range', async (req, res: Response) => {
  const { from, to } = req.query;
  if (!from || !to) {
    res.status(400).json({ error: 'from and to query params are required' });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('exceptions')
    .select('*, profiles!exceptions_profile_id_fkey(first_name, last_name), clients(name)')
    .gte('date_to', from as string)
    .lte('date_from', to as string)
    .order('date_from');

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// Create exception
router.post('/', requireRole('admin', 'supervisor'), async (req: AuthRequest, res: Response) => {
  const parsed = createExceptionSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const { data, error } = await supabaseAdmin
    .from('exceptions')
    .insert({ ...parsed.data, created_by: req.userId! })
    .select('*, clients(name)')
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json(data);
});

// Update exception
router.patch('/:id', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const { data, error } = await supabaseAdmin
    .from('exceptions')
    .update(req.body)
    .eq('id', req.params.id)
    .select('*, clients(name)')
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// Delete exception
router.delete('/:id', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const { error } = await supabaseAdmin
    .from('exceptions')
    .delete()
    .eq('id', req.params.id);

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(204).send();
});

export default router;
