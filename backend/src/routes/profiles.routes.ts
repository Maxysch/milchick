import { Router, Response } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authMiddleware, requireRole, AuthRequest } from '../middleware/auth.js';
import { afterChange } from './_util.js';
import { accessLinkSchema, changeProfileEmailSchema, createProfileSchema, updateProfileSchema } from '@milchick/shared';
import { changeEmail, createAccessLink } from '../services/access.service.js';
import { sendError } from './_util.js';

const router = Router();
router.use(authMiddleware);

// List profiles
router.get('/', async (_req, res: Response) => {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .order('last_name');

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// Get profile by ID
router.get('/:id', async (req, res: Response) => {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error) { res.status(404).json({ error: 'Profile not found' }); return; }
  res.json(data);
});

// Create profile (admin/supervisor only)
router.post('/', requireRole('admin', 'supervisor'), async (req: AuthRequest, res: Response) => {
  const parsed = createProfileSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const { email, password, ...profileData } = parsed.data;

  // Create auth user
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { first_name: profileData.first_name, last_name: profileData.last_name },
  });

  if (authError) { res.status(400).json({ error: authError.message }); return; }

  // Update profile with additional data
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update({ ...profileData, employee_id: profileData.employee_id ?? null })
    .eq('id', authData.user.id)
    .select()
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json(data);
});

// Update profile
router.patch('/:id', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update(parsed.data)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  await afterChange({ profileId: String(req.params.id) });
  res.json(data);
});

// Cambiar el email con el que entra (sólo el administrador: es la llave de la cuenta)
router.patch('/:id/email', requireRole('admin'), async (req, res: Response) => {
  const parsed = changeProfileEmailSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Ingresá un email válido' }); return; }
  try {
    res.json(await changeEmail(String(req.params.id), parsed.data.email));
  } catch (err) {
    sendError(res, err);
  }
});

// El enlace para que el agente cree su contraseña (sólo el administrador). No se
// manda por correo: se devuelve para pasárselo por otro medio.
router.post('/:id/access-link', requireRole('admin'), async (req, res: Response) => {
  const parsed = accessLinkSchema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: 'redirect_to no es una URL' }); return; }
  try {
    res.json(await createAccessLink(String(req.params.id), parsed.data.redirect_to));
  } catch (err) {
    sendError(res, err);
  }
});

// Toggle active status
router.patch('/:id/toggle-active', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('is_active')
    .eq('id', req.params.id)
    .single();

  if (!profile) { res.status(404).json({ error: 'Profile not found' }); return; }

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update({ is_active: !profile.is_active })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

export default router;
