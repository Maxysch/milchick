import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * El portal del agente contra una base en memoria: lo que importa es qué pasa
 * cuando el agente toca el botón varias veces seguidas.
 */
type Fila = Record<string, unknown>;
const estado = vi.hoisted(() => ({
  filas: [] as Record<string, unknown>[],
  ahora: { date: '2026-10-28', time: '08:59', minutes: 8 * 60 + 59 },
}));

vi.mock('../config/time.js', () => ({ localNow: () => estado.ahora, localToday: () => estado.ahora.date }));
vi.mock('../middleware/auth.js', () => ({
  authMiddleware: (req: { userId?: string; userRole?: string }, _res: unknown, next: () => void) => {
    req.userId = 'laura';
    req.userRole = 'agent';
    next();
  },
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../config/supabase.js', () => {
  // Lo justo del cliente de Supabase para estas consultas
  const consulta = () => {
    const filtros: ((f: Record<string, unknown>) => boolean)[] = [];
    let orden: { col: string; asc: boolean } | null = null;
    let limite: number | null = null;
    let op: 'select' | 'insert' | 'update' = 'select';
    let datos: Record<string, unknown> = {};
    const ejecutar = () => {
      if (op === 'insert') {
        const fila = { id: `e${estado.filas.length + 1}`, clock_out: null, ...datos };
        estado.filas.push(fila);
        return [fila];
      }
      let r = estado.filas.filter((f) => filtros.every((fn) => fn(f)));
      if (op === 'update') r.forEach((f) => Object.assign(f, datos));
      if (orden) {
        const { col, asc } = orden;
        r = [...r].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1));
      }
      return limite === null ? r : r.slice(0, limite);
    };
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (d: Record<string, unknown>) => { op = 'insert'; datos = d; return b; },
      update: (d: Record<string, unknown>) => { op = 'update'; datos = d; return b; },
      eq: (c: string, v: unknown) => { filtros.push((f) => f[c] === v); return b; },
      is: (c: string, v: unknown) => { filtros.push((f) => (f[c] ?? null) === v); return b; },
      not: (c: string, _op: string, v: unknown) => { filtros.push((f) => (f[c] ?? null) !== v); return b; },
      order: (c: string, o?: { ascending?: boolean }) => { orden = { col: c, asc: o?.ascending !== false }; return b; },
      limit: (n: number) => { limite = n; return b; },
      single: async () => {
        const r = ejecutar();
        return r.length === 1 ? { data: r[0], error: null } : { data: null, error: { message: 'sin filas' } };
      },
      maybeSingle: async () => ({ data: ejecutar()[0] ?? null, error: null }),
    };
    return b;
  };
  return { supabaseAdmin: { from: consulta } };
});

const { default: router } = await import('./clockEntries.routes.js');

let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/clock-entries', router);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/clock-entries`;
});
afterAll(() => server.close());
beforeEach(() => {
  estado.filas.length = 0;
});

const a = (h: number, m: number) => {
  estado.ahora = { date: '2026-10-28', time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, minutes: h * 60 + m };
};
const tocar = async (accion: 'clock-in' | 'clock-out') => {
  const r = await fetch(`${base}/my/${accion}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  return { status: r.status, fila: (await r.json()) as Fila };
};
const resumen = () => estado.filas.map((f) => `${f.clock_in}–${f.clock_out ?? 'abierta'}`);

describe('marcar desde el portal', () => {
  it('tres toques seguidos en "Marcar ingreso" dejan un solo ingreso', async () => {
    a(8, 59);
    const r = [await tocar('clock-in'), await tocar('clock-in'), await tocar('clock-in')];
    expect(r.map((x) => x.status)).toEqual([201, 200, 200]);
    expect(new Set(r.map((x) => x.fila.id)).size).toBe(1);
    expect(resumen()).toEqual(['08:59–abierta']);
  });

  it('un egreso repetido enseguida devuelve el mismo, sin error y sin mover la hora', async () => {
    a(8, 59); await tocar('clock-in');
    a(12, 2); const primero = await tocar('clock-out');
    a(12, 3); const repetido = await tocar('clock-out');
    expect(primero.status).toBe(200);
    expect(repetido.status).toBe(200);
    expect(repetido.fila.id).toBe(primero.fila.id);
    expect(resumen()).toEqual(['08:59–12:02']);
  });

  it('un egreso sin ingreso abierto, pasado el rato, sigue siendo un error', async () => {
    a(8, 59); await tocar('clock-in');
    a(12, 2); await tocar('clock-out');
    a(12, 10);
    const r = await tocar('clock-out');
    expect(r.status).toBe(400);
  });

  it('el caso de Laura: 3 ingresos, 3 egresos y el ingreso de la tarde', async () => {
    a(8, 59); for (let i = 0; i < 3; i++) await tocar('clock-in');
    a(12, 2); for (let i = 0; i < 3; i++) await tocar('clock-out');
    a(12, 59); await tocar('clock-in');
    expect(resumen()).toEqual(['08:59–12:02', '12:59–abierta']);
  });
});
