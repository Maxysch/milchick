-- ╔══════════════════════════════════════════════════════════════╗
-- ║  Milchick - Initial Schema                                  ║
-- ║  Sistema de Presentismo y Preliquidación de Honorarios       ║
-- ╚══════════════════════════════════════════════════════════════╝

-- ─── Profiles ───────────────────────────────────────────────────
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  employee_id TEXT UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('admin', 'supervisor', 'agent')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, first_name, last_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ─── Clients ────────────────────────────────────────────────────
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Agent Rates ────────────────────────────────────────────────
-- Tarifa por hora definida por agente, día de la semana y franja horaria
CREATE TABLE agent_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sunday
  time_slot TEXT NOT NULL CHECK (time_slot IN ('daytime', 'nighttime')),
  rate_type TEXT NOT NULL CHECK (rate_type IN ('regular', 'overtime')),
  amount_per_hour NUMERIC(10, 2) NOT NULL CHECK (amount_per_hour >= 0),
  effective_from DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (profile_id, day_of_week, time_slot, rate_type, effective_from)
);

CREATE INDEX idx_agent_rates_profile ON agent_rates(profile_id);

-- ─── Schedules ──────────────────────────────────────────────────
-- Esquema horario con fecha de vigencia. Un agente puede tener
-- múltiples entradas por día (serie o paralelo con distintos clientes)
CREATE TABLE schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  effective_from DATE NOT NULL,
  effective_until DATE, -- NULL = vigente indefinidamente
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_schedules_profile ON schedules(profile_id);
CREATE INDEX idx_schedules_effective ON schedules(effective_from, effective_until);

-- ─── Clock Entries ──────────────────────────────────────────────
-- Marcaciones brutas de ingreso/egreso cargadas por el supervisor
CREATE TABLE clock_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  clock_in TIME NOT NULL,
  clock_out TIME,
  client_id UUID REFERENCES clients(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_clock_entries_profile_date ON clock_entries(profile_id, date);

-- ─── Exceptions ─────────────────────────────────────────────────
-- Vacaciones, ausencias, cambios de jornada, coberturas extraordinarias
CREATE TABLE exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  exception_type TEXT NOT NULL CHECK (exception_type IN (
    'vacation', 'absence', 'schedule_change', 'extraordinary_coverage'
  )),
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  client_id UUID REFERENCES clients(id), -- para extraordinary_coverage
  notes TEXT,
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_exceptions_profile_dates ON exceptions(profile_id, date_from, date_to);

-- ─── Overtime ───────────────────────────────────────────────────
-- Horas extra con fecha, cantidad, y horario opcional
CREATE TABLE overtime (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  hours NUMERIC(5, 2) NOT NULL CHECK (hours > 0),
  start_time TIME,
  end_time TIME,
  client_id UUID REFERENCES clients(id),
  notes TEXT,
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_overtime_profile_date ON overtime(profile_id, date);

-- ─── Holidays ───────────────────────────────────────────────────
CREATE TABLE holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  date DATE NOT NULL,
  holiday_type TEXT NOT NULL CHECK (holiday_type IN ('national', 'company')),
  year SMALLINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (date, holiday_type)
);

-- ─── Normalization Rules ────────────────────────────────────────
-- Reglas de normalización (estructuradas + texto libre para LangChain)
CREATE TABLE normalization_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  rule_text TEXT NOT NULL, -- lenguaje natural para el agente LangChain
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Settlement Rules ──────────────────────────────────────────
-- Reglas de liquidación (presentismo, premios, plus vacacional, etc.)
CREATE TABLE settlement_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  rule_text TEXT NOT NULL, -- lenguaje natural para el agente LangChain
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Normalized Entries ─────────────────────────────────────────
-- Resultado del normalizador: marcaciones limpias
CREATE TABLE normalized_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clock_entry_id UUID NOT NULL REFERENCES clock_entries(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  normalized_in TIME NOT NULL,
  normalized_out TIME NOT NULL,
  daytime_hours NUMERIC(5, 2) NOT NULL DEFAULT 0,
  nighttime_hours NUMERIC(5, 2) NOT NULL DEFAULT 0,
  adjustments JSONB, -- descripción de ajustes aplicados
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_normalized_profile_date ON normalized_entries(profile_id, date);

-- ─── Pre-Settlements ───────────────────────────────────────────
-- Cabecera de preliquidación
CREATE TABLE pre_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'cancelled')),
  total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Pre-Settlement Daily Breakdown ─────────────────────────────
-- Desglose diario con tipos de hora, todo editable
CREATE TABLE pre_settlement_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pre_settlement_id UUID NOT NULL REFERENCES pre_settlements(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  hour_type TEXT NOT NULL CHECK (hour_type IN (
    'regular_daytime', 'regular_nighttime',
    'overtime_daytime', 'overtime_nighttime',
    'holiday_daytime', 'holiday_nighttime'
  )),
  hours NUMERIC(5, 2) NOT NULL DEFAULT 0,
  rate_per_hour NUMERIC(10, 2) NOT NULL DEFAULT 0,
  amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  is_projected BOOLEAN NOT NULL DEFAULT FALSE,
  client_id UUID REFERENCES clients(id)
);

CREATE INDEX idx_psd_settlement ON pre_settlement_daily(pre_settlement_id);

-- ─── Pre-Settlement Items ───────────────────────────────────────
-- Ítems adicionales editables (presentismo, premios, plus vacacional, etc.)
CREATE TABLE pre_settlement_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pre_settlement_id UUID NOT NULL REFERENCES pre_settlements(id) ON DELETE CASCADE,
  concept TEXT NOT NULL,
  description TEXT,
  amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  is_percentage BOOLEAN NOT NULL DEFAULT FALSE,
  percentage_base TEXT, -- sobre qué se calcula el porcentaje
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_psi_settlement ON pre_settlement_items(pre_settlement_id);

-- ─── Updated_at trigger ────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON agent_rates FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON schedules FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON clock_entries FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON exceptions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON overtime FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON holidays FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON normalization_rules FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON settlement_rules FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pre_settlements FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── RLS Policies ──────────────────────────────────────────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE clock_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE overtime ENABLE ROW LEVEL SECURITY;
ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE normalization_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlement_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE normalized_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE pre_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE pre_settlement_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE pre_settlement_items ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS, so backend access works without policies
-- Client-side policies can be added as needed
