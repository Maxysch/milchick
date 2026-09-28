// Punto de entrada de la API en Vercel.
//
// Vercel no mantiene un proceso escuchando un puerto: invoca este archivo una
// vez por request. Por eso acá no hay `listen` — la app de Express ya es, ella
// misma, un handler (req, res), y vive en `backend/src/app.ts`.
//
// El nombre `[...path]` hace que la función atienda todo lo que cuelga de
// `/api`, y que la ruta original llegue entera a Express, que tiene sus
// routers montados en `/api/...`.
import type { IncomingMessage, ServerResponse } from 'node:http';

import app from '../backend/src/app.js';

/** Express acepta los objetos crudos de Node; sus tipos piden los suyos. */
const handle = app as unknown as (req: IncomingMessage, res: ServerResponse) => void;

export default function handler(req: IncomingMessage, res: ServerResponse) {
  // Red de seguridad. Si la ruta llegara sin el prefijo `/api` —una
  // reescritura mal puesta, un cambio de convención de Vercel— Express no
  // encontraría ningún router y todo respondería 404 sin decir por qué.
  if (req.url && !req.url.startsWith('/api')) {
    req.url = `/api${req.url.startsWith('/') ? '' : '/'}${req.url}`;
  }

  handle(req, res);
}
