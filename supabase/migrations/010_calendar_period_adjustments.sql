-- ─────────────────────────────────────────────────────────────────
-- Migración 010: Mes calendario + conciliación del período anterior
-- ─────────────────────────────────────────────────────────────────
-- El período vuelve a ser el mes calendario, como en la planilla. Como la
-- liquidación se prepara antes de que termine el mes, los últimos días se pagan
-- proyectados desde el esquema. Si después la realidad fue otra (una ausencia,
-- una licencia, horas extra cargadas tarde), la diferencia se concilia en el
-- período siguiente en vez de corregirse a mano.
--
-- Es idempotente.
-- ─────────────────────────────────────────────────────────────────

-- ─── 1. Nuevo origen de línea: ajuste del período anterior ──────
ALTER TABLE pre_settlement_daily DROP CONSTRAINT IF EXISTS psd_source_check;
ALTER TABLE pre_settlement_daily ADD CONSTRAINT psd_source_check
  CHECK (source IN ('schedule', 'exception', 'overtime', 'manual', 'adjustment'));

COMMENT ON COLUMN pre_settlement_daily.source IS
  'schedule/exception/overtime = generado · manual = editado por quien liquida · '
  'adjustment = diferencia contra lo proyectado en el período anterior. '
  'Las líneas de ajuste llevan la fecha original, que cae fuera del período.';

-- Las horas de ajuste pueden ser negativas (se pagó de más y se descuenta)
ALTER TABLE pre_settlement_daily ALTER COLUMN hours TYPE NUMERIC(7, 4);

-- ─── 2. El período pasa a ser el mes calendario ─────────────────
UPDATE settlement_settings SET period_start_day = 1;

COMMENT ON COLUMN settlement_settings.period_start_day IS
  'Día en que arranca el período. 1 = mes calendario (lo que se usa hoy). '
  'Con otro valor arranca ese día del mes anterior y cierra el día previo.';
