-- ─────────────────────────────────────────────────────────────────
-- Migración 012: Reintegro de monotributo por agente y por mes
-- ─────────────────────────────────────────────────────────────────
-- El importe cambia cuando cambia la categoría o el valor del monotributo, y no
-- es el mismo para todos. Va junto al REG porque tiene la misma clave: el par
-- (agente, período). En la planilla aparecía con tres nombres distintos según el
-- agente —"Reintegro Gastos", "Reintegro Gastos Monotributo" y "Anticipo
-- Monotributo mes en curso"— pero es el mismo concepto.
--
-- Es idempotente.
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE agent_period_params
  ADD COLUMN IF NOT EXISTS monotributo_reimbursement NUMERIC(12, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN agent_period_params.monotributo_reimbursement IS
  'Importe fijo del mes, no un porcentaje del subtotal.';

ALTER TABLE agent_period_params DROP CONSTRAINT IF EXISTS app_monotributo_check;
ALTER TABLE agent_period_params ADD CONSTRAINT app_monotributo_check
  CHECK (monotributo_reimbursement >= 0);

-- ─── Nuevo código de desvío ─────────────────────────────────────
ALTER TABLE pre_settlement_warnings DROP CONSTRAINT IF EXISTS psw_code_check;
ALTER TABLE pre_settlement_warnings ADD CONSTRAINT psw_code_check CHECK (code IN (
  'no_clock_in', 'no_clock_out', 'arrived_late', 'left_early',
  'worked_without_schedule', 'absence', 'missing_period_params'
));

-- ─── Valores reales de julio 2026 ───────────────────────────────
-- Tomados de la liquidación de julio (fila "Reintegro Gastos" de cada hoja).
-- Sin esto, las preliquidaciones de julio quedarían $752.783,34 abajo.
INSERT INTO agent_period_params (profile_id, year, month, monotributo_reimbursement, notes) VALUES
  ('36f01663-4d71-53e6-8bc9-44b18c7ff965', 2026, 7, 61032.18, 'Migrado desde la liquidación de julio 2026'),
  ('ac70403b-b541-51a4-9d03-d1fe17be29df', 2026, 7, 70497.18, 'Migrado desde la liquidación de julio 2026'),
  ('a7f858b9-3d7a-5ef0-848b-cb3e62dd2938', 2026, 7, 70497.18, 'Migrado desde la liquidación de julio 2026'),
  ('ba59785e-f9b7-5809-ac96-ef74cc849773', 2026, 7, 61032.18, 'Migrado desde la liquidación de julio 2026'),
  ('a2bbb44d-a0fe-58e4-b8bc-de493fa7d533', 2026, 7, 70497.18, 'Migrado desde la liquidación de julio 2026'),
  ('45d424e6-8373-55e2-80c3-03168f42116d', 2026, 7, 49527.18, 'Migrado desde la liquidación de julio 2026'),
  ('aa33c334-f50f-5f7a-b371-f260b1fa02e9', 2026, 7, 49527.18, 'Migrado desde la liquidación de julio 2026'),
  ('b09b0777-b4ef-52cf-acb3-b5cab2fffe12', 2026, 7, 61032.18, 'Migrado desde la liquidación de julio 2026'),
  ('e3f7dce5-2f78-5a99-b184-43e19db3152b', 2026, 7, 61032.18, 'Migrado desde la liquidación de julio 2026'),
  ('f55dc4b5-2b16-5967-b594-8a6210ba77f7', 2026, 7, 49527.18, 'Migrado desde la liquidación de julio 2026'),
  ('140abdb2-c4b4-5ef8-9420-781a3fb094e0', 2026, 7, 49527.18, 'Migrado desde la liquidación de julio 2026'),
  ('88e377c8-a68e-5a75-9e13-4508b2f334ab', 2026, 7, 49527.18, 'Migrado desde la liquidación de julio 2026'),
  ('1a344d39-b990-5b4c-91c2-bc632532c419', 2026, 7, 49527.18, 'Migrado desde la liquidación de julio 2026')
ON CONFLICT (profile_id, year, month) DO UPDATE
  SET monotributo_reimbursement = EXCLUDED.monotributo_reimbursement;
