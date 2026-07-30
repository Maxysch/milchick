-- ─────────────────────────────────────────────────────────────────
-- Migración 006: Eliminar day_of_week de agent_rates
-- ─────────────────────────────────────────────────────────────────
-- Ahora la tarifa base es un único valor por agente + fecha de vigencia.
-- Los factores globales (nocturno, extra, feriado, finde) se encargan
-- del resto del cálculo.
-- ─────────────────────────────────────────────────────────────────

-- Eliminar constraint actual
ALTER TABLE agent_rates DROP CONSTRAINT IF EXISTS agent_rates_profile_day_effective_uq;

-- Eliminar duplicados: para cada (profile_id, effective_from) conservar solo uno
-- (el de menor day_of_week, arbitrario pero determinístico)
DELETE FROM agent_rates a
WHERE EXISTS (
  SELECT 1 FROM agent_rates b
  WHERE b.profile_id = a.profile_id
    AND b.effective_from = a.effective_from
    AND b.day_of_week < a.day_of_week
);

-- Eliminar la columna
ALTER TABLE agent_rates DROP COLUMN day_of_week;

-- Nueva constraint
ALTER TABLE agent_rates ADD CONSTRAINT agent_rates_profile_effective_uq
  UNIQUE (profile_id, effective_from);
