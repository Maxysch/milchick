-- ─────────────────────────────────────────────────────────────────
-- Migración 021: El reintegro de monotributo por defecto, en la ficha
-- ─────────────────────────────────────────────────────────────────
-- El monotributo se carga por mes en Evaluación mensual, pero cambia sólo
-- cuando cambia la categoría del agente. Hasta ahora un mes nuevo arrancaba en
-- cero y había que volver a escribirlo para cada uno.
--
-- Ahora el agente tiene un monotributo por defecto, igual que el REG y el
-- SUPER REG: un mes sin cargar arranca con ese valor. Lo que se liquida sigue
-- saliendo de la Evaluación mensual, y un mes sin evaluación cargada sigue sin
-- poder confirmarse.
--
-- La primera vez que se aplica, el valor por defecto de cada agente se completa
-- con el monotributo del último mes que tenga cargado.
--
-- Es idempotente: si la columna ya existe no toca nada, para no pisar lo que se
-- haya cambiado después en la ficha.
-- ─────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'agent_period_params' AND column_name = 'monotributo_reimbursement'
  ) THEN
    RAISE EXCEPTION 'Falta aplicar la migración 012_monotributo_reimbursement.sql antes de esta';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'monotributo_reimbursement'
  ) THEN
    ALTER TABLE profiles ADD COLUMN monotributo_reimbursement NUMERIC(12, 2) NOT NULL DEFAULT 0;
    ALTER TABLE profiles ADD CONSTRAINT profiles_monotributo_check CHECK (monotributo_reimbursement >= 0);

    -- El del último mes cargado de cada agente
    UPDATE profiles p
       SET monotributo_reimbursement = ultimo.monotributo_reimbursement
      FROM (
        SELECT DISTINCT ON (profile_id) profile_id, monotributo_reimbursement
          FROM agent_period_params
         ORDER BY profile_id, year DESC, month DESC
      ) ultimo
     WHERE ultimo.profile_id = p.id;
  END IF;
END
$$;

COMMENT ON COLUMN profiles.monotributo_reimbursement IS
  'Reintegro de monotributo con el que arranca un mes sin cargar en Evaluación mensual. '
  'Lo que se liquida sale de agent_period_params del mes.';
