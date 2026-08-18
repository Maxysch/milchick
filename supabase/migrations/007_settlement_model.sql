-- ─────────────────────────────────────────────────────────────────
-- Migración 007: Modelo de liquidación alineado con el negocio
-- ─────────────────────────────────────────────────────────────────
-- Verificado contra la liquidación de julio 2026 (13 agentes, al centavo).
-- Ver validacion/verificar_liquidacion.py y el test settlement-calc.test.ts.
--
-- Cambios:
--   0. Precondición: agent_rates sin day_of_week (lo hace la 006).
--   1. Factores: nocturno 1,06 -> 1,13. Nuevos: hd, additional, overtime_100.
--      Se van holiday y weekend (el feriado pasa a ser concepto, no tipo de hora).
--   2. pre_settlement_daily: hour_type se parte en band + tier + source.
--   3. Precisión: las tarifas dejan de redondearse a 2 decimales.
--   4. profiles: parámetros de liquidación por agente.
--   5. settlement_settings: el período no es el mes calendario, va del 26 al 25.
--   6. overtime: tramo de recargo (adicional / extra 50% / extra 100%).
--   7. exceptions: licencia paga, distinta de vacaciones y de ausencia.
--
-- TODA la migración es idempotente: se puede volver a correr sobre una base
-- donde ya se aplicó, entera o a medias.
-- ─────────────────────────────────────────────────────────────────

-- ─── 0. Precondición: una sola tarifa base por agente ───────────
-- La 006 elimina agent_rates.day_of_week. Si esta migración corre sobre una base
-- donde la 006 no se aplicó, el modelo queda a medias y el seed de la 008 falla
-- con un NOT NULL violation. Se resuelve acá para no depender del orden.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'agent_rates'
       AND column_name  = 'day_of_week'
  ) THEN
    ALTER TABLE agent_rates DROP CONSTRAINT IF EXISTS agent_rates_profile_day_effective_uq;

    -- Dejar una sola fila por (profile_id, effective_from). Va por EXECUTE para
    -- que no se parsee cuando la columna ya no existe.
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

-- ─── 1. Factores de tarifa ──────────────────────────────────────
UPDATE rate_factors SET factor_value = 1.1300,
       description = 'Recargo nocturno sobre la banda diurna equivalente'
 WHERE factor_key = 'nighttime';

UPDATE rate_factors SET factor_key = 'overtime_50',
       description = 'Horas extra al 50%'
 WHERE factor_key = 'overtime';

DELETE FROM rate_factors WHERE factor_key IN ('holiday', 'weekend');

INSERT INTO rate_factors (factor_key, factor_value, description) VALUES
  ('hd',           1.0125, 'Recargo de la franja HD (vie 20:00 a dom 24:00) sobre la LD'),
  ('additional',   1.2500, 'Horas adicionales fuera del esquema, sin llegar a extra'),
  ('overtime_100', 2.0000, 'Horas extra al 100%')
ON CONFLICT (factor_key) DO UPDATE
  SET factor_value = EXCLUDED.factor_value,
      description  = EXCLUDED.description;

-- ─── 2. Desglose diario: banda + tramo ──────────────────────────
ALTER TABLE pre_settlement_daily
  ADD COLUMN IF NOT EXISTS band   TEXT,
  ADD COLUMN IF NOT EXISTS tier   TEXT,
  -- De dónde salió la línea, para poder auditar la preliquidación
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'schedule';

DO $$
BEGIN
  -- Migrar lo existente sólo si todavía está la columna vieja. El feriado dejaba
  -- de ser banda: se mapea a HD, que es lo más cercano, y de ahora en más se
  -- paga como concepto aparte.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'pre_settlement_daily'
       AND column_name  = 'hour_type'
  ) THEN
    EXECUTE $sql$
      UPDATE pre_settlement_daily SET
        band = CASE
          WHEN hour_type LIKE 'holiday_%' AND hour_type LIKE '%_daytime' THEN 'day_hd'
          WHEN hour_type LIKE 'holiday_%'                                 THEN 'night_hd'
          WHEN hour_type LIKE '%_daytime'                                 THEN 'day_ld'
          ELSE 'night_ld'
        END,
        tier = CASE
          WHEN hour_type LIKE 'overtime_%' THEN 'overtime_50'
          ELSE 'normal'
        END
       WHERE band IS NULL OR tier IS NULL
    $sql$;

    ALTER TABLE pre_settlement_daily DROP COLUMN hour_type;
  END IF;
END $$;

-- Filas que quedaron sin clasificar (no había hour_type que mapear)
UPDATE pre_settlement_daily SET band = 'day_ld'  WHERE band IS NULL;
UPDATE pre_settlement_daily SET tier = 'normal'  WHERE tier IS NULL;

