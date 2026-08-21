-- ─────────────────────────────────────────────────────────────────
-- Migración 017: Los ítems saben cómo se calculan
-- ─────────────────────────────────────────────────────────────────
-- Hasta ahora un ítem guardaba sólo un importe. Eso trae dos problemas:
--
--   1. No se puede cargar una compensación por tiempo. Varios conceptos de la
--      planilla son "cantidad × valor hora × factor" — la compensación por
--      feriado, el plus vacacional, los 45 minutos diarios de Paola — y había
--      que resolverlos calculando el importe a mano afuera.
--
--   2. Los conceptos que son porcentaje del subtotal quedaban congelados. Si
--      alguien corregía las horas de un día, el REG seguía calculado sobre el
--      subtotal viejo y nadie se enteraba. En un agente con 23% de conceptos
--      porcentuales, corregir una hora dejaba ~$950 de concepto obsoleto.
--
-- Ahora cada ítem declara su forma de cálculo y el importe se recompone.
--
-- Es idempotente.
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE pre_settlement_items
  -- fixed      = importe cargado a mano
  -- percentage = porcentaje del subtotal de horas
  -- hourly     = cantidad de horas × valor hora (banda × tramo) × factor
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS percentage NUMERIC(8, 6),
  ADD COLUMN IF NOT EXISTS quantity   NUMERIC(10, 4),
  ADD COLUMN IF NOT EXISTS band TEXT,
  ADD COLUMN IF NOT EXISTS tier TEXT,
  ADD COLUMN IF NOT EXISTS factor NUMERIC(8, 4),
  -- Rastro de cómo se llegó a `quantity`: "45 min × 21 días" se entiende, "15,75 h" no
  ADD COLUMN IF NOT EXISTS unit_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS days INTEGER;

-- Lo que ya estaba marcado como porcentaje pasa al tipo nuevo. El resto queda
-- en `fixed`: sus importes ya son correctos y no hay forma de deducir el
-- porcentaje o la cantidad a partir del importe guardado.
UPDATE pre_settlement_items SET kind = 'percentage'
 WHERE is_percentage = TRUE AND kind = 'fixed';

ALTER TABLE pre_settlement_items DROP CONSTRAINT IF EXISTS psi_kind_check;
ALTER TABLE pre_settlement_items ADD CONSTRAINT psi_kind_check
  CHECK (kind IN ('fixed', 'percentage', 'hourly'));

ALTER TABLE pre_settlement_items DROP CONSTRAINT IF EXISTS psi_band_check;
ALTER TABLE pre_settlement_items ADD CONSTRAINT psi_band_check
  CHECK (band IS NULL OR band IN ('day_ld', 'night_ld', 'day_hd', 'night_hd'));

ALTER TABLE pre_settlement_items DROP CONSTRAINT IF EXISTS psi_tier_check;
ALTER TABLE pre_settlement_items ADD CONSTRAINT psi_tier_check
  CHECK (tier IS NULL OR tier IN ('normal', 'additional', 'overtime_50', 'overtime_100'));

-- Un ítem por horas necesita saber cuántas y a qué valor
ALTER TABLE pre_settlement_items DROP CONSTRAINT IF EXISTS psi_hourly_complete;
ALTER TABLE pre_settlement_items ADD CONSTRAINT psi_hourly_complete
  CHECK (kind <> 'hourly' OR (quantity IS NOT NULL AND band IS NOT NULL AND tier IS NOT NULL));

ALTER TABLE pre_settlement_items DROP CONSTRAINT IF EXISTS psi_percentage_complete;
ALTER TABLE pre_settlement_items ADD CONSTRAINT psi_percentage_complete
  CHECK (kind <> 'percentage' OR percentage IS NOT NULL);

COMMENT ON COLUMN pre_settlement_items.kind IS
  'Cómo se calcula el importe. Los de tipo percentage y hourly se recomponen '
  'cuando cambia el subtotal; los fixed quedan como se cargaron.';

COMMENT ON COLUMN pre_settlement_items.factor IS
  'Multiplicador extra sobre el valor hora. Ej.: 0,5 en la compensación por '
  'feriado no trabajado, 1 en una compensación que se paga completa.';
