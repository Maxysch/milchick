# Milchick — Documento de Arquitectura y Decisiones

> Documento de referencia para humanos y agentes de IA que necesiten entender, retomar, modificar o extender el proyecto.

---

## 1. Contexto y origen

### El problema

PeoplePlus es una empresa que gestiona agentes de call center. Necesita controlar el presentismo de sus agentes: saber quién trabajó, cuándo, cuántas horas, para qué cliente, y en base a eso poder liquidar correctamente los honorarios.

### El proyecto anterior (Roz)

Existía un proyecto previo llamado **Roz** (`/repos/peopleplus/roz`) que intentó resolver todo de una vez: presentismo, marcaciones, esquemas, eventos, cobertura, facturación al cliente, liquidación de sueldos, escalas de antigüedad, bandas tarifarias, configuraciones variables, etc. El resultado fue un sistema ambicioso con ~25 módulos de backend, ~20 páginas de frontend y un modelo de datos complejo (~30 tablas).

### La decisión

Se decidió empezar de cero con **Milchick**, un sistema más enfocado que resuelve solo lo esencial:

1. Control de presentismo (esquemas, marcaciones, excepciones)
2. Normalización de horarios (limpiar marcaciones para liquidar)
3. Preliquidación de honorarios (calcular cuánto pagar a cada agente)
4. Asistencia de IA (agentes LangChain para ayudar al supervisor)

Se dejó fuera intencionalmente: facturación al cliente, escalas de antigüedad, bandas tarifarias complejas, configuraciones variables por cliente, cobertura contratada vs. asignada.

---

## 2. Decisiones de arquitectura

### Stack tecnológico

| Decisión | Elección | Razón |
|----------|----------|-------|
| Estructura | Monorepo con npm workspaces | Ya se usaba en Roz, permite compartir tipos |
| Backend | Express + TypeScript | Conocido por el equipo, probado en Roz |
| Frontend | React + Vite + TailwindCSS 4 | Mismo stack que Roz, con Tailwind 4 actualizado |
| Base de datos | Supabase (PostgreSQL) | Auth integrado, hosting gratis, RLS, real-time |
| Validación | Zod (shared) | Validación compartida frontend/backend |
| Data fetching | React Query (TanStack) | Cache, refetch, mutations |
| Formularios | react-hook-form + @hookform/resolvers | Validación integrada con Zod |
| Iconos | Lucide React | Ligero, tree-shakeable |
| Agente IA | LangChain.js + LangGraph | Todo TypeScript, sin microservicio Python |
| LLM | OpenAI (gpt-4o-mini default) | Buen balance costo/calidad |

### ¿Por qué no Next.js?

Se evaluó migrar a Next.js pero se decidió mantener la separación backend/frontend porque:
- El backend tiene lógica de negocio compleja (normalización, preliquidación) que se beneficia de estar en su propio proceso
- El agente LangChain es un tercer servicio; tener todo en Next.js complicaría esa separación
- El equipo ya conoce el stack Express + React

### ¿Por qué TypeScript para LangChain y no Python?

Se priorizó mantener un solo lenguaje en todo el proyecto para simplificar el mantenimiento. LangChain.js con LangGraph es lo suficientemente maduro para el caso de uso (agente ReAct con herramientas de consulta).

---

## 3. Modelo de datos

### Diagrama de entidades

```
profiles ──────────┬──── agent_rates
  │                │
  │                ├──── schedules ──── clients
  │                │
  │                ├──── clock_entries ──── clients
  │                │
  │                ├──── exceptions ──── clients
  │                │
  │                ├──── overtime ──── clients
  │                │
  │                ├──── normalized_entries ──── clock_entries
  │                │
  │                └──── pre_settlements
  │                        ├── pre_settlement_daily ──── clients
  │                        └── pre_settlement_items
  │
  ├──── normalization_rules
  ├──── settlement_rules
  └──── holidays (independiente)
```

### Tablas (14 en total)

