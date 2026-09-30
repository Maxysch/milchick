-- ─────────────────────────────────────────────────────────────────
-- Migración 019: Catálogo de conceptos de los ítems
-- ─────────────────────────────────────────────────────────────────
-- El concepto de un ítem manual era texto libre: "Bono", "bono" y "Bono
-- objetivo" eran tres cosas distintas, y en el resumen todos caían en una
-- columna "Otros ítems". Ahora cada concepto es una entrada de un catálogo:
--
--   - Se administra en Configuración: alta, nombre, valores por defecto, orden
--     y baja lógica (desactivar). Nada se borra.
--   - Al liquidar se elige de la lista. Si falta, se crea en el momento y queda
--     "a revisar", para que el administrador lo confirme o lo unifique con otro.
--   - Los conceptos que calcula el motor (REG, SUPER REG, ...) también están,
--     marcados como del sistema: se les puede cambiar el nombre y el orden.
--
-- Los ítems siguen guardando la clave del concepto en `concept`, que ahora es
-- una referencia al catálogo. Al confirmar una preliquidación se guarda además
-- el nombre con el que se confirmó (`concept_name`): cambiar el nombre en el
-- catálogo no reescribe lo que ya se pagó.
--
-- Es idempotente.
-- ─────────────────────────────────────────────────────────────────

-- Dos nombres que sólo difieren en mayúsculas, acentos o signos son el mismo
-- concepto. La app aplica la misma regla (shared/src/concepts.ts).
CREATE OR REPLACE FUNCTION concept_normalize(t TEXT) RETURNS TEXT
LANGUAGE SQL IMMUTABLE AS $$
  SELECT btrim(regexp_replace(
    translate(lower(coalesce(t, '')), 'áéíóúüñàèìòùâêîôûäëïö', 'aeiouunaeiouaeiouaeio'),
    '[^a-z0-9]+', ' ', 'g'))
$$;

CREATE TABLE IF NOT EXISTS item_concepts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Clave estable: la usan los ítems. El nombre se puede cambiar, la clave no.
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  normalized_name TEXT GENERATED ALWAYS AS (concept_normalize(name)) STORED,
  description TEXT,
  -- Los que calcula el motor: no se borran, no se desactivan, no se cargan a mano
  system BOOLEAN NOT NULL DEFAULT FALSE,
  -- Cómo viene precargado el ítem al elegir el concepto
  kind TEXT NOT NULL DEFAULT 'fixed',
  default_amount NUMERIC(14, 2),
  default_percentage NUMERIC(8, 6),
  default_unit_minutes INTEGER,
  default_days INTEGER,
  default_band TEXT,
  default_tier TEXT,
  default_factor NUMERIC(8, 4),
  sort_order INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  -- Creado al liquidar o por la migración: el administrador lo confirma o lo unifica
  needs_review BOOLEAN NOT NULL DEFAULT FALSE,
  origin TEXT NOT NULL DEFAULT 'configuracion',
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Un nombre, un concepto, activo o no
CREATE UNIQUE INDEX IF NOT EXISTS ic_normalized_name_unique ON item_concepts (normalized_name);

ALTER TABLE item_concepts DROP CONSTRAINT IF EXISTS ic_kind_check;
ALTER TABLE item_concepts ADD CONSTRAINT ic_kind_check CHECK (kind IN ('fixed', 'percentage', 'hourly'));
ALTER TABLE item_concepts DROP CONSTRAINT IF EXISTS ic_band_check;
ALTER TABLE item_concepts ADD CONSTRAINT ic_band_check
  CHECK (default_band IS NULL OR default_band IN ('day_ld', 'night_ld', 'day_hd', 'night_hd'));
ALTER TABLE item_concepts DROP CONSTRAINT IF EXISTS ic_tier_check;
ALTER TABLE item_concepts ADD CONSTRAINT ic_tier_check
  CHECK (default_tier IS NULL OR default_tier IN ('normal', 'additional', 'overtime_50', 'overtime_100'));
ALTER TABLE item_concepts DROP CONSTRAINT IF EXISTS ic_origin_check;
ALTER TABLE item_concepts ADD CONSTRAINT ic_origin_check
  CHECK (origin IN ('sistema', 'configuracion', 'liquidacion', 'migracion'));
-- Un concepto del sistema no se desactiva
ALTER TABLE item_concepts DROP CONSTRAINT IF EXISTS ic_system_active_check;
ALTER TABLE item_concepts ADD CONSTRAINT ic_system_active_check CHECK (NOT system OR is_active);

DROP TRIGGER IF EXISTS set_updated_at ON item_concepts;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON item_concepts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE item_concepts ENABLE ROW LEVEL SECURITY;

