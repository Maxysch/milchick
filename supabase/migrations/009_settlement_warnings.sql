-- ─────────────────────────────────────────────────────────────────
-- Migración 009: Desvíos de la preliquidación
-- ─────────────────────────────────────────────────────────────────
-- Desde la 007 se paga el esquema, no la marcación. Eso cambia la naturaleza
-- del error: antes, si alguien no marcaba, cobraba de menos y venía a reclamar.
-- Ahora cobra igual y nadie se entera. La única señal es el contraste contra las
-- marcaciones, así que tiene que quedar registrada y revisada, no perderse en la
-- respuesta del POST.
--
-- Es idempotente.
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pre_settlement_warnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pre_settlement_id UUID NOT NULL REFERENCES pre_settlements(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  code TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  -- pending  = nadie lo miró
  -- accepted = se revisó y está bien (salida autorizada, marcación olvidada, etc.)
  -- corrected = se revisó y se ajustaron las horas
  status TEXT NOT NULL DEFAULT 'pending',
  note TEXT,
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (pre_settlement_id, date, code)
);

ALTER TABLE pre_settlement_warnings DROP CONSTRAINT IF EXISTS psw_code_check;
ALTER TABLE pre_settlement_warnings ADD CONSTRAINT psw_code_check CHECK (code IN (
  'no_clock_in',             -- se pagó el esquema sin ninguna marcación
  'no_clock_out',            -- marcó entrada pero no salida
  'arrived_late',            -- ingresó fuera de tolerancia
  'left_early',              -- marcó menos horas que el esquema
  'worked_without_schedule', -- marcó un día que no tiene esquema asignado
  'absence'                  -- ausencia: no se liquidaron horas
));

ALTER TABLE pre_settlement_warnings DROP CONSTRAINT IF EXISTS psw_status_check;
ALTER TABLE pre_settlement_warnings ADD CONSTRAINT psw_status_check
  CHECK (status IN ('pending', 'accepted', 'corrected'));

CREATE INDEX IF NOT EXISTS idx_psw_settlement ON pre_settlement_warnings(pre_settlement_id);
CREATE INDEX IF NOT EXISTS idx_psw_pending
  ON pre_settlement_warnings(pre_settlement_id) WHERE status = 'pending';

ALTER TABLE pre_settlement_warnings ENABLE ROW LEVEL SECURITY;