| Tabla | Propósito | Relaciones clave |
|-------|-----------|-----------------|
| `profiles` | Agentes, supervisores, admins. Extiende `auth.users` | FK a auth.users |
| `clients` | Clientes del call center (solo nombre + estado) | — |
| `agent_rates` | Tarifa por hora del agente por día/franja/tipo | FK a profiles |
| `schedules` | Esquema horario con fecha de vigencia | FK a profiles, clients |
| `clock_entries` | Marcaciones brutas de entrada/salida | FK a profiles, clients |
| `exceptions` | Vacaciones, ausencias, cambios, coberturas | FK a profiles, clients |
| `overtime` | Horas extra con horarios opcionales | FK a profiles, clients |
| `holidays` | Feriados nacionales y de empresa por año | — |
| `normalization_rules` | Reglas de normalización (texto para LangChain) | FK a profiles (creator) |
| `settlement_rules` | Reglas de liquidación (texto para LangChain) | FK a profiles (creator) |
| `normalized_entries` | Resultado del normalizador | FK a profiles, clock_entries |
| `pre_settlements` | Cabecera de preliquidación | FK a profiles |
| `pre_settlement_daily` | Desglose diario por tipo de hora | FK a pre_settlements, clients |
| `pre_settlement_items` | Ítems adicionales (presentismo, premios) | FK a pre_settlements |

### Decisiones clave del modelo

1. **Tarifas por agente, no por cliente**: Se definió que el valor por hora depende del agente (según día de la semana y franja horaria), no del cliente. Esto simplifica el modelo vs. Roz que tenía `client_task_rates`.

2. **Esquemas con fecha de vigencia**: Cada entrada de `schedules` tiene `effective_from` y `effective_until` (null = vigente). Esto permite cambiar el esquema de un agente sin perder historial.

3. **Múltiples clientes por día**: Un agente puede tener múltiples entradas de `schedules` para el mismo día de la semana (en serie o paralelo), cada una con un cliente distinto.

4. **Clientes simples**: Solo nombre y estado. Sin configuración de tarifas, bandas, ni escalas a nivel cliente.

5. **Excepciones unificadas**: Una sola tabla maneja vacaciones, ausencias, cambios de jornada y coberturas extraordinarias. El campo `exception_type` diferencia.

6. **Preliquidación en 3 niveles**: Cabecera (`pre_settlements`) → desglose diario (`pre_settlement_daily`) → ítems adicionales (`pre_settlement_items`). Todo editable.

7. **Sin tabla de `tasks`**: A diferencia de Roz, no hay tareas como entidad separada. La relación agente-cliente se modela directamente en schedules y clock_entries.

---

## 4. Arquitectura de servicios

### Flujo de datos principal

```
Marcaciones (clock_entries)
        │
        ▼
   Normalizador ◄── Esquemas (schedules)
        │          ◄── Excepciones
        │          ◄── Reglas de normalización
        │          ◄── (Opcional) Agente LangChain
        ▼
Entradas normalizadas (normalized_entries)
        │
        ▼
   Preliquidador ◄── Tarifas (agent_rates)
        │          ◄── Horas extra (overtime)
        │          ◄── Feriados (holidays)
        │          ◄── Reglas de liquidación
        ▼
Preliquidación (pre_settlements + daily + items)
        │
        ▼
   Revisión manual ◄── (Opcional) Agente LangChain
        │
        ▼
   Confirmación
```

### Normalizador (`normalizer.service.ts`)

El normalizador toma marcaciones brutas y produce horarios "limpios" listos para liquidar.

**Reglas actuales:**
1. Si el agente marcó entrada **antes** del inicio de su esquema → ajustar al inicio (recortar setup)
2. Si el agente marcó salida **después** del fin de su esquema → ajustar al fin
3. Si no hay esquema que matchee → marcar como "sin esquema" pero conservar la marcación
4. Separar horas en **diurnas** (06:00-21:00) y **nocturnas** (21:00-06:00)

**Puntos de extensión:**
- Las constantes `NIGHTTIME_START` y `NIGHTTIME_END` son configurables en el código
- Las reglas de normalización en la DB son texto libre pensado para ser interpretado por el agente LangChain
- Se puede agregar lógica adicional (tolerancia, redondeo, etc.) en `normalizeAgainstSchedule()`

### Preliquidador (`presettlement.service.ts`)

Calcula honorarios para un agente en un período dado.

**Lógica:**
1. Recorre cada día del período
2. Para días pasados: usa `normalized_entries` (horas reales normalizadas)
3. Para días futuros o vacaciones: **proyecta** desde el esquema vigente
4. Clasifica horas: `regular_daytime`, `regular_nighttime`, `overtime_daytime`, `overtime_nighttime`, `holiday_daytime`, `holiday_nighttime`
5. Aplica la tarifa del agente para ese día/franja/tipo
6. Genera ítems automáticos: presentismo, plus vacacional (si aplica)
7. Todo es editable: horas, tarifas, ítems, montos

