import { Router, Response } from 'express';
import { authMiddleware, requireRole, AuthRequest } from '../middleware/auth.js';
import { resolveDaySchema, resolveManySchema } from '@milchick/shared';
import { getQueue, listCorrections, resolveDay, resolveMany, undoCorrection } from '../services/normalization.service.js';
import { sendError } from './_util.js';

const router = Router();
router.use(authMiddleware);
router.use(requireRole('admin', 'supervisor'));

const periodo = (q: Record<string, unknown>) => {
  const from = String(q.from ?? '');
  const to = String(q.to ?? '');
  return /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) ? { from, to } : null;
};

// Los días a normalizar del período
router.get('/queue', async (req, res: Response) => {
  const p = periodo(req.query as Record<string, unknown>);
  if (!p) { res.status(400).json({ error: 'Se requieren from y to (YYYY-MM-DD)' }); return; }
  try {
    res.json(await getQueue(p.from, p.to));
  } catch (err) {
    sendError(res, err);
  }
});

// Resolver un día
router.post('/resolve', async (req: AuthRequest, res: Response) => {
  const parsed = resolveDaySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  try {
    await resolveDay(parsed.data, req.userId!);
    res.status(204).send();
  } catch (err) {
    sendError(res, err);
  }
});

// Resolver varios: "aceptar las sugeridas". Viene la lista exacta que se confirmó.
router.post('/resolve-bulk', async (req: AuthRequest, res: Response) => {
  const parsed = resolveManySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  try {
    res.json(await resolveMany(parsed.data.items, req.userId!));
  } catch (err) {
    sendError(res, err);
  }
});

// Correcciones aplicadas en el período
router.get('/corrections', async (req, res: Response) => {
  const p = periodo(req.query as Record<string, unknown>);
  if (!p) { res.status(400).json({ error: 'Se requieren from y to (YYYY-MM-DD)' }); return; }
  try {
    res.json(await listCorrections(p.from, p.to, req.query.profile_id ? String(req.query.profile_id) : undefined));
  } catch (err) {
    sendError(res, err);
  }
});

// Deshacer una corrección: el día vuelve a calcularse solo
router.delete('/corrections/:id', async (req, res: Response) => {
  try {
    await undoCorrection(String(req.params.id));
    res.status(204).send();
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
