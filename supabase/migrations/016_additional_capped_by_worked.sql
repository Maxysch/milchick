-- ─────────────────────────────────────────────────────────────────
-- Migración 016: Las horas cargadas se topean contra lo trabajado
-- ─────────────────────────────────────────────────────────────────
-- Antes las horas que cargaba el supervisor se sumaban al esquema sin más. Un
-- día de 7 h con 1 h cargada pagaba 8 h aunque el agente hubiera estado 7.
--
-- Ahora se pagan sólo en la medida en que efectivamente estuvo:
--
--   normales  = esquema
--   adicional = min(cargado, excedente trabajado)   si el excedente > umbral
--             = 0                                     si no
--
-- El excedente cuenta lo de antes de entrar y lo de después de salir juntos,
-- contra un único umbral.
--
-- Verificado contra julio 2026: de 243 días con marcación completa, sólo 7
-- cambian, y 6 de esos 7 son arrastres del mes anterior cargados como
-- adicionales del día, práctica que la conciliación del período ya reemplaza.
--
-- Es idempotente.
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE settlement_settings
  ADD COLUMN IF NOT EXISTS additional_threshold_minutes SMALLINT NOT NULL DEFAULT 30;

ALTER TABLE settlement_settings DROP CONSTRAINT IF EXISTS settlement_threshold_check;
ALTER TABLE settlement_settings ADD CONSTRAINT settlement_threshold_check
  CHECK (additional_threshold_minutes BETWEEN 0 AND 240);

COMMENT ON COLUMN settlement_settings.additional_threshold_minutes IS
  'Excedente mínimo del día para que las horas cargadas se liquiden. Cuenta lo '
  'trabajado antes de entrar más lo de después de salir, contra un solo umbral.';

-- ─── Avisos nuevos ──────────────────────────────────────────────
ALTER TABLE pre_settlement_warnings DROP CONSTRAINT IF EXISTS psw_code_check;
ALTER TABLE pre_settlement_warnings ADD CONSTRAINT psw_code_check CHECK (code IN (
  'no_clock_in', 'no_clock_out', 'arrived_late', 'left_early',
  'worked_without_schedule',
  'worked_more_than_schedule',   -- trabajó de más y no está cubierto
  'additional_without_excess',   -- se cargaron horas y no hubo excedente
  'additional_over_worked',      -- se cargó más de lo que estuvo: se recortó
  'absence', 'missing_period_params'
));
