import { Router, Response } from 'express';
import { createItemConceptSchema, mergeItemConceptSchema, updateItemConceptSchema } from '@milchick/shared';
import { authMiddleware, requireRole, AuthRequest } from '../middleware/auth.js';
import { ConceptExistsError, conceptUsage, createConcept, listConcepts, mergeConcept, updateConcept } from '../services/concepts.service.js';
import { sendError } from './_util.js';

/**
 * El catálogo de conceptos de los ítems.
 *
 * Lo edita el administrador en Configuración. Quien liquida puede dar de alta
 * uno en el momento —sólo con el nombre, y queda a revisar— para no frenar la
 * liquidación.
 */
const router = Router();
router.use(authMiddleware);

// Un nombre que ya existe devuelve el concepto, para que la pantalla lo use
const responderError = (res: Response, err: unknown) => {
  if (err instanceof ConceptExistsError) {
    res.status(409).json({ error: err.message, existing: err.existing });
    return;
  }
  sendError(res, err);
};

// Los activos; con ?all=1, también los desactivados y cuántos ítems usa cada uno
router.get('/', requireRole('admin', 'supervisor'), async (req, res: Response) => {
  try {
    const todos = req.query.all === '1';
    const conceptos = await listConcepts({ includeInactive: todos });
    if (!todos) { res.json(conceptos); return; }
    const usos = await conceptUsage();
    res.json(conceptos.map((c) => ({ ...c, uses: usos[c.key] ?? 0 })));
  } catch (err) {
    responderError(res, err);
  }
});

router.post('/', requireRole('admin', 'supervisor'), async (req: AuthRequest, res: Response) => {
  const parsed = createItemConceptSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  try {
    // Un supervisor sólo da de alta al liquidar; el administrador, también desde Configuración
    const alLiquidar = req.body?.from_settlement === true || req.userRole !== 'admin';
    const r = await createConcept(parsed.data, { id: req.userId!, role: req.userRole! }, { fromSettlement: alLiquidar });
    res.status(r.created ? 201 : 200).json(r.concept);
  } catch (err) {
    responderError(res, err);
  }
});

router.patch('/:id', requireRole('admin'), async (req, res: Response) => {
  const parsed = updateItemConceptSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  try {
    res.json(await updateConcept(String(req.params.id), parsed.data));
  } catch (err) {
    responderError(res, err);
  }
});

// Unificar: los ítems del concepto pasan al otro y el concepto desaparece
router.post('/:id/merge', requireRole('admin'), async (req, res: Response) => {
  const parsed = mergeItemConceptSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  try {
    res.json(await mergeConcept(String(req.params.id), parsed.data.into_id));
  } catch (err) {
    responderError(res, err);
  }
});

export default router;
