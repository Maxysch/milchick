// Punto de entrada de la API en Vercel.
//
// Vercel no mantiene un proceso escuchando un puerto: invoca este archivo una
// vez por request. Por eso acá no hay `listen` — la app de Express ya es, ella
// misma, un handler (req, res), y vive en `backend/src/app.ts`.
//
// El ruteo no se delega a la convención de archivos de Vercel. Un catch-all
// `api/[...path].ts` matcheaba un solo segmento: `/api/health` llegaba y
// `/api/auth/me` moría en un NOT_FOUND del propio Vercel, antes de tocar
// Express. Ahora `vercel.json` manda todo `/api/*` acá y adjunta la ruta
// original en `__ruta`, que es lo que este archivo le devuelve a Express.
import type { IncomingMessage, ServerResponse } from 'node:http';

import app from '../backend/src/app.js';

/** Express acepta los objetos crudos de Node; sus tipos piden los suyos. */
const handle = app as unknown as (req: IncomingMessage, res: ServerResponse) => void;

export default function handler(req: IncomingMessage, res: ServerResponse) {
  const entrada = new URL(req.url ?? '/', 'http://interno');
  const original = entrada.searchParams.get('__ruta');

  if (original) {
    // La reescritura deja la ruta real acá. Se la saca de la query para que
    // los handlers no la vean, y se conserva el resto de los parámetros.
    entrada.searchParams.delete('__ruta');
    const query = entrada.searchParams.toString();
    req.url = original + (query ? `?${query}` : '');
  } else if (!entrada.pathname.startsWith('/api')) {
    // Red de seguridad por si la request llegara sin el prefijo
    req.url = `/api${entrada.pathname}${entrada.search}`;
  }

  handle(req, res);
}
