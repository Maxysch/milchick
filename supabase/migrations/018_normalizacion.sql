-- ─────────────────────────────────────────────────────────────────
-- Migración 018: Normalización
-- ─────────────────────────────────────────────────────────────────
-- La preliquidación deja de ser una foto. Hasta ahora, una vez generada, lo
-- que se cargaba después —una excepción, una corrección— no entraba salvo
-- regenerándola, y regenerar perdía los ítems y las correcciones hechas en la
-- tabla. Ahora cada decisión de un supervisor es un dato de entrada: vive en su
-- propia tabla, el cálculo la relee cada vez, y la preliquidación se puede
-- recalcular siempre sin perder nada.
--
--   1. Correcciones por día (day_corrections): cómo se normalizó un día que no
--      cerraba contra el plan.
--   2. Excepciones con horario: el cambio de jornada y la cobertura
--      extraordinaria reemplazan al esquema de ese día.
--   3. Horas autorizadas que se pagan aunque la marcación no las respalde.
--   4. Compensación fija por día trabajado.
--   5. Márgenes de la normalización.
--   6. Avisos que bloquean la confirmación, con los datos para resolverlos.
--   7. Orígenes nuevos en el desglose diario.
--
-- Es idempotente.
-- ─────────────────────────────────────────────────────────────────

-- ─── 1. Correcciones por día ───────────────────────────────────────
-- Una por agente y día. `resolution` dice cómo se decidió:
--   plan   → está bien así: se paga lo planificado
--   marks  → se paga lo que se marcó
--   custom → se paga un horario que carga el supervisor
--   none   → ese día no se paga
--   manual → horas cargadas a mano por banda y tramo, desde la tabla
CREATE TABLE IF NOT EXISTS day_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  resolution TEXT NOT NULL,
  -- [{ "start_time": "17:00", "end_time": "23:00" }, ...]
  blocks JSONB,
  -- [{ "band": "day_ld", "tier": "normal", "hours": 4 }, ...] — sólo en manual
  lines JSONB,
  client_id UUID REFERENCES clients(id),
  note TEXT,
  -- Lo que la resolución tocó además de la corrección —una autorización
  -- creada, horas que pasaron a pagarse sin tope— para poder deshacerlo entero
  effects JSONB,
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (profile_id, date)
);

ALTER TABLE day_corrections DROP CONSTRAINT IF EXISTS dc_resolution_check;
ALTER TABLE day_corrections ADD CONSTRAINT dc_resolution_check
  CHECK (resolution IN ('plan', 'marks', 'custom', 'none', 'manual'));

-- Cada resolución trae lo que necesita para calcularse
ALTER TABLE day_corrections DROP CONSTRAINT IF EXISTS dc_payload_check;
ALTER TABLE day_corrections ADD CONSTRAINT dc_payload_check CHECK (
  CASE resolution
    WHEN 'manual' THEN lines IS NOT NULL AND jsonb_typeof(lines) = 'array'
    WHEN 'none'   THEN TRUE
    ELSE blocks IS NOT NULL AND jsonb_typeof(blocks) = 'array'
  END
);

CREATE INDEX IF NOT EXISTS idx_day_corrections_profile_date ON day_corrections(profile_id, date);

-- Si la tabla ya existía de una corrida anterior de esta migración
ALTER TABLE day_corrections ADD COLUMN IF NOT EXISTS effects JSONB;

DROP TRIGGER IF EXISTS set_updated_at ON day_corrections;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON day_corrections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE day_corrections ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE day_corrections IS
  'Cómo se normalizó un día que no cerraba contra el plan. Es un dato de entrada: '
  'el cálculo lo relee en cada recálculo, así que recalcular no pierde decisiones.';

-- ─── 2. Excepciones con horario ────────────────────────────────────
ALTER TABLE exceptions ADD COLUMN IF NOT EXISTS blocks JSONB;

ALTER TABLE exceptions DROP CONSTRAINT IF EXISTS exceptions_blocks_check;
ALTER TABLE exceptions ADD CONSTRAINT exceptions_blocks_check CHECK (
  blocks IS NULL OR (
    jsonb_typeof(blocks) = 'array'
    -- Sólo los tipos que describen un horario pueden traerlo
    AND exception_type IN ('schedule_change', 'extraordinary_coverage')
  )
);

COMMENT ON COLUMN exceptions.blocks IS
  'Horario del día para cambio de jornada o cobertura extraordinaria. Cuando '
  'está, reemplaza al esquema: el sistema paga ese horario, partido en bandas.';

