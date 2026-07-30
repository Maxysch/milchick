import { Router, Response } from 'express';
import { authMiddleware, requireRole, AuthRequest } from '../middleware/auth.js';
import { generatePreSettlementSchema, createPreSettlementItemSchema, updatePreSettlementDailySchema, updatePreSettlementItemSchema } from '@milchick/shared';
import {
  generatePreSettlement,
  getPreSettlementDetail,
  listPreSettlements,
  updateDailyLine,
  addItem,
  updateItem,
  deleteItem,
  updatePreSettlementStatus,
} from '../services/presettlement.service.js';

const router = Router();
router.use(authMiddleware);

// List pre-settlements
router.get('/', async (req, res: Response) => {
  try {
    const profileId = req.query.profile_id ? String(req.query.profile_id) : undefined;
    const data = await listPreSettlements(profileId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Generate new pre-settlement
router.post('/generate', requireRole('admin', 'supervisor'), async (req: AuthRequest, res: Response) => {
  const parsed = generatePreSettlementSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  try {
    const result = await generatePreSettlement(
      parsed.data.profile_id,
      parsed.data.period_from,
      parsed.data.period_to,
      req.userId!
    );
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Get pre-settlement detail
router.get('/:id', async (req, res: Response) => {
  try {
    const data = await getPreSettlementDetail(String(req.params.id));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Update daily line (hours/rate)
router.patch('/daily/:lineId', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const parsed = updatePreSettlementDailySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  try {
    const data = await updateDailyLine(String(req.params.lineId), parsed.data);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Add item to pre-settlement
router.post('/:id/items', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const parsed = createPreSettlementItemSchema.safeParse({
    ...req.body,
    pre_settlement_id: String(req.params.id),
  });
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  try {
    const data = await addItem(String(req.params.id), {
      concept: parsed.data.concept,
      description: parsed.data.description ?? null,
      amount: parsed.data.amount,
      is_percentage: parsed.data.is_percentage ?? false,
      percentage_base: parsed.data.percentage_base ?? null,
    });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Update item
router.patch('/items/:itemId', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const parsed = updatePreSettlementItemSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  try {
    const data = await updateItem(String(req.params.itemId), parsed.data);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Delete item
router.delete('/items/:itemId', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  try {
    await deleteItem(String(req.params.itemId));
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Update status (confirm/cancel)
router.patch('/:id/status', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const { status } = req.body;
  if (!['draft', 'confirmed', 'cancelled'].includes(status)) {
    res.status(400).json({ error: 'Invalid status' });
    return;
  }

  try {
    const data = await updatePreSettlementStatus(String(req.params.id), status);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
