-- ─────────────────────────────────────────────────────────────────
-- Migración 013: Horas fuera del esquema sin recargo
-- ─────────────────────────────────────────────────────────────────
-- Faltaba poder cargar horas de un día que el agente no tiene en su esquema
-- —un sábado que cubrió, por ejemplo— a tarifa común. La tabla `overtime` sólo
-- admitía los tres tramos con recargo, así que la única salida era pagarle de
-- más o no pagarle. Las excepciones tampoco servían: todas operan SOBRE las
-- horas del esquema, y si el día no tiene esquema no hay nada sobre qué operar.
--
-- Con el tramo `normal`, la tabla deja de ser "horas extra" y pasa a ser
-- "horas fuera del esquema", que es lo que representa.
--
-- Es idempotente.
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE overtime DROP CONSTRAINT IF EXISTS overtime_tier_check;
ALTER TABLE overtime ADD CONSTRAINT overtime_tier_check
  CHECK (tier IN ('normal', 'additional', 'overtime_50', 'overtime_100'));

COMMENT ON COLUMN overtime.tier IS
  'normal = horas fuera del esquema, a tarifa común · additional = fuera del '
  'esquema con recargo · overtime_50 / overtime_100 = extras.';

COMMENT ON TABLE overtime IS
  'Horas que no salen del esquema: coberturas, adicionales y extras.';
