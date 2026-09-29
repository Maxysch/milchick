import { Router, Response } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { loginSchema } from '@milchick/shared';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();

router.post('/login', async (req, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { email, password } = parsed.data;
  const { data, error } = await supabaseAdmin.auth.signInWithPassword({ email, password });

  if (error) {
    res.status(401).json({ error: error.message });
    return;
  }

  res.json({
    token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    user: data.user,
  });
});

router.post('/logout', authMiddleware, async (_req, res: Response) => {
  res.json({ message: 'Logged out' });
});

router.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', req.userId!)
    .single();

  if (error) {
    // No es lo mismo "este usuario no tiene perfil" que "no pude leer la
    // tabla". Los dos volvían como 404 y el frontend los mostraba igual: como
    // si la sesión no valiera. Diagnosticar eso costaba varias vueltas.
    const sinFila = error.code === 'PGRST116';
    res.status(sinFila ? 404 : 500).json({
      error: sinFila
        ? 'No encontramos tu perfil'
        : 'No se pudo leer el perfil',
      detail: error.message,
      code: error.code ?? null,
      user_id: req.userId,
    });
    return;
  }

  res.json(data);
});

export default router;