ALTER TABLE pre_settlement_daily
  ALTER COLUMN band SET NOT NULL,
  ALTER COLUMN tier SET NOT NULL;

ALTER TABLE pre_settlement_daily DROP CONSTRAINT IF EXISTS psd_band_check;
ALTER TABLE pre_settlement_daily DROP CONSTRAINT IF EXISTS psd_tier_check;
ALTER TABLE pre_settlement_daily DROP CONSTRAINT IF EXISTS psd_source_check;

ALTER TABLE pre_settlement_daily
  ADD CONSTRAINT psd_band_check   CHECK (band IN ('day_ld', 'night_ld', 'day_hd', 'night_hd')),
  ADD CONSTRAINT psd_tier_check   CHECK (tier IN ('normal', 'additional', 'overtime_50', 'overtime_100')),
  ADD CONSTRAINT psd_source_check CHECK (source IN ('schedule', 'exception', 'overtime', 'manual'));

-- ─── 3. Precisión ───────────────────────────────────────────────
-- Con NUMERIC(10,2) la tarifa 4040,16029 se guardaba como 4040,16 y la
-- liquidación se iba unos centavos. El redondeo va sólo en el total.
ALTER TABLE pre_settlement_daily
  ALTER COLUMN rate_per_hour TYPE NUMERIC(14, 6),
  ALTER COLUMN amount        TYPE NUMERIC(14, 4),
  ALTER COLUMN hours         TYPE NUMERIC(7, 4);

ALTER TABLE agent_rates
  ALTER COLUMN amount_per_hour TYPE NUMERIC(14, 6);

-- ─── 4. Parámetros de liquidación por agente ────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS hire_date DATE,
  -- Premio a la Excelencia (REG): se paga la suma de los tres componentes
  ADD COLUMN IF NOT EXISTS reg_people_pct        NUMERIC(6, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reg_quantitative_pct  NUMERIC(6, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reg_qualitative_pct   NUMERIC(6, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS super_reg_pct         NUMERIC(6, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS equipment_pct         NUMERIC(6, 4) NOT NULL DEFAULT 0.05,
  -- Meses reconocidos de antigüedad. Se mantiene a mano: no coincide con los
  -- meses transcurridos desde hire_date en las planillas históricas.
  ADD COLUMN IF NOT EXISTS seniority_months      INTEGER       NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS holiday_compensation_factor NUMERIC(6, 4) NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS vacation_plus_factor        NUMERIC(6, 4) NOT NULL DEFAULT 0;

COMMENT ON COLUMN profiles.seniority_months IS
  'Meses reconocidos de antigüedad. Multiplica 0,08333% sobre el subtotal.';

-- ─── 5. Configuración del período ───────────────────────────────
CREATE TABLE IF NOT EXISTS settlement_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton BOOLEAN NOT NULL DEFAULT TRUE,
  -- El período va del día N del mes anterior al día N-1 del mes que se liquida
  period_start_day SMALLINT NOT NULL DEFAULT 26 CHECK (period_start_day BETWEEN 1 AND 28),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT settlement_settings_singleton UNIQUE (singleton)
);

DROP TRIGGER IF EXISTS set_updated_at ON settlement_settings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON settlement_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE settlement_settings ENABLE ROW LEVEL SECURITY;

INSERT INTO settlement_settings (singleton, period_start_day) VALUES (TRUE, 26)
ON CONFLICT (singleton) DO NOTHING;

-- ─── 6. Tramo en las horas extra ────────────────────────────────
-- El negocio distingue tres recargos, no uno solo: adicional (fuera de esquema),
-- extra al 50% y extra al 100%.
ALTER TABLE overtime
  ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'overtime_50';

ALTER TABLE overtime DROP CONSTRAINT IF EXISTS overtime_tier_check;
ALTER TABLE overtime ADD CONSTRAINT overtime_tier_check
  CHECK (tier IN ('additional', 'overtime_50', 'overtime_100'));

COMMENT ON COLUMN overtime.tier IS
  'additional = horas fuera del esquema asignado; overtime_50 / overtime_100 = extras.';

-- ─── 7. Licencia paga ───────────────────────────────────────────
-- El negocio distingue la licencia paga (examen, duelo, enfermedad con
-- certificado) de la ausencia: la licencia se liquida según esquema, pero no
-- suma horas al plus vacacional.
ALTER TABLE exceptions DROP CONSTRAINT IF EXISTS exceptions_exception_type_check;
ALTER TABLE exceptions ADD CONSTRAINT exceptions_exception_type_check
  CHECK (exception_type IN (
    'vacation', 'paid_leave', 'absence', 'schedule_change', 'extraordinary_coverage'
  ));
