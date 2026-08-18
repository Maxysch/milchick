-- ─────────────────────────────────────────────────────────────────
-- Migración 006: Eliminar day_of_week de agent_rates
-- ─────────────────────────────────────────────────────────────────
-- Ahora la tarifa base es un único valor por agente + fecha de vigencia.
-- Los factores globales (nocturno, HD, adicional, extras) se encargan
-- del resto del cálculo.
--
-- Es idempotente: se puede correr aunque ya se haya aplicado.
-- ─────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'agent_rates'
       AND column_name  = 'day_of_week'
  ) THEN
    -- La constraint vieja incluye la columna que vamos a eliminar
    ALTER TABLE agent_rates DROP CONSTRAINT IF EXISTS agent_rates_profile_day_effective_uq;

    -- Dejar una sola fila por (profile_id, effective_from): la de menor
    -- day_of_week. Es arbitrario pero determinístico, y todas tenían el mismo
    -- importe salvo error de carga.
    -- Va por EXECUTE para que no se parsee cuando la columna ya no existe.
    EXECUTE $sql$
      DELETE FROM agent_rates a
       WHERE EXISTS (
         SELECT 1 FROM agent_rates b
          WHERE b.profile_id     = a.profile_id
            AND b.effective_from = a.effective_from
            AND b.day_of_week    < a.day_of_week
       )
    $sql$;

    ALTER TABLE agent_rates DROP COLUMN day_of_week;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_rates_profile_effective_uq'
  ) THEN
    ALTER TABLE agent_rates
      ADD CONSTRAINT agent_rates_profile_effective_uq UNIQUE (profile_id, effective_from);
  END IF;
END $$;
