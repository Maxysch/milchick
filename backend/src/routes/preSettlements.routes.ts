import { Router, Response } from 'express';
import { authMiddleware, requireRole, AuthRequest } from '../middleware/auth.js';
import {
  addDailyLineSchema,
  createPreSettlementItemSchema,
  generatePreSettlementSchema,
  setDayLinesSchema,
  updatePreSettlementDailySchema,
  updatePreSettlementItemSchema,
} from '@milchick/shared';
import {
  fetchPeriodStartDay,
  generatePreSettlement,
  generatePreSettlementsBulk,
  getPeriodSummary,
  getPreSettlementDetail,
  listPeriods,
  settlementPeriod,
  listPreSettlements,
  recalculatePreSettlement,
  refreshDrafts,
  reviewWarning,
  addDailyLine,
  deleteDailyLine,
  setDayLines,
  updateDailyLine,
  addItem,
  updateItem,
  deleteItem,
  updatePreSettlementStatus,
  CONCEPT_ORDER,
} from '../services/presettlement.service.js';
import { confirmReady, getCloseStatus } from '../services/close.service.js';
import { periodToClose } from '../services/settlement-calc.js';
import { localToday } from '../config/time.js';
import { sendError } from './_util.js';

const router = Router();
router.use(authMiddleware);

const yearMonth = (q: Record<string, unknown>) => {
  const year = Number(q.year);
  const month = Number(q.month);
  return Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12 ? { year, month } : null;
};

// List pre-settlements
router.get('/', async (req, res: Response) => {
  try {
    const profileId = req.query.profile_id ? String(req.query.profile_id) : undefined;
    res.json(await listPreSettlements(profileId));
  } catch (err) {
    sendError(res, err);
  }
});

// Genera o actualiza: si ya hay un borrador para ese período, lo recalcula
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
    res.status(result.created ? 201 : 200).json(result);
  } catch (err) {
    sendError(res, err);
  }
});

// Generar o actualizar el período para varios agentes de una. Sin `profile_ids`
// toma a todos los agentes activos.
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
    res.status(201).json(await generatePreSettlementsBulk(profile_ids ?? null, period_from, period_to, req.userId!));
  } catch (err) {
    sendError(res, err);
  }
});