-- ─── 3. Horas autorizadas sin tope ─────────────────────────────────
ALTER TABLE overtime ADD COLUMN IF NOT EXISTS uncapped BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN overtime.uncapped IS
  'Pagar aunque la marcación no lo respalde. Sin esto, lo autorizado se '
  'contrasta contra lo trabajado.';

-- ─── 4. Compensación fija por día trabajado ────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS daily_compensation_minutes SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_compensation_band TEXT NOT NULL DEFAULT 'day_ld';

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_daily_compensation_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_daily_compensation_check CHECK (
  daily_compensation_minutes BETWEEN 0 AND 240
  AND daily_compensation_band IN ('day_ld', 'night_ld', 'day_hd', 'night_hd')
);

COMMENT ON COLUMN profiles.daily_compensation_minutes IS
  'Minutos que se pagan por cada día trabajado, además del plan. Entran en el '
  'subtotal, así que el REG, el SUPER REG y el resto se calculan encima.';

-- ─── 5. Márgenes de la normalización ───────────────────────────────
ALTER TABLE settlement_settings
  ADD COLUMN IF NOT EXISTS late_arrival_margin_minutes    SMALLINT NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS early_departure_margin_minutes SMALLINT NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS missing_clock_blocks    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS incomplete_clock_blocks BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS new_hire_review_days    SMALLINT NOT NULL DEFAULT 14;

ALTER TABLE settlement_settings DROP CONSTRAINT IF EXISTS settlement_margins_check;
ALTER TABLE settlement_settings ADD CONSTRAINT settlement_margins_check CHECK (
  late_arrival_margin_minutes BETWEEN 0 AND 240
  AND early_departure_margin_minutes BETWEEN 0 AND 240
  AND new_hire_review_days BETWEEN 0 AND 90
);

COMMENT ON COLUMN settlement_settings.missing_clock_blocks IS
  'Si un día con plan y sin ninguna marcación bloquea la confirmación. En julio y '
  'agosto 2026 la planilla pagó el plan en los 44 días así de agentes con antigüedad.';

-- ─── 6. Avisos que bloquean ────────────────────────────────────────
ALTER TABLE pre_settlement_warnings
  ADD COLUMN IF NOT EXISTS blocking BOOLEAN NOT NULL DEFAULT FALSE,
  -- Plan, marcado, minutos, horas sugeridas: lo que la pantalla necesita para
  -- mostrar el caso y proponer cómo resolverlo
  ADD COLUMN IF NOT EXISTS context JSONB,
  ADD COLUMN IF NOT EXISTS suggestion JSONB;

ALTER TABLE pre_settlement_warnings DROP CONSTRAINT IF EXISTS psw_code_check;
ALTER TABLE pre_settlement_warnings ADD CONSTRAINT psw_code_check CHECK (code IN (
  'no_clock_in', 'no_clock_out', 'arrived_late', 'left_early',
  'worked_without_schedule',
  'worked_more_than_schedule',   -- trabajó de más y no está cubierto
  'worked_other_hours',          -- marcó en otro horario que el del plan
  'worked_on_holiday',           -- marcó en un feriado sin cobertura
  'clocked_on_leave',            -- marcó un día de ausencia, vacaciones o licencia
  'additional_without_excess',   -- se autorizaron horas y no hubo excedente
  'additional_over_worked',      -- se autorizó más de lo que estuvo
  'additional_unverified',       -- se pagó lo autorizado sin marcación que lo respalde
  'absence', 'missing_period_params'
));

CREATE INDEX IF NOT EXISTS idx_psw_blocking_pending
  ON pre_settlement_warnings(pre_settlement_id)
  WHERE blocking AND status = 'pending';

-- ─── 7. Orígenes nuevos del desglose diario ────────────────────────
ALTER TABLE pre_settlement_daily DROP CONSTRAINT IF EXISTS psd_source_check;
ALTER TABLE pre_settlement_daily ADD CONSTRAINT psd_source_check
  CHECK (source IN ('schedule', 'exception', 'overtime', 'manual', 'adjustment', 'correction', 'compensation'));

-- La preliquidación sabe cuándo se recalculó por última vez, y guarda qué pasó
-- cada día: el plan, lo marcado y cómo se resolvió. Mientras es borrador se
-- reescribe en cada recálculo; al confirmarla queda como constancia.
ALTER TABLE pre_settlements
  ADD COLUMN IF NOT EXISTS recalculated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS day_summary JSONB;
