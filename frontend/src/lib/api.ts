import { supabase } from './supabase';

/**
 * Raíz de la API.
 *
 * Sin `VITE_API_URL` las llamadas salen a `/api` relativo: es lo que hace
 * falta en desarrollo, donde el proxy de Vite las manda al backend, y también
 * si algún día front y back terminan en el mismo dominio.
 *
 * Con el backend en otro dominio —Render, por ejemplo— la variable lleva su
 * raíz, sin `/api`: `https://milchick-api.onrender.com`.
 */
const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '') + '/api';

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return {};
  return { Authorization: `Bearer ${session.access_token}` };
}

/**
 * Error de la API con lo necesario para entender qué pasó sin abrir las
 * DevTools: el código HTTP y, cuando el backend lo manda, el detalle.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: string,
    readonly code?: string | null
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(await getAuthHeaders()),
  };

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return undefined as T;

  // Se lee como texto y después se parsea: si la API no está donde creemos,
  // lo que vuelve es el HTML de la app y un `res.json()` pelado explota con
  // un error de sintaxis que no dice nada del problema real.
  const crudo = await res.text();
  let data: Record<string, unknown> | null = null;
  try {
    data = crudo ? (JSON.parse(crudo) as Record<string, unknown>) : null;
  } catch {
    throw new ApiError(
      `El servidor respondió algo que no es JSON (HTTP ${res.status})`,
      res.status,
      crudo.slice(0, 200)
    );
  }

  if (!res.ok) {
    const mensaje = typeof data?.error === 'string' ? data.error : 'La solicitud falló';
    throw new ApiError(
      mensaje,
      res.status,
      typeof data?.detail === 'string' ? data.detail : undefined,
      typeof data?.code === 'string' ? data.code : null
    );
  }

  return data as T;
}

/**
 * Descarga un archivo del backend. No se puede usar un <a href> pelado porque
 * el endpoint pide el header de autorización.
 */
async function download(path: string, fallbackName: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, { headers: await getAuthHeaders() });

  if (!res.ok) {
    let message = 'No se pudo descargar el archivo';
    try {
      message = (await res.json()).error ?? message;
    } catch {
      // el backend puede no responder JSON en un error de red
    }
    throw new Error(message);
  }

  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^"]+)"?/.exec(disposition);

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = match?.[1] ?? fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  download,
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};
