import { Router, Response } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { createHolidaySchema } from '@milchick/shared';

const router = Router();
router.use(authMiddleware);

// List holidays (filter by year)
router.get('/', async (req, res: Response) => {
  let query = supabaseAdmin
    .from('holidays')
    .select('*')
    .order('date');

  if (req.query.year) query = query.eq('year', parseInt(req.query.year as string));

  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// Create holiday
router.post('/', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const parsed = createHolidaySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const { data, error } = await supabaseAdmin
    .from('holidays')
    .insert(parsed.data)
    .select()
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json(data);
});

// Update holiday
router.patch('/:id', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const { data, error } = await supabaseAdmin
    .from('holidays')
    .update(req.body)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// Delete holiday
router.delete('/:id', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const { error } = await supabaseAdmin
    .from('holidays')
    .delete()
    .eq('id', req.params.id);

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(204).send();
});

export default router;
