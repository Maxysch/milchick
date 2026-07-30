import { Router, Response } from 'express';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import {
  normalizeEntries,
  normalizeAndPersist,
  getNormalizedEntries,
  updateNormalizedEntry,
} from '../services/normalizer.service.js';

const router = Router();
router.use(authMiddleware);

// Preview normalization (without persisting)
router.get('/preview/:profileId', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const from = String(req.query.from || '');
  const to = String(req.query.to || '');
  const profileId = String(req.params.profileId);
  if (!from || !to) {
    res.status(400).json({ error: 'from and to query params are required' });
    return;
  }

  try {
    const results = await normalizeEntries(profileId, from, to);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Run normalization and persist results
router.post('/run/:profileId', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const { from, to } = req.body;
  const profileId = String(req.params.profileId);
  if (!from || !to) {
    res.status(400).json({ error: 'from and to are required in body' });
    return;
  }

  try {
    const results = await normalizeAndPersist(profileId, String(from), String(to));
    res.json({ normalized: results.length, results });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Get persisted normalized entries
router.get('/:profileId', async (req, res: Response) => {
  const from = String(req.query.from || '');
  const to = String(req.query.to || '');
  const profileId = String(req.params.profileId);
  if (!from || !to) {
    res.status(400).json({ error: 'from and to query params are required' });
    return;
  }

  try {
    const data = await getNormalizedEntries(profileId, from, to);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Update a persisted normalized entry
router.patch('/entry/:entryId', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const entryId = String(req.params.entryId);
  const { normalized_in, normalized_out } = req.body;

  if (!normalized_in && !normalized_out) {
    res.status(400).json({ error: 'At least normalized_in or normalized_out is required' });
    return;
  }

  try {
    const data = await updateNormalizedEntry(entryId, { normalized_in, normalized_out });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