**Decisiones:**
- Las **ausencias** se excluyen del cálculo (no se pagan)
- Las **vacaciones** se calculan como si el agente hubiera trabajado normalmente (según esquema) + un plus vacacional opcional
- La **proyección** usa el esquema vigente al momento de generar la preliquidación
- El **recálculo** es automático: editar horas o tarifas recalcula el monto; agregar/quitar ítems recalcula el total

### Agentes LangChain

Dos agentes con patrón **ReAct** (razonamiento + acción) usando LangGraph:

#### Agente de Normalización
- **Propósito**: Ayudar al supervisor a entender y aplicar reglas de normalización
- **Herramientas**: horas trabajadas, esquema, excepciones, horas extra, reglas de normalización, lista de perfiles
- **Prompt**: Experto en normalización de horarios de call center

#### Agente de Liquidación
- **Propósito**: Asistir al liquidador consultando datos y sugiriendo ajustes
- **Herramientas**: todas las del normalizador + tarifas del agente, reglas de liquidación, detalle de preliquidaciones
- **Prompt**: Experto en liquidación de honorarios

**Herramientas disponibles (9):**

| Herramienta | Descripción |
|------------|-------------|
| `get_worked_hours` | Horas normalizadas por agente y rango |
| `get_schedule` | Esquema vigente para una fecha |
| `get_exceptions` | Excepciones en un rango |
| `get_overtime` | Horas extra en un rango |
| `get_settlement_rules` | Reglas de liquidación activas |
| `get_normalization_rules` | Reglas de normalización activas |
| `get_agent_rates` | Tarifas configuradas de un agente |
| `get_pre_settlement_detail` | Detalle completo de una preliquidación |
| `list_profiles` | Lista de todos los agentes |

---

## 5. Estructura del código

### Árbol de archivos (47 archivos fuente)

```
milchick/
├── package.json                    # Monorepo root con workspaces
├── README.md                       # Referencia rápida de API
├── SETUP.md                        # Guía paso a paso para correr local
├── ARCHITECTURE.md                 # Este archivo
│
├── shared/                         # Paquete compartido (@milchick/shared)
│   └── src/
│       ├── index.ts                # Re-exports
│       ├── types/index.ts          # Interfaces de dominio (15 tipos)
│       └── validators/index.ts     # Esquemas Zod (18 validators)
│
├── backend/                        # API REST (@milchick/backend)
│   └── src/
│       ├── index.ts                # Express app, rutas montadas
│       ├── config/supabase.ts      # Cliente Supabase admin
│       ├── middleware/auth.ts      # Auth middleware + requireRole
│       ├── routes/                 # 12 archivos de rutas
│       │   ├── auth.routes.ts
│       │   ├── profiles.routes.ts
│       │   ├── clients.routes.ts
│       │   ├── agentRates.routes.ts
│       │   ├── schedules.routes.ts
│       │   ├── clockEntries.routes.ts
│       │   ├── exceptions.routes.ts
│       │   ├── overtime.routes.ts
│       │   ├── holidays.routes.ts
│       │   ├── rules.routes.ts
│       │   ├── normalization.routes.ts
│       │   ├── preSettlements.routes.ts
│       │   └── agent.routes.ts     # Proxy al servicio LangChain
│       └── services/               # Lógica de negocio
│           ├── normalizer.service.ts
│           └── presettlement.service.ts
│
├── frontend/                       # App React (@milchick/frontend)
│   └── src/
│       ├── App.tsx                 # Router con lazy loading + AuthGuard
│       ├── main.tsx                # Entry point con QueryClientProvider
│       ├── components/layout/
│       │   ├── AppLayout.tsx       # Sidebar + Outlet
│       │   └── AuthGuard.tsx       # Protección de rutas
│       ├── lib/
│       │   ├── api.ts              # Fetch wrapper con auth headers
│       │   ├── supabase.ts         # Cliente Supabase (anon)
│       │   └── utils.ts            # cn(), formatDate(), labels
│       └── pages/                  # 12 páginas + 1 shared
│           ├── auth/LoginPage.tsx
│           ├── dashboard/DashboardPage.tsx
│           ├── agents/AgentsListPage.tsx
│           ├── agents/AgentFormPage.tsx
│           ├── clients/ClientsListPage.tsx
│           ├── clients/ClientFormPage.tsx
│           ├── schedules/ScheduleManagerPage.tsx
│           ├── clockEntries/ClockEntriesPage.tsx
│           ├── exceptions/ExceptionsPage.tsx
│           ├── normalization/NormalizationPage.tsx
│           ├── preSettlements/PreSettlementsListPage.tsx
│           ├── preSettlements/PreSettlementDetailPage.tsx
│           └── shared.tsx
│
├── agent/                          # Agentes LangChain (@milchick/agent)
│   └── src/
│       ├── index.ts                # Express server (puerto 3002)
│       ├── config/supabase.ts      # Cliente Supabase admin
│       ├── agents/index.ts         # Factory de agentes ReAct
│       └── tools/data-tools.ts     # 9 herramientas de consulta
│
└── supabase/
    └── migrations/
        └── 001_initial_schema.sql  # 14 tablas + triggers + RLS
```

