# Milchick

Sistema de control de presentismo y preliquidación de honorarios para call center.

## Estructura

```
milchick/
├── backend/          # API Express + TypeScript
├── frontend/         # React + Vite + TailwindCSS
├── shared/           # Tipos y validadores Zod compartidos
├── agent/            # Agentes LangChain.js (normalización + liquidación)
└── supabase/         # Migraciones de base de datos
```

## Setup

### 1. Instalar dependencias
```bash
npm install
```

### 2. Configurar variables de entorno
```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
cp agent/.env.example agent/.env
```

Completar con las credenciales de Supabase y OpenAI.

### 3. Ejecutar migraciones
Aplicar `supabase/migrations/001_initial_schema.sql` en tu proyecto de Supabase.

### 4. Desarrollo
```bash
# Backend + Frontend
npm run dev

# Solo backend
npm run dev:backend

# Solo frontend
npm run dev:frontend

# Agente LangChain
npm run dev:agent

# Los tres
npm run dev:all
```

## Servicios

| Servicio | Puerto | Descripción |
|----------|--------|-------------|
| Backend  | 3001   | API REST Express |
| Frontend | 5173   | App React (Vite) |
| Agent    | 3002   | Agentes LangChain |

## API Endpoints

### Auth
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Perfil actual

### Profiles (Agentes)
- `GET /api/profiles` - Listar
- `POST /api/profiles` - Crear
- `PATCH /api/profiles/:id` - Actualizar

### Clients
- `GET /api/clients` - Listar
- `POST /api/clients` - Crear
- `PATCH /api/clients/:id` - Actualizar
- `DELETE /api/clients/:id` - Eliminar

### Agent Rates (Tarifas por agente)
- `GET /api/agent-rates/profile/:profileId` - Listar tarifas
- `POST /api/agent-rates` - Crear tarifa
- `PUT /api/agent-rates/profile/:profileId` - Bulk upsert

### Schedules (Esquemas)
- `GET /api/schedules/profile/:profileId?date=` - Listar vigentes
- `POST /api/schedules` - Crear
- `PATCH /api/schedules/:id/end` - Finalizar esquema

### Clock Entries (Marcaciones)
- `GET /api/clock-entries/profile/:profileId?from=&to=` - Listar
- `POST /api/clock-entries` - Crear
- `POST /api/clock-entries/bulk` - Crear en lote

### Exceptions (Excepciones)
- `GET /api/exceptions/profile/:profileId?from=&to=&type=` - Listar
- `POST /api/exceptions` - Crear

### Overtime (Horas extra)
- `GET /api/overtime/profile/:profileId?from=&to=` - Listar
- `POST /api/overtime` - Crear

### Holidays (Feriados)
- `GET /api/holidays?year=` - Listar
- `POST /api/holidays` - Crear

### Rules (Reglas)
- `GET /api/rules/normalization` - Reglas de normalización
- `GET /api/rules/settlement` - Reglas de liquidación
- `POST /api/rules/normalization` - Crear regla
- `POST /api/rules/settlement` - Crear regla

### Normalization (Normalización)
- `GET /api/normalization/preview/:profileId?from=&to=` - Preview
- `POST /api/normalization/run/:profileId` - Ejecutar y persistir
- `GET /api/normalization/:profileId?from=&to=` - Consultar resultados

### Pre-Settlements (Preliquidación)
- `GET /api/pre-settlements` - Listar
- `POST /api/pre-settlements/generate` - Generar nueva
- `GET /api/pre-settlements/:id` - Detalle con desglose
- `PATCH /api/pre-settlements/daily/:lineId` - Editar línea diaria
- `POST /api/pre-settlements/:id/items` - Agregar ítem
- `PATCH /api/pre-settlements/items/:itemId` - Editar ítem
- `DELETE /api/pre-settlements/items/:itemId` - Eliminar ítem
- `PATCH /api/pre-settlements/:id/status` - Confirmar/cancelar

### Agent Chat (Agentes IA)
- `POST /api/agent/normalization` - Chat con agente de normalización
- `POST /api/agent/settlement` - Chat con agente de liquidación
