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
Aplicar los archivos de `supabase/migrations/` en orden numérico en tu proyecto
de Supabase.

- `001` a `003` — esquema base. Antes de seguir, creá tu usuario admin desde
  Supabase Auth.
- `004` — seed viejo de prueba (un solo agente, junio 2026). **Opcional**: quedó
  reemplazado por el `008`.
- `005` a `007` — modelo de liquidación (bandas, tramos, conceptos, período 26→25).
  La `006` y la `007` son idempotentes: se pueden volver a correr sobre una base
  donde ya se aplicaron, entera o a medias.
- `008` — datos reales de operación: 3 clientes, 13 agentes con sus tarifas,
  esquemas y parámetros de liquidación, feriados, excepciones, horas adicionales
  y 721 marcaciones desde el 01/06/2026. Es idempotente.

Los agentes del `008` se crean sin contraseña: no pueden iniciar sesión hasta que
los invites desde Supabase. El rol `agent` todavía no tiene pantallas propias y
las marcaciones las carga el supervisor.

Para regenerar el `008` desde los Excel originales:

```bash
python3 validacion/generar_seed.py
```

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

### 5. Tests
```bash
npm test
```

Validan el núcleo de cálculo de honorarios contra la liquidación real de julio
2026. Los scripts de `validacion/` reproducen la misma comprobación partiendo de
los Excel originales.

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
- `GET /api/pre-settlements/period?year=&month=` - Período por defecto (va del 26 al 25)
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
