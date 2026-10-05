-- ─────────────────────────────────────────────────────────────────
-- Migración 020: Reparar los usuarios de acceso de la carga inicial
-- ─────────────────────────────────────────────────────────────────
-- La 008 creó los usuarios de acceso con un INSERT directo en auth.users. Ese
-- INSERT no completa los campos de tokens (confirmation_token, recovery_token,
-- email_change...), que quedan en NULL. El servicio de login de Supabase
-- (GoTrue) no sabe leer un usuario con esos campos en NULL: al intentar cargarlo
-- falla con "Database error loading user".
--
-- Efecto: de esos usuarios no se puede cambiar el email, ni generar el enlace
-- para crear la contraseña, ni recuperarla. Los agentes dados de alta desde la
-- app no tienen el problema: GoTrue los crea completos.
--
-- Esta migración pone un texto vacío donde hay NULL. Es lo que GoTrue espera y
-- lo que ya trae por defecto cualquier usuario creado por Supabase.
--
-- Es idempotente.
-- ─────────────────────────────────────────────────────────────────

DO $$
DECLARE
  col TEXT;
  reparados INT;
BEGIN
  -- Sólo las que existen en esta versión de Supabase
  FOR col IN
    SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'auth' AND table_name = 'users'
       AND column_name IN (
         'confirmation_token', 'recovery_token', 'email_change_token_new', 'email_change',
         'email_change_token_current', 'phone_change', 'phone_change_token', 'reauthentication_token'
       )
  LOOP
    EXECUTE format('UPDATE auth.users SET %1$I = %2$L WHERE %1$I IS NULL', col, '');
    GET DIAGNOSTICS reparados = ROW_COUNT;
    IF reparados > 0 THEN
      RAISE NOTICE 'auth.users.%: % usuarios reparados', col, reparados;
    END IF;
  END LOOP;
END
$$;
