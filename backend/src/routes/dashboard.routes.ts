import { Router, Response } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { getDashboardSummary } from '../services/dashboard.service.js';

const router = Router();
router.use(authMiddleware);

router.get('/summary', async (_req, res: Response) => {
  try {
    res.json(await getDashboardSummary());
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