// Períodos que ya tienen preliquidaciones
router.get('/periods', async (_req, res: Response) => {
  try {
    res.json(await listPeriods());
  } catch (err) {
    sendError(res, err);
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
      ...CONCEPT_ORDER, 'Otros ítems', 'Neto a cobrar', 'Días sin normalizar',
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
        r.manual_items, r.net, r.blocking_pending,
      ].map(esc).join(';'));
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="resumen-${from}_${to}.csv"`);
    res.send('﻿' + lines.join('\n'));
  } catch (err) {
    sendError(res, err);
  }
});

// Cierre del mes: el checklist de todo lo que tiene que estar antes de pagar
router.get('/close', async (req, res: Response) => {
  const ym = yearMonth(req.query as Record<string, unknown>);
  if (!ym) { res.status(400).json({ error: 'Se requieren year y month (1-12)' }); return; }
  try {
    res.json(await getCloseStatus(ym.year, ym.month));
  } catch (err) {
    sendError(res, err);
  }
});

// Confirma de una las que están listas
router.post('/close/confirm-ready', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const ym = yearMonth(req.body ?? {});
  if (!ym) { res.status(400).json({ error: 'Se requieren year y month (1-12)' }); return; }
  try {
    res.json(await confirmReady(ym.year, ym.month));
  } catch (err) {
    sendError(res, err);
  }
});

// Recalcula todos los borradores de un período: trae las marcaciones nuevas
router.post('/refresh', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const { from } = req.body ?? {};
  try {
    res.json({ recalculated: await refreshDrafts({ from: typeof from === 'string' ? from : undefined }) });
  } catch (err) {
    sendError(res, err);
  }
});

// Revisar un aviso informativo. Los que bloquean se resuelven normalizando el día.
router.patch('/warnings/:warningId', requireRole('admin', 'supervisor'), async (req: AuthRequest, res: Response) => {
  const { status, note } = req.body ?? {};
  if (!['pending', 'accepted', 'corrected'].includes(status)) {
    res.status(400).json({ error: 'status debe ser pending, accepted o corrected' });
    return;
  }

  try {
    res.json(await reviewWarning(String(req.params.warningId), { status, note: note ?? null }, req.userId!));
  } catch (err) {
    sendError(res, err);
  }
});

// El mes que toca cerrar: el último período que ya terminó. Es el mes con el
// que abren las pantallas del cierre cuando no se eligió otro.
router.get('/period/to-close', async (_req, res: Response) => {
  try {
    const startDay = await fetchPeriodStartDay();
    const ym = periodToClose(localToday(), startDay);
    res.json({ ...ym, ...settlementPeriod(ym.year, ym.month, startDay), period_start_day: startDay });
  } catch (err) {
    sendError(res, err);
  }
});

// Período que corresponde a un mes según el día de corte configurado.
// Va antes de /:id para que no lo capture la ruta con parámetro.
router.get('/period', async (req, res: Response) => {
  const ym = yearMonth(req.query as Record<string, unknown>);
  if (!ym) { res.status(400).json({ error: 'Se requieren year y month (1-12)' }); return; }

  try {
    // `start_day` permite previsualizar un corte distinto al guardado
    const override = Number(req.query.start_day);
    const startDay =
      Number.isInteger(override) && override >= 1 && override <= 28 ? override : await fetchPeriodStartDay();

    res.json({ ...settlementPeriod(ym.year, ym.month, startDay), period_start_day: startDay });
  } catch (err) {
    sendError(res, err);
  }
});

// Get pre-settlement detail
router.get('/:id', async (req, res: Response) => {
  try {
    res.json(await getPreSettlementDetail(String(req.params.id)));
  } catch (err) {
    sendError(res, err);
  }
});

// Recalcular una preliquidación en el lugar
router.post('/:id/recalculate', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  try {
    await recalculatePreSettlement(String(req.params.id));
    res.json(await getPreSettlementDetail(String(req.params.id)));
  } catch (err) {
    sendError(res, err);
  }
});

// Editar las horas de una línea: deja una corrección del día
router.patch('/daily/:lineId', requireRole('admin', 'supervisor'), async (req: AuthRequest, res: Response) => {
  const parsed = updatePreSettlementDailySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  try {
    await updateDailyLine(String(req.params.lineId), parsed.data, req.userId!);
    res.status(204).send();
  } catch (err) {
    sendError(res, err);
  }
});

// Agregar una línea a un día: deja una corrección del día
router.post('/:id/daily', requireRole('admin', 'supervisor'), async (req: AuthRequest, res: Response) => {
  const parsed = addDailyLineSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  try {
    await addDailyLine(
      String(req.params.id),
      {
        date: parsed.data.date,
        band: parsed.data.band,
        tier: parsed.data.tier,
        hours: parsed.data.hours,
        client_id: parsed.data.client_id ?? null,
      },
      req.userId!
    );
    res.status(201).send();
  } catch (err) {
    sendError(res, err);
  }
});

// Fijar lo que se paga un día entero, banda por banda
router.put('/:id/days/:date', requireRole('admin', 'supervisor'), async (req: AuthRequest, res: Response) => {
  const parsed = setDayLinesSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  try {
    const detail = await getPreSettlementDetail(String(req.params.id));
    await setDayLines(detail.profile_id, String(req.params.date), parsed.data.lines, req.userId!, parsed.data.note ?? null);
    res.status(204).send();
  } catch (err) {
    sendError(res, err);
  }
});

// Sacar una línea de un día: deja una corrección del día
router.delete('/daily/:lineId', requireRole('admin', 'supervisor'), async (req: AuthRequest, res: Response) => {
  try {
    await deleteDailyLine(String(req.params.lineId), req.userId!);
    res.status(204).send();
  } catch (err) {
    sendError(res, err);
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
    sendError(res, err);
  }
});

// Update item
router.patch('/items/:itemId', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const parsed = updatePreSettlementItemSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  try {
    res.json(await updateItem(String(req.params.itemId), parsed.data));
  } catch (err) {
    sendError(res, err);
  }
});

// Delete item
router.delete('/items/:itemId', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  try {
    await deleteItem(String(req.params.itemId));
    res.status(204).send();
  } catch (err) {
    sendError(res, err);
  }
});

// Cambiar el estado. Confirmar exige que esté al día y sin días por normalizar.
router.patch('/:id/status', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  const { status } = req.body ?? {};
  if (!['draft', 'confirmed', 'cancelled'].includes(status)) {
    res.status(400).json({ error: 'Estado inválido' });
    return;
  }

  try {
    res.json(await updatePreSettlementStatus(String(req.params.id), status));
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
