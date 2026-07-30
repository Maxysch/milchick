-- ============================================================
-- Migration 004: Datos de prueba para Junio 2026
-- Ejecutar en Supabase SQL Editor
--
-- Crea datos completos para el usuario existente (Maximiliano Schippert):
-- - 1 cliente
-- - Tarifas (hora diurna $1000, nocturna $1200, extra diurna $1500)
-- - Esquema Lun-Jue 09:00-17:00
-- - Marcaciones brutas para todo junio (con variaciones realistas)
-- - Horas extras (3 días)
-- - 1 excepción (ausencia)
-- ============================================================

DO $$
DECLARE
  v_profile_id UUID;
  v_client_id  UUID;
BEGIN

  -- ─── Obtener el perfil existente ───────────────────────────────
  SELECT id INTO v_profile_id FROM profiles LIMIT 1;

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'No se encontró ningún perfil. Crea un usuario primero.';
  END IF;

  -- ─── Cliente de prueba ─────────────────────────────────────────
  INSERT INTO clients (id, name, is_active)
  VALUES (gen_random_uuid(), 'Telecom Argentina', TRUE)
  RETURNING id INTO v_client_id;

  -- ─── Tarifas ──────────────────────────────────────────────────
  -- $1000/h diurna regular (Lun=1, Mar=2, Mié=3, Jue=4)
  INSERT INTO agent_rates (profile_id, day_of_week, time_slot, rate_type, amount_per_hour, effective_from)
  VALUES
    (v_profile_id, 1, 'daytime',   'regular',  1000.00, '2026-01-01'),
    (v_profile_id, 2, 'daytime',   'regular',  1000.00, '2026-01-01'),
    (v_profile_id, 3, 'daytime',   'regular',  1000.00, '2026-01-01'),
    (v_profile_id, 4, 'daytime',   'regular',  1000.00, '2026-01-01'),
    -- $1200/h nocturna regular
    (v_profile_id, 1, 'nighttime', 'regular',  1200.00, '2026-01-01'),
    (v_profile_id, 2, 'nighttime', 'regular',  1200.00, '2026-01-01'),
    (v_profile_id, 3, 'nighttime', 'regular',  1200.00, '2026-01-01'),
    (v_profile_id, 4, 'nighttime', 'regular',  1200.00, '2026-01-01'),
    -- $1500/h extra diurna
    (v_profile_id, 1, 'daytime',   'overtime', 1500.00, '2026-01-01'),
    (v_profile_id, 2, 'daytime',   'overtime', 1500.00, '2026-01-01'),
    (v_profile_id, 3, 'daytime',   'overtime', 1500.00, '2026-01-01'),
    (v_profile_id, 4, 'daytime',   'overtime', 1500.00, '2026-01-01');

  -- ─── Esquema: Lun a Jue 09:00-17:00 ──────────────────────────
  INSERT INTO schedules (profile_id, client_id, day_of_week, start_time, end_time, effective_from, effective_until)
  VALUES
    (v_profile_id, v_client_id, 1, '09:00', '17:00', '2026-01-01', NULL),
    (v_profile_id, v_client_id, 2, '09:00', '17:00', '2026-01-01', NULL),
    (v_profile_id, v_client_id, 3, '09:00', '17:00', '2026-01-01', NULL),
    (v_profile_id, v_client_id, 4, '09:00', '17:00', '2026-01-01', NULL);

  -- ─── Marcaciones brutas de Junio 2026 ─────────────────────────
  -- Semana 1: Lun 01 - Jue 04
  INSERT INTO clock_entries (profile_id, date, clock_in, clock_out, client_id, notes) VALUES
    -- Lun 01: Llega 7 min antes (setup) y sale 3 min después → normalizador debe recortar ambos
    (v_profile_id, '2026-06-01', '08:53', '17:03', v_client_id, NULL),
    -- Mar 02: Puntual, sale 1 min antes
    (v_profile_id, '2026-06-02', '09:00', '16:59', v_client_id, NULL),
    -- Mié 03: Llega 12 min antes (setup más largo) y sale exacto
    (v_profile_id, '2026-06-03', '08:48', '17:00', v_client_id, NULL),
    -- Jue 04: Llega 4 min antes, se queda 5 min más
    (v_profile_id, '2026-06-04', '08:56', '17:05', v_client_id, NULL);

  -- Semana 2: Lun 08 - Jue 11
  INSERT INTO clock_entries (profile_id, date, clock_in, clock_out, client_id, notes) VALUES
    -- Lun 08: Perfecto
    (v_profile_id, '2026-06-08', '09:00', '17:00', v_client_id, NULL),
    -- Mar 09: Llega 2 min antes, sale 4 min después
    (v_profile_id, '2026-06-09', '08:58', '17:04', v_client_id, NULL),
    -- Mié 10: DÍA PROBLEMÁTICO - marcó ingreso a las 06:30 (¡2.5 hs antes!)
    -- Esto es una diferencia grosera que el normalizador debería recortar fuerte
    (v_profile_id, '2026-06-10', '06:30', '17:00', v_client_id, 'Dice que se conectó temprano para hacer otra cosa'),
    -- Jue 11: Llega 5 min antes, sale 2 min antes
    (v_profile_id, '2026-06-11', '08:55', '16:58', v_client_id, NULL);

  -- Semana 3: Lun 15 - Jue 18 (Mié 17 = AUSENCIA, no hay marcación)
  INSERT INTO clock_entries (profile_id, date, clock_in, clock_out, client_id, notes) VALUES
    -- Lun 15: Llega 3 min antes, sale exacto
    (v_profile_id, '2026-06-15', '08:57', '17:00', v_client_id, NULL),
    -- Mar 16: Puntual ambos
    (v_profile_id, '2026-06-16', '09:00', '17:00', v_client_id, NULL),
    -- Mié 17: AUSENTE (no se inserta marcación)
    -- Jue 18: Llega 6 min antes, sale 1 min después
    (v_profile_id, '2026-06-18', '08:54', '17:01', v_client_id, NULL);

  -- Semana 4: Lun 22 - Jue 25
  INSERT INTO clock_entries (profile_id, date, clock_in, clock_out, client_id, notes) VALUES
    -- Lun 22: Llega 1 min antes, sale 8 min después (horas extra este día)
    (v_profile_id, '2026-06-22', '08:59', '17:08', v_client_id, NULL),
    -- Mar 23: DÍA CON HORAS EXTRA - trabaja hasta las 19:00
    (v_profile_id, '2026-06-23', '08:55', '19:02', v_client_id, 'Hizo horas extra por pico de demanda'),
    -- Mié 24: Normal, llega 9 min antes (setup), sale exacto
    (v_profile_id, '2026-06-24', '08:51', '17:00', v_client_id, NULL),
    -- Jue 25: Llega 2 min antes, sale 3 min después. Tiene hora extra registrada aparte.
    (v_profile_id, '2026-06-25', '08:58', '17:03', v_client_id, NULL);

  -- Semana 5 (parcial): Lun 29 - Mar 30
  INSERT INTO clock_entries (profile_id, date, clock_in, clock_out, client_id, notes) VALUES
    -- Lun 29: DÍA CON HORA EXTRA - trabaja hasta las 18:30
    (v_profile_id, '2026-06-29', '08:54', '18:32', v_client_id, 'Hora extra autorizada'),
    -- Mar 30: Último día, llega 5 min antes, sale 2 min después
    (v_profile_id, '2026-06-30', '08:55', '17:02', v_client_id, NULL);

  -- ─── Excepción: Ausencia Mié 17 ──────────────────────────────
  INSERT INTO exceptions (profile_id, exception_type, date_from, date_to, notes, created_by)
  VALUES (v_profile_id, 'absence', '2026-06-17', '2026-06-17', 'Ausencia por enfermedad', v_profile_id);

  -- ─── Horas Extras ─────────────────────────────────────────────
  -- Mar 23: 2 horas extra, 17:00-19:00
  INSERT INTO overtime (profile_id, date, hours, start_time, end_time, client_id, notes, created_by)
  VALUES (v_profile_id, '2026-06-23', 2.00, '17:00', '19:00', v_client_id, 'Pico de demanda', v_profile_id);

  -- Jue 25: 1 hora extra por la tarde, horario no especificado
  INSERT INTO overtime (profile_id, date, hours, start_time, end_time, client_id, notes, created_by)
  VALUES (v_profile_id, '2026-06-25', 1.00, NULL, NULL, v_client_id, 'Tarea adicional asignada', v_profile_id);

  -- Lun 29: 1.5 horas extra, 17:00-18:30
  INSERT INTO overtime (profile_id, date, hours, start_time, end_time, client_id, notes, created_by)
  VALUES (v_profile_id, '2026-06-29', 1.50, '17:00', '18:30', v_client_id, 'Hora extra autorizada por supervisor', v_profile_id);

  RAISE NOTICE '✅ Datos de prueba de Junio 2026 creados correctamente para profile_id=%', v_profile_id;
END $$;
