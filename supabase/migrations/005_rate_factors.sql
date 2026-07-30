-- ─────────────────────────────────────────────────────────────────
-- Migración 005: Factores globales de tarifa + simplificación agent_rates
-- ─────────────────────────────────────────────────────────────────
-- Antes: agent_rates tenía time_slot (daytime/nighttime) y rate_type (regular/overtime),
-- lo que obligaba a cargar ~16 filas por agente (4 días × 2 franjas × 2 tipos).
-- Ahora: agent_rates tiene solo una tarifa base por agente/día/vigencia.
-- Los multiplicadores (nocturno, extra, feriado) son globales en rate_factors.
-- ─────────────────────────────────────────────────────────────────

-- 1. Crear tabla de factores globales
CREATE TABLE rate_factors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factor_key TEXT UNIQUE NOT NULL,
  factor_value NUMERIC(6, 4) NOT NULL CHECK (factor_value > 0),
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON rate_factors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE rate_factors ENABLE ROW LEVEL SECURITY;

-- Insertar factores por defecto
INSERT INTO rate_factors (factor_key, factor_value, description) VALUES
  ('nighttime', 1.0600, 'Factor nocturno (22:00-06:00)'),
  ('overtime',  1.5000, 'Factor horas extra'),
  ('holiday',   2.0000, 'Factor feriado');

-- 2. Simplificar agent_rates: eliminar time_slot y rate_type
-- Primero eliminar la constraint UNIQUE vieja
ALTER TABLE agent_rates DROP CONSTRAINT IF EXISTS agent_rates_profile_id_day_of_week_time_slot_rate_type_effe_key;

-- Eliminar duplicados: conservar solo las filas con time_slot='daytime' AND rate_type='regular'
-- (esa es la tarifa base diurna regular que servirá como base)
DELETE FROM agent_rates
WHERE NOT (time_slot = 'daytime' AND rate_type = 'regular');

-- Ahora eliminar las columnas
ALTER TABLE agent_rates DROP COLUMN time_slot;
ALTER TABLE agent_rates DROP COLUMN rate_type;

-- Nueva constraint UNIQUE
ALTER TABLE agent_rates ADD CONSTRAINT agent_rates_profile_day_effective_uq
  UNIQUE (profile_id, day_of_week, effective_from);
