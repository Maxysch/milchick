import { describe, expect, it } from 'vitest';
import { AVISO_MIGRACION_020, mensajeDeAcceso } from './access-errors.js';

describe('el mensaje cuando falla el acceso de un agente', () => {
  it('un 500 con "{}" —el usuario sembrado que GoTrue no puede leer— manda a la migración 020', () => {
    expect(mensajeDeAcceso({ message: '{}', status: 500 })).toBe(AVISO_MIGRACION_020);
    expect(AVISO_MIGRACION_020).toContain('020_reparar_usuarios_de_acceso');
  });

  it('un usuario que Supabase no encuentra también lo explica', () => {
    const m = mensajeDeAcceso({ message: 'User with this email not found', status: 404, code: 'user_not_found' });
    expect(m).toContain('020_reparar_usuarios_de_acceso');
  });

  it('un error con mensaje propio lo conserva', () => {
    expect(mensajeDeAcceso({ message: 'A user with this email address has already been registered', status: 422 }))
      .toBe('A user with this email address has already been registered');
  });

  it('un mensaje vacío no se muestra tal cual', () => {
    expect(mensajeDeAcceso({ message: '{}', status: 429, code: 'over_request_rate_limit' })).toBe('Supabase respondió con un error (429): over_request_rate_limit.');
    expect(mensajeDeAcceso({})).toBe('Supabase respondió con un error.');
  });
});
