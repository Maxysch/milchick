-- ─────────────────────────────────────────────────────────────────
-- Migración 011: El REG se carga por agente y por mes
-- ─────────────────────────────────────────────────────────────────
-- El Premio a la Excelencia y el SUPER REG dependen de cómo performó el agente
-- durante el mes, así que no son un atributo del agente: son del par
-- (agente, período). Tenerlos sólo en `profiles` obligaba a pisarlos cada mes y
-- perdía el historial de por qué se pagó lo que se pagó.
--
-- Los porcentajes que quedan en `profiles` pasan a ser el valor por defecto con
-- el que se precarga el mes nuevo, no el que se liquida.
--
-- Es idempotente.
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_period_params (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  year  SMALLINT NOT NULL,
  month SMALLINT NOT NULL,
  -- Los tres componentes del Premio a la Excelencia (REG). Se suman.
  reg_people_pct       NUMERIC(6, 4) NOT NULL DEFAULT 0,
  reg_quantitative_pct NUMERIC(6, 4) NOT NULL DEFAULT 0,
  reg_qualitative_pct  NUMERIC(6, 4) NOT NULL DEFAULT 0,
  super_reg_pct        NUMERIC(6, 4) NOT NULL DEFAULT 0,
  -- Por qué se puso lo que se puso
  notes TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (profile_id, year, month)
);

ALTER TABLE agent_period_params DROP CONSTRAINT IF EXISTS app_month_check;
ALTER TABLE agent_period_params ADD CONSTRAINT app_month_check
  CHECK (month BETWEEN 1 AND 12);

CREATE INDEX IF NOT EXISTS idx_app_period ON agent_period_params(year, month);

DROP TRIGGER IF EXISTS set_updated_at ON agent_period_params;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON agent_period_params
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE agent_period_params ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE agent_period_params IS
  'Evaluación mensual del agente. Lo que no esté cargado para un mes cae al valor '
  'por defecto del perfil, pero eso es sólo una red: el REG se carga cada mes.';

-- ─── Arrastrar lo que ya estaba en el perfil a julio 2026 ───────
-- Es el período que se venía liquidando cuando se hizo este cambio; si no, esas
-- preliquidaciones pasarían a calcular el REG en cero.
INSERT INTO agent_period_params (
  profile_id, year, month,
  reg_people_pct, reg_quantitative_pct, reg_qualitative_pct, super_reg_pct, notes
)
SELECT id, 2026, 7,
       reg_people_pct, reg_quantitative_pct, reg_qualitative_pct, super_reg_pct,
       'Migrado desde los valores del perfil'
  FROM profiles
 WHERE role = 'agent'
   AND (reg_people_pct > 0 OR reg_quantitative_pct > 0
        OR reg_qualitative_pct > 0 OR super_reg_pct > 0)
ON CONFLICT (profile_id, year, month) DO NOTHING;

COMMENT ON COLUMN profiles.reg_people_pct IS
  'Valor por defecto con el que se precarga el mes nuevo. Lo que se liquida sale '
  'de agent_period_params.';

-- ─── Nuevo código de desvío ─────────────────────────────────────
ALTER TABLE pre_settlement_warnings DROP CONSTRAINT IF EXISTS psw_code_check;
ALTER TABLE pre_settlement_warnings ADD CONSTRAINT psw_code_check CHECK (code IN (
  'no_clock_in', 'no_clock_out', 'arrived_late', 'left_early',
  'worked_without_schedule', 'absence',
  'missing_period_params'     -- se liquidó sin la evaluación del mes
));