-- ─── Los conceptos que calcula el motor ───
INSERT INTO item_concepts (key, name, system, kind, sort_order, origin, description) VALUES
  ('reg',                  'Premio a la Excelencia (REG)',          TRUE, 'percentage', 10, 'sistema', 'Se carga por mes en Evaluación mensual'),
  ('super_reg',            'SUPER REG',                             TRUE, 'percentage', 20, 'sistema', 'Se carga por mes en Evaluación mensual'),
  ('seniority',            'Antigüedad',                            TRUE, 'percentage', 30, 'sistema', 'Meses reconocidos del agente'),
  ('equipment',            'Reintegro por uso de equipos',          TRUE, 'percentage', 40, 'sistema', 'Porcentaje del agente'),
  ('holiday_compensation', 'Compensación por feriado no trabajado', TRUE, 'hourly',     50, 'sistema', 'Horas del feriado × valor hora × factor'),
  ('vacation_plus',        'Plus vacacional',                       TRUE, 'hourly',     60, 'sistema', 'Horas de vacaciones × valor hora × factor'),
  ('monotributo',          'Reintegro de monotributo',              TRUE, 'fixed',      70, 'sistema', 'Se carga por mes en Evaluación mensual')
ON CONFLICT (key) DO NOTHING;

-- ─── Los conceptos de texto libre que ya existen pasan al catálogo ───
-- Los que sólo difieren en mayúsculas, acentos o separadores se juntan en el
-- más usado. Quedan "a revisar": el nombre sale de lo que se había tipeado.
DO $$
DECLARE
  r RECORD;
  destino TEXT;
  base TEXT;
  nombre TEXT;
  i INTEGER;
BEGIN
  FOR r IN
    SELECT concept, concept_normalize(concept) AS norm, count(*) AS n
      FROM pre_settlement_items
     WHERE concept NOT IN (SELECT key FROM item_concepts)
     GROUP BY concept
     ORDER BY concept_normalize(concept), count(*) DESC, concept
  LOOP
    nombre := btrim(regexp_replace(replace(r.concept, '_', ' '), '\s+', ' ', 'g'));
    nombre := upper(left(nombre, 1)) || substr(nombre, 2);

    SELECT key INTO destino FROM item_concepts
     WHERE NOT system AND normalized_name IN (r.norm, r.norm || ' manual')
     LIMIT 1;

    IF destino IS NULL THEN
      -- Se llama como uno del sistema: no puede ser ese, porque los del
      -- sistema se recalculan y un ítem cargado a mano se perdería
      IF EXISTS (SELECT 1 FROM item_concepts WHERE normalized_name = r.norm) THEN
        nombre := nombre || ' (manual)';
      END IF;
      -- La clave, limpia: "Compensación especial" → compensacion_especial
      base := coalesce(nullif(replace(concept_normalize(nombre), ' ', '_'), ''), 'concepto');
      destino := base;
      i := 2;
      WHILE EXISTS (SELECT 1 FROM item_concepts WHERE key = destino) LOOP
        destino := base || '_' || i;
        i := i + 1;
      END LOOP;
      INSERT INTO item_concepts (key, name, kind, origin, needs_review, sort_order)
      VALUES (
        destino, nombre,
        (SELECT mode() WITHIN GROUP (ORDER BY kind) FROM pre_settlement_items WHERE concept = r.concept),
        'migracion', TRUE, 200
      );
    END IF;

    -- El mismo concepto escrito de otra forma, o con la clave nueva
    IF destino <> r.concept THEN
      UPDATE pre_settlement_items SET concept = destino WHERE concept = r.concept;
    END IF;
  END LOOP;
END $$;

-- ─── Los ítems apuntan al catálogo ───
ALTER TABLE pre_settlement_items DROP CONSTRAINT IF EXISTS psi_concept_fk;
ALTER TABLE pre_settlement_items ADD CONSTRAINT psi_concept_fk
  FOREIGN KEY (concept) REFERENCES item_concepts (key) ON UPDATE CASCADE;

-- El nombre con el que se confirmó. En un borrador queda vacío y se muestra el
-- nombre actual del catálogo.
ALTER TABLE pre_settlement_items ADD COLUMN IF NOT EXISTS concept_name TEXT;
UPDATE pre_settlement_items i
   SET concept_name = c.name
  FROM item_concepts c, pre_settlements p
 WHERE c.key = i.concept
   AND p.id = i.pre_settlement_id
   AND p.status = 'confirmed'
   AND i.concept_name IS NULL;

CREATE INDEX IF NOT EXISTS idx_psi_concept ON pre_settlement_items (concept);

COMMENT ON TABLE item_concepts IS
  'Catálogo de conceptos de los ítems. Se administra en Configuración; los del '
  'sistema los calcula el motor.';
COMMENT ON COLUMN pre_settlement_items.concept_name IS
  'Nombre del concepto al confirmar. Vacío en los borradores.';
