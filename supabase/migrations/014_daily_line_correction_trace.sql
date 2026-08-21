-- ─────────────────────────────────────────────────────────────────
-- Migración 014: Rastro de las correcciones en el desglose diario
-- ─────────────────────────────────────────────────────────────────
-- Cuando alguien corrige las horas de un día, hasta ahora sólo quedaba el valor
-- nuevo y un `source = 'manual'`. Sin el valor anterior no se puede responder
-- "¿cuánto decía antes y quién lo cambió?", que es justo lo que hay que mirar
-- al revisar una liquidación.
--
-- Es idempotente.
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE pre_settlement_daily
  ADD COLUMN IF NOT EXISTS original_hours NUMERIC(7, 4),
  ADD COLUMN IF NOT EXISTS corrected_by   UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS corrected_at   TIMESTAMPTZ;

COMMENT ON COLUMN pre_settlement_daily.original_hours IS
  'Horas que había calculado el motor. Se graba en la primera corrección y no '
  'se pisa después, así que sobrevive a varias ediciones seguidas.';
