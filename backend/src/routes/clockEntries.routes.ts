import { Router, Response } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authMiddleware, requireRole, AuthRequest } from '../middleware/auth.js';
import { createClockEntrySchema, updateClockEntrySchema } from '@milchick/shared';

const router = Router();
router.use(authMiddleware);

// List clock entries for a profile (filter by date range)
router.get('/profile/:profileId', async (req, res: Response) => {
  let query = supabaseAdmin
    .from('clock_entries')
    .select('*, clients(name)')
    .eq('profile_id', req.params.profileId)
    .order('date', { ascending: false })
    .order('clock_in');

  if (req.query.from) query = query.gte('date', req.query.from as string);
  if (req.query.to) query = query.lte('date', req.query.to as string);

  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// Get clock entries for a specific date (all profiles)
router.get('/date/:date', async (req, res: Response) => {
  const { data, error } = await supabaseAdmin
    .from('clock_entries')
    .select('*, profiles(first_name, last_name), clients(name)')
    .eq('date', req.params.date)
    .order('clock_in');

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// Create clock entry
router.post('/', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const parsed = createClockEntrySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const { data, error } = await supabaseAdmin
    .from('clock_entries')
    .insert(parsed.data)
    .select('*, clients(name)')
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json(data);
});

// Bulk create clock entries
router.post('/bulk', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const entries = req.body.entries;
  if (!Array.isArray(entries)) {
    res.status(400).json({ error: 'entries must be an array' });
    return;
  }

  for (const entry of entries) {
    const parsed = createClockEntrySchema.safeParse(entry);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
  }

  const { data, error } = await supabaseAdmin
    .from('clock_entries')
    .insert(entries)
    .select('*, clients(name)');

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json(data);
});

// Update clock entry
router.patch('/:id', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const parsed = updateClockEntrySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const { data, error } = await supabaseAdmin
    .from('clock_entries')
    .update(parsed.data)
    .eq('id', req.params.id)
    .select('*, clients(name)')
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// Delete clock entry
router.delete('/:id', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const { error } = await supabaseAdmin
    .from('clock_entries')
    .delete()
    .eq('id', req.params.id);

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(204).send();
});

// ─── Self-service: agent marks own clock in/out ───

// Clock in (any authenticated user, own entry only)
router.post('/my/clock-in', async (req: AuthRequest, res: Response) => {
  const today = new Date().toISOString().split('T')[0];
  const now = new Date();
  const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

  const { data, error } = await supabaseAdmin
    .from('clock_entries')
    .insert({
      profile_id: req.userId!,
      date: today,
      clock_in: time,
      notes: req.body.notes || null,
    })
    .select('*, clients(name)')
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json(data);
});

// Clock out (any authenticated user, closes own open entry)
router.post('/my/clock-out', async (req: AuthRequest, res: Response) => {
  const today = new Date().toISOString().split('T')[0];
  const now = new Date();
  const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

  // Find open entry for today
  const { data: openEntry } = await supabaseAdmin
    .from('clock_entries')
    .select('id')
    .eq('profile_id', req.userId!)
    .eq('date', today)
    .is('clock_out', null)
    .order('clock_in', { ascending: false })
    .limit(1)
    .single();

  if (!openEntry) {
    res.status(400).json({ error: 'No hay marcación de ingreso abierta para hoy' });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('clock_entries')
    .update({ clock_out: time })
    .eq('id', openEntry.id)
    .select('*, clients(name)')
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// Get my entries for today
router.get('/my/today', async (req: AuthRequest, res: Response) => {
  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await supabaseAdmin
    .from('clock_entries')
    .select('*, clients(name)')
    .eq('profile_id', req.userId!)
    .eq('date', today)
    .order('clock_in');

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

export default router;
