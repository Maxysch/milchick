import { Router, Response } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { createScheduleSchema, updateScheduleSchema } from '@milchick/shared';

const router = Router();
router.use(authMiddleware);

// List schedules for a profile (optionally filter by effective date)
router.get('/profile/:profileId', async (req, res: Response) => {
  let query = supabaseAdmin
    .from('schedules')
    .select('*, clients(name)')
    .eq('profile_id', req.params.profileId)
    .order('day_of_week')
    .order('start_time');

  // Filter active schedules for a given date
  if (req.query.date) {
    const date = req.query.date as string;
    query = query
      .lte('effective_from', date)
      .or(`effective_until.is.null,effective_until.gte.${date}`);
  }

  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// Get schedules for a profile on a specific day of week (active on date)
router.get('/profile/:profileId/day/:dayOfWeek', async (req, res: Response) => {
  const date = req.query.date as string;
  let query = supabaseAdmin
    .from('schedules')
    .select('*, clients(name)')
    .eq('profile_id', req.params.profileId)
    .eq('day_of_week', parseInt(req.params.dayOfWeek));

  if (date) {
    query = query
      .lte('effective_from', date)
      .or(`effective_until.is.null,effective_until.gte.${date}`);
  }

  const { data, error } = await query.order('start_time');
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// Create schedule entry
router.post('/', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const parsed = createScheduleSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const { data, error } = await supabaseAdmin
    .from('schedules')
    .insert(parsed.data)
    .select('*, clients(name)')
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json(data);
});

// Update schedule entry
router.patch('/:id', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const parsed = updateScheduleSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const { data, error } = await supabaseAdmin
    .from('schedules')
    .update(parsed.data)
    .eq('id', req.params.id)
    .select('*, clients(name)')
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// End a schedule (set effective_until)
router.patch('/:id/end', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const { effective_until } = req.body;
  if (!effective_until) {
    res.status(400).json({ error: 'effective_until is required' });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('schedules')
    .update({ effective_until })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// Delete schedule entry
router.delete('/:id', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const { error } = await supabaseAdmin
    .from('schedules')
    .delete()
    .eq('id', req.params.id);

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(204).send();
});

export default router;
