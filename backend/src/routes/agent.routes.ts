import { Router, Response } from 'express';
import { authMiddleware, requireRole, AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);
router.use(requireRole('admin', 'supervisor'));

const AGENT_URL = process.env.AGENT_SERVICE_URL || 'http://localhost:3002';

// Chat with normalization agent
router.post('/normalization', async (req: AuthRequest, res: Response) => {
  const { message, thread_id } = req.body;
  if (!message) {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  try {
    const response = await fetch(`${AGENT_URL}/chat/normalization`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, thread_id: thread_id || req.userId }),
    });

    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: `Agent service unavailable: ${(err as Error).message}` });
  }
});

// Chat with settlement agent
router.post('/settlement', async (req: AuthRequest, res: Response) => {
  const { message, thread_id } = req.body;
  if (!message) {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  try {
    const response = await fetch(`${AGENT_URL}/chat/settlement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, thread_id: thread_id || req.userId }),
    });

    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: `Agent service unavailable: ${(err as Error).message}` });
  }
});

export default router;
