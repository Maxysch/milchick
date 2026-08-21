import { Router, Response } from 'express';
import { authMiddleware, requireRole, AuthRequest } from '../middleware/auth.js';
import { addDailyLineSchema, generatePreSettlementSchema, createPreSettlementItemSchema, updatePreSettlementDailySchema, updatePreSettlementItemSchema } from '@milchick/shared';
import {
  fetchPeriodStartDay,
  generatePreSettlement,
  generatePreSettlementsBulk,
  getPeriodSummary,
  getPreSettlementDetail,
  listPeriods,
  settlementPeriod,
  listPreSettlements,
  reviewWarning,
  addDailyLine,
  deleteDailyLine,
  updateDailyLine,
  addItem,
  updateItem,
  deleteItem,
  updatePreSettlementStatus,
  CONCEPT_ORDER,
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

// Generar el período para varios agentes de una. Sin `profile_ids` toma a todos
// los agentes activos.
router.post('/generate-bulk', requireRole('admin', 'supervisor'), async (req: AuthRequest, res: Response) => {
  const { profile_ids, period_from, period_to } = req.body ?? {};
  if (typeof period_from !== 'string' || typeof period_to !== 'string') {
    res.status(400).json({ error: 'Se requieren period_from y period_to' });
    return;
  }
  if (profile_ids !== undefined && !Array.isArray(profile_ids)) {
    res.status(400).json({ error: 'profile_ids debe ser un array' });
    return;
  }

  try {
    const results = await generatePreSettlementsBulk(
      profile_ids ?? null,
      period_from,
      period_to,
      req.userId!
    );
    res.status(201).json(results);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Períodos que ya tienen preliquidaciones
router.get('/periods', async (_req, res: Response) => {
  try {
    res.json(await listPeriods());
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Resumen del período: una fila por agente con el desglose y el neto.
// Con ?format=csv devuelve el archivo listo para abrir en Excel.
router.get('/summary', async (req, res: Response) => {
  const from = String(req.query.from ?? '');
  const to = String(req.query.to ?? '');
  if (!from || !to) {
    res.status(400).json({ error: 'Se requieren from y to' });
    return;
  }

  try {
    const rows = await getPeriodSummary(from, to);

    if (req.query.format !== 'csv') {
      res.json(rows);
      return;
    }

    const headers = [
      'Legajo', 'Agente', 'Estado', 'Horas', 'Honorarios',
      ...CONCEPT_ORDER, 'Otros ítems', 'Neto a cobrar', 'Desvíos pendientes',
    ];
    // Punto y coma + BOM para que Excel en es-AR lo abra en columnas
    const esc = (v: unknown) => {
      const t = String(v ?? '');
      return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const lines = [headers.join(';')];
    for (const r of rows) {
      lines.push([
        r.employee_id, r.name, r.status, r.hours, r.subtotal,
        ...CONCEPT_ORDER.map((c) => r.concepts[c] ?? 0),
        r.manual_items, r.net, r.pending_warnings,
      ].map(esc).join(';'));
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="resumen-${from}_${to}.csv"`);
    res.send('\uFEFF' + lines.join('\n'));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Revisar un desvío: aceptarlo como está o marcarlo corregido
router.patch('/warnings/:warningId', requireRole('admin', 'supervisor'), async (req: AuthRequest, res: Response) => {
  const { status, note } = req.body ?? {};
  if (!['pending', 'accepted', 'corrected'].includes(status)) {
    res.status(400).json({ error: 'status debe ser pending, accepted o corrected' });
    return;
  }

  try {
    const data = await reviewWarning(
      String(req.params.warningId),
      { status, note: note ?? null },
      req.userId!
    );
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Período que corresponde a un mes según el día de corte configurado.
// Va antes de /:id para que no lo capture la ruta con parámetro.
router.get('/period', async (req, res: Response) => {
  const year = Number(req.query.year);
  const month = Number(req.query.month);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    res.status(400).json({ error: 'Se requieren year y month (1-12)' });
    return;
  }

  try {
    // `start_day` permite previsualizar un corte distinto al guardado
    const override = Number(req.query.start_day);
    const startDay =
      Number.isInteger(override) && override >= 1 && override <= 28
        ? override
        : await fetchPeriodStartDay();

    res.json({ ...settlementPeriod(year, month, startDay), period_start_day: startDay });
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
router.patch('/daily/:lineId', requireRole('admin', 'supervisor'), async (req: AuthRequest, res: Response) => {
  const parsed = updatePreSettlementDailySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  try {
    const data = await updateDailyLine(String(req.params.lineId), parsed.data, req.userId!);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Agregar una línea diaria a mano (un día que el motor no generó)
router.post('/:id/daily', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const parsed = addDailyLineSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  try {
    const data = await addDailyLine(String(req.params.id), {
      date: parsed.data.date,
      band: parsed.data.band,
      tier: parsed.data.tier,
      hours: parsed.data.hours,
      client_id: parsed.data.client_id ?? null,
    });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Borrar una línea agregada a mano
router.delete('/daily/:lineId', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  try {
    await deleteDailyLine(String(req.params.lineId));
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
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
      is_percentage: parsed.data.kind === 'percentage',
      percentage_base: parsed.data.kind === 'percentage' ? 'subtotal' : null,
      kind: parsed.data.kind,
      percentage: parsed.data.percentage ?? null,
      quantity: parsed.data.quantity ?? null,
      band: parsed.data.band ?? null,
      tier: parsed.data.tier ?? null,
      factor: parsed.data.factor ?? null,
      unit_minutes: parsed.data.unit_minutes ?? null,
      days: parsed.data.days ?? null,
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
