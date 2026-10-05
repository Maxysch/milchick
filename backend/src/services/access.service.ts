/**
 * El acceso de un agente: con qué email entra y cómo crea su contraseña.
 *
 * El login mira `auth.users`, no `profiles`: cambiar el email sólo en el perfil
 * dejaba al agente entrando con el viejo. Por eso se cambian los dos juntos. Y
 * como un correo de Supabase puede no llegar —el servicio de correo de fábrica
 * es muy limitado—, además de mandar el mail de recuperación se puede generar el
 * enlace a mano, para pasárselo al agente por WhatsApp.
 */
import { supabaseAdmin } from '../config/supabase.js';
import { BusinessError } from './errors.js';
import { mensajeDeAcceso } from './access-errors.js';

async function perfil(id: string) {
  const { data } = await supabaseAdmin.from('profiles').select('id, email, first_name, last_name').eq('id', id).maybeSingle();
  if (!data) throw new BusinessError('Agente no encontrado', 404);
  return data as { id: string; email: string; first_name: string; last_name: string };
}

/** Cambia el email con el que entra, en el usuario de acceso y en el perfil */
export async function changeEmail(profileId: string, nuevo: string): Promise<{ email: string; anterior: string }> {
  const actual = await perfil(profileId);
  if (actual.email.toLowerCase() === nuevo) return { email: nuevo, anterior: actual.email };

  // El perfil exige emails únicos: se avisa antes de tocar el usuario de acceso
  const { data: otro } = await supabaseAdmin.from('profiles').select('id, first_name, last_name').ilike('email', nuevo).neq('id', profileId).maybeSingle();
  if (otro) {
    throw new BusinessError(`Ese email ya lo usa ${otro.first_name} ${otro.last_name}`);
  }

  // email_confirm: sin esto, Supabase manda un mail de confirmación al nuevo
  // correo y mientras tanto el agente no puede entrar
  const { error } = await supabaseAdmin.auth.admin.updateUserById(profileId, { email: nuevo, email_confirm: true });
  if (error) {
    const repetido = /already|registered|exists|duplicate/i.test(error.message);
    throw new BusinessError(repetido ? 'Ese email ya está registrado en otro usuario' : `No se pudo cambiar el email: ${mensajeDeAcceso(error)}`, repetido ? 409 : 400);
  }

  const { error: errPerfil } = await supabaseAdmin.from('profiles').update({ email: nuevo }).eq('id', profileId);
  if (errPerfil) {
    // Que no queden usuario y perfil con emails distintos
    await supabaseAdmin.auth.admin.updateUserById(profileId, { email: actual.email, email_confirm: true });
    throw new Error(errPerfil.message);
  }
  return { email: nuevo, anterior: actual.email };
}

/**
 * El enlace con el que el agente elige su contraseña. No manda ningún correo:
 * lo devuelve para que quien administra se lo pase. Vale una vez y vence en un
 * rato (lo define Supabase en Authentication → Sessions/Email, una hora por defecto).
 */
export async function createAccessLink(profileId: string, redirectTo?: string): Promise<{ link: string; email: string }> {
  const p = await perfil(profileId);
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: 'recovery',
    email: p.email,
    options: redirectTo ? { redirectTo } : undefined,
  });
  if (error || !data?.properties?.action_link) {
    throw new BusinessError(`No se pudo generar el enlace: ${error ? mensajeDeAcceso(error) : 'respuesta vacía'}`, 400);
  }
  return { link: data.properties.action_link, email: p.email };
}
