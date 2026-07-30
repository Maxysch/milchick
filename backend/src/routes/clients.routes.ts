import { Router, Response } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { createClientSchema, updateClientSchema } from '@milchick/shared';

const router = Router();
router.use(authMiddleware);

// List clients
router.get('/', async (_req, res: Response) => {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('*')
    .order('name');

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// Get client by ID
router.get('/:id', async (req, res: Response) => {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error) { res.status(404).json({ error: 'Client not found' }); return; }
  res.json(data);
});

// Create client
router.post('/', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const parsed = createClientSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const { data, error } = await supabaseAdmin
    .from('clients')
    .insert(parsed.data)
    .select()
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json(data);
});

// Update client
router.patch('/:id', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const parsed = updateClientSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const { data, error } = await supabaseAdmin
    .from('clients')
    .update(parsed.data)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// Delete client
router.delete('/:id', requireRole('admin'), async (req, res: Response) => {
  const { error } = await supabaseAdmin
    .from('clients')
    .delete()
    .eq('id', req.params.id);

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(204).send();
});

export default router;
