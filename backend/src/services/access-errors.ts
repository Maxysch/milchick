/**
 * Qué decirle a quien administra cuando el servicio de acceso de Supabase falla.
 *
 * Con un error 500 la librería devuelve el mensaje "{}", que no dice nada. El
 * caso más común es un agente de la carga inicial (migración 008): su usuario de
 * acceso quedó con campos en NULL y GoTrue no lo puede leer. La migración 020
 * lo repara.
 */
export interface ErrorDeAcceso {
  message?: string;
  status?: number;
  code?: string;
}

export const AVISO_MIGRACION_020 =
  'Supabase no pudo leer el usuario de acceso de este agente. Si es uno de la carga inicial, ' +
  'falta aplicar la migración 020_reparar_usuarios_de_acceso.sql.';

const sinContenido = (m?: string) => !m || m.trim() === '' || m.trim() === '{}';

/** El mensaje para mostrar: el de Supabase si dice algo, y si no, qué pasó y qué hacer */
export function mensajeDeAcceso(error: ErrorDeAcceso): string {
  const estado = error.status ?? 0;
  if (estado >= 500 || error.code === 'unexpected_failure') return AVISO_MIGRACION_020;
  if (error.code === 'user_not_found' || estado === 404) {
    return 'Supabase no encuentra el usuario de acceso de este agente. ' +
      'Si es uno de la carga inicial, aplicá la migración 020_reparar_usuarios_de_acceso.sql.';
  }
  if (!sinContenido(error.message)) return error.message!;
  return `Supabase respondió con un error${estado ? ` (${estado})` : ''}${error.code ? `: ${error.code}` : ''}.`;
}
