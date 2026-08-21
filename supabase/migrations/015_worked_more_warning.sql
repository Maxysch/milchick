-- ─────────────────────────────────────────────────────────────────
-- Migración 015: Desvío por trabajar de más
-- ─────────────────────────────────────────────────────────────────
-- Faltaba el caso simétrico de `left_early`. Si alguien se queda una hora
-- después de su horario y marca la salida al final, se le pagan las horas del
-- esquema y la diferencia no la avisa nadie: quedaba invisible, peor que el día
-- sin esquema, que al menos levantaba `worked_without_schedule`.
--
-- Es idempotente.
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE pre_settlement_warnings DROP CONSTRAINT IF EXISTS psw_code_check;
ALTER TABLE pre_settlement_warnings ADD CONSTRAINT psw_code_check CHECK (code IN (
  'no_clock_in', 'no_clock_out', 'arrived_late', 'left_early',
  'worked_without_schedule',
  'worked_more_than_schedule',   -- marcó más horas de las que se le liquidan
  'absence', 'missing_period_params'
));