---

## 6. Patrones y convenciones

### Backend

- **Rutas**: Un archivo por dominio en `routes/`. Cada router usa `authMiddleware` y `requireRole` según corresponda.
- **Validación**: Se valida con Zod (del paquete shared) antes de procesar. Si falla, se devuelve 400 con `error.flatten()`.
- **Respuestas**: 201 para creación, 204 para delete, 200 para el resto. Errores devuelven `{ error: string }`.
- **Servicios**: Solo para lógica compleja (normalización, preliquidación). Los CRUDs simples van directo en la ruta.
- **Supabase**: Se usa `supabaseAdmin` (service role key) en el backend. Bypasses RLS.

### Frontend

- **Lazy loading**: Todas las páginas se cargan con `React.lazy()` + `Suspense`.
- **Auth**: `AuthGuard` verifica la sesión de Supabase. Si no hay sesión, redirige a `/login`.
- **Layout**: `AppLayout` con sidebar fijo y `<Outlet />` para el contenido.
- **Data fetching**: `useQuery` para lecturas, `useMutation` + `queryClient.invalidateQueries` para escrituras.
- **Estilos**: TailwindCSS directo, sin componentes UI library. `cn()` de `clsx` + `tailwind-merge`.
- **Formularios**: `react-hook-form` con `zodResolver`.

### Agente LangChain

- **Patrón**: ReAct (Reasoning + Acting) via `createReactAgent` de LangGraph.
- **Herramientas**: Definidas con `tool()` de `@langchain/core/tools`, cada una con schema Zod y descripción en español.
- **Comunicación**: El backend actúa como proxy (`/api/agent/*`) hacia el servicio agent (puerto 3002).
- **Idioma**: Los prompts y respuestas están en español.

---

## 7. Roles y permisos

| Rol | Puede |
|-----|-------|
| `admin` | Todo |
| `supervisor` | Crear/editar agentes, clientes, esquemas, marcaciones, excepciones, horas extra, feriados, reglas, normalizar, preliquidar, usar agentes IA |
| `agent` | Solo ver su propio perfil y datos (por ahora, sin páginas dedicadas) |

La protección se aplica con `requireRole('admin', 'supervisor')` en las rutas que modifican datos.

---

## 8. Diferencias clave vs. Roz

| Aspecto | Roz | Milchick |
|---------|-----|----------|
| Tablas | ~30 | 14 |
| Facturación al cliente | Sí (billing runs, billing items) | No |
| Tarifas | Por cliente × tarea × franja | Por agente × día × franja |
| Tasks (tareas) | Entidad separada | No existe, relación directa agente-cliente |
| Cobertura | Dashboard de cobertura contratada vs. asignada | No |
| Escalas de antigüedad | Sí | No |
| Bandas tarifarias | rate_bands con franjas horarias | Simplificado a daytime/nighttime |
| Configuración variable | client_variable_scales, employee_variable_config | No |
| Monedas | Multi-moneda | No (moneda única) |
| Agente IA | No | Sí (LangChain, normalización + liquidación) |
| Normalizador | Implícito en clockIn/clockOut | Servicio explícito con reglas |
| i18n | Sí (i18next) | No (solo español) |

---

## 9. Cómo extender el proyecto

### Agregar una nueva entidad

1. **Shared**: Agregar interface en `shared/src/types/index.ts` y validators en `shared/src/validators/index.ts`
2. **DB**: Crear migración en `supabase/migrations/`
3. **Backend**: Crear `routes/<entity>.routes.ts`, importar y montar en `index.ts`
4. **Frontend**: Crear página en `pages/<entity>/`, agregar ruta en `App.tsx`, agregar link en `AppLayout.tsx`

