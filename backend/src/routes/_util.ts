import type { Response } from 'express';
import { BusinessError } from '../services/presettlement.service.js';

/**
 * Un error de negocio —no se puede confirmar, el día no tiene marcación— se
 * devuelve con su código y su mensaje tal cual, para mostrárselo a quien liquida.
 * El resto es un error del sistema.
 */
export function sendError(res: Response, err: unknown) {
  if (err instanceof BusinessError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: (err as Error).message });
}

import { refreshDrafts } from '../services/presettlement.service.js';

/**
 * Después de guardar un dato de entrada, recalcula los borradores que toca. Si
 * el recálculo falla, lo que se guardó queda guardado: el borrador se pone al
 * día en el próximo recálculo.
 */
export async function afterChange(filter: { profileId?: string; from?: string }) {
  try {
    await refreshDrafts(filter);
  } catch (err) {
    console.error('No se pudieron recalcular los borradores:', (err as Error).message);
  }
}

export const minDate = (...ds: (string | null | undefined)[]) =>
  ds.filter((d): d is string => !!d).sort()[0];