### Agregar una regla de normalización programática

Editar `normalizeAgainstSchedule()` en `backend/src/services/normalizer.service.ts`. Agregar un nuevo bloque después de los Rules existentes.

### Agregar un nuevo tipo de hora a la preliquidación

1. Agregar el tipo en `HourType` en `shared/src/types/index.ts`
2. Agregar la constraint CHECK en la DB
3. Agregar la lógica de clasificación en `presettlement.service.ts`
4. Agregar el label en `HOUR_TYPE_LABELS` en `frontend/src/lib/utils.ts`

### Agregar una nueva herramienta al agente LangChain

1. Crear la herramienta en `agent/src/tools/data-tools.ts` usando `tool()` de `@langchain/core/tools`
2. Agregarla al array `allTools`
3. Los agentes la usarán automáticamente

### Agregar facturación al cliente (futuro)

El sistema fue diseñado para que esto se pueda agregar sin reestructurar:
1. Crear tablas `client_billing_rates`, `billing_runs`, `billing_items`
2. Crear un servicio `billing.service.ts` similar al preliquidador pero desde la perspectiva del cliente
3. Reutilizar `normalized_entries` como fuente de datos
4. Agregar páginas de facturación al frontend

---

## 10. Limitaciones conocidas y mejoras pendientes

### Limitaciones actuales

- **Sin tests**: No hay tests unitarios ni de integración. Prioridad para agregar.
- **Sin exports/reportes**: No hay exportación a Excel/PDF. El proyecto Roz tenía `exceljs`.
- **Normalización básica**: Solo recorta setup y ajuste a esquema. No hay tolerancias configurables, redondeo, ni lógica avanzada aún.
- **Agente LangChain sin memoria persistente**: Cada request crea un agente nuevo. No hay historial de conversación entre requests.
- **Sin websockets/real-time**: Las actualizaciones requieren refresh manual.
- **Roles del agente sin páginas**: El rol `agent` no tiene páginas dedicadas (no puede ver sus propios datos desde la UI).
- **Sin auditoría**: A diferencia de Roz que tenía `time_entry_audit_log`, no hay log de cambios.

### Mejoras sugeridas (en orden de prioridad)

1. **Tests**: Agregar vitest para backend (servicios) y playwright/cypress para frontend
2. **Exportación**: Excel y PDF para preliquidaciones
3. **Tolerancia configurable**: Minutos de tolerancia para clock-in/out en vez de solo trimear al esquema
4. **Memoria del agente**: Persistir conversaciones del LangChain con checkpointer
5. **Auditoría**: Log de cambios en marcaciones y preliquidaciones
6. **Páginas del agente**: Clock-in/out para que el agente vea su propia info
7. **Dashboard de cobertura**: Reutilizar la lógica de Roz simplificada
8. **i18n**: Si se necesita multi-idioma

---

## 11. Historial de decisiones (ADR)

| # | Decisión | Contexto | Alternativas consideradas |
|---|----------|----------|--------------------------|
| 1 | Nuevo repo desde cero | Roz era demasiado complejo para refactorizar | Refactorizar Roz, branch nuevo |
| 2 | Mismo stack (Express+React+Supabase) | El equipo ya lo conoce | Next.js, otro framework |
| 3 | LangChain.js en vez de Python | Mantener un solo lenguaje | Python (mejor ecosistema LangChain) |
| 4 | Tarifas por agente, no por cliente | La tarifa depende del agente | Tarifas por cliente, mixtas |
| 5 | Sin facturación en v1 | Foco en presentismo y liquidación | Incluir billing desde el inicio |
| 6 | Marcaciones manuales por supervisor | Los agentes no cargan su propia asistencia | Self-service, integración con softphone |
| 7 | Vacaciones se pagan como horas normales | Decisión del negocio, con plus opcional | No pagar vacaciones, tarifa especial |
| 8 | Proyección de días futuros | Permite preliquidar antes de fin de mes | Solo liquidar lo trabajado |
| 9 | Preliquidación totalmente editable | El liquidador necesita flexibilidad total | Campos bloqueados, solo override |
| 10 | Clientes simples (solo ABM) | No se necesita configuración compleja | Config de billing/rates por cliente |

---

*Documento generado el 29 de julio de 2026. Última actualización al completar la Fase 6 del proyecto.*
