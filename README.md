# Milchick

Sistema de control de presentismo y preliquidación de honorarios para call center.

## Manuales de uso

Cómo se opera el sistema, por rol:

- [Manual del agente](docs/manual-agente.md) — marcar, y nada más
- [Manual del supervisor](docs/manual-supervisor.md) — el ciclo del mes, módulo por módulo
- [Manual del administrador](docs/manual-admin.md) — altas, tarifas, esquemas y configuración
- [Cómo se calcula la liquidación](docs/como-se-calcula.md) — la referencia del motor

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
- `009` — tabla de desvíos de la preliquidación.
- `010` — período = mes calendario + conciliación del período anterior.
- `011` — el REG y el SUPER REG pasan a cargarse por agente y por mes.
- `012` — reintegro de monotributo por agente y por mes.
- `013` — tramo `normal` en las horas fuera del esquema (coberturas sin recargo).
- `014` — rastro de las correcciones en el desglose diario (horas originales, quién y cuándo).
- `015` — desvío por trabajar más horas de las que se liquidan.
- `016` — las horas cargadas por el supervisor se topean contra lo trabajado,
  con un umbral configurable.
- `017` — los ítems declaran cómo se calculan: importe fijo, porcentaje del
  subtotal, o cantidad de tiempo a un valor hora elegido.
- `018` — normalización: las correcciones del día, el horario en las excepciones
  de cambio de jornada y cobertura, las autorizaciones que se pagan sin tope, la
  compensación diaria fija, los márgenes y los avisos que frenan la confirmación.
- `019` — catálogo de conceptos de los ítems. Los conceptos que ya estaban
  cargados como texto libre pasan al catálogo —los que sólo difieren en
  mayúsculas o acentos se juntan— y quedan *a revisar* en Configuración.
  De la `009` en adelante son idempotentes.
- `008` — datos reales de operación: 3 clientes, 13 agentes con sus tarifas,
  esquemas y parámetros de liquidación, feriados, excepciones, horas adicionales
  y 721 marcaciones desde el 01/06/2026. Es idempotente.

Los agentes del `008` se crean sin contraseña: no pueden iniciar sesión hasta que
los invites desde Supabase. Una vez adentro marcan desde *Mi Portal*.

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

Validan el núcleo de cálculo de honorarios contra las liquidaciones reales de
julio y agosto 2026: cuántos días se resuelven solos, que la respuesta sugerida
coincida con lo que decidió la planilla y que el neto de cada agente cierre al
centavo. Los scripts de `validacion/` reproducen la misma comprobación partiendo de
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
- `PATCH /api/profiles/:id/email` - Cambiar el email con el que entra (administrador): `{ email }`
- `POST /api/profiles/:id/access-link` - Enlace para que el agente cree su contraseña (administrador): `{ redirect_to? }`. No manda correo: devuelve el enlace

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
- `GET /api/schedules/suggestions?from=&to=` - Esquemas que parecen desactualizados (por defecto, las últimas ocho semanas)
- `POST /api/schedules/apply-suggestion` - Cerrar el esquema de un día de la semana y crear el nuevo desde una fecha

### Clock Entries (Marcaciones)
- `GET /api/clock-entries/profile/:profileId?from=&to=` - Listar
- `POST /api/clock-entries` - Crear
- `POST /api/clock-entries/bulk` - Crear en lote

### Exceptions (Excepciones)
- `GET /api/exceptions/profile/:profileId?from=&to=&type=` - Listar
- `POST /api/exceptions` - Crear (cambio de jornada y cobertura aceptan `blocks`, el horario del día)
- `PATCH /api/exceptions/:id` · `DELETE /api/exceptions/:id`

### Overtime (Horas autorizadas)
- `GET /api/overtime/profile/:profileId?from=&to=` - Listar
- `POST /api/overtime` - Crear (`uncapped: true` se paga aunque la marcación no lo respalde)
- `PATCH /api/overtime/:id` · `DELETE /api/overtime/:id`

### Holidays (Feriados)
- `GET /api/holidays?year=` - Listar
- `POST /api/holidays` - Crear
- `PATCH /api/holidays/:id` · `DELETE /api/holidays/:id`

Todo cambio en excepciones, horas autorizadas, feriados, tarifas, esquemas,
marcaciones cargadas por un supervisor, evaluación mensual, agentes y
configuración recalcula las preliquidaciones en borrador afectadas.

### Rules (Reglas)
- `GET /api/rules/normalization` - Reglas de normalización
- `GET /api/rules/settlement` - Reglas de liquidación
- `POST /api/rules/normalization` - Crear regla
- `POST /api/rules/settlement` - Crear regla

### Normalization (Normalización)
- `GET /api/normalization/queue?from=&to=` - La bandeja: días que no cierran, por agente, con la resolución sugerida
- `POST /api/normalization/resolve` - Resolver un día (`plan`, `marks`, `custom`, `none`, `authorize`, `pay_authorized`)
- `POST /api/normalization/resolve-bulk` - Resolver varios días de una (aceptar las sugeridas)
- `GET /api/normalization/corrections?from=&to=&profile_id=` - Correcciones aplicadas
- `DELETE /api/normalization/corrections/:id` - Deshacer una corrección y lo que tocó

### Pre-Settlements (Preliquidación)
- `GET /api/pre-settlements` - Listar
- `GET /api/pre-settlements/period?year=&month=` - Período de un mes según el día de corte
- `GET /api/pre-settlements/period/to-close` - El mes que toca cerrar: el último período terminado
- `GET /api/pre-settlements/close?year=&month=` - Estado del cierre del mes, paso por paso
- `POST /api/pre-settlements/close/confirm-ready` - Confirmar las preliquidaciones listas del mes
- `POST /api/pre-settlements/refresh` - Recalcular los borradores (trae las marcaciones nuevas)
- `POST /api/pre-settlements/:id/recalculate` - Recalcular un borrador
- `PUT /api/pre-settlements/:id/days/:date` - Fijar las horas de un día (corrección manual)
- `GET /api/pre-settlements/periods` - Períodos que ya tienen preliquidaciones
- `GET /api/pre-settlements/summary?from=&to=` - Resumen por agente del período
- `GET /api/pre-settlements/summary?from=&to=&format=csv` - El mismo resumen en CSV
- `POST /api/pre-settlements/generate-bulk` - Generar el período para varios agentes
- `PATCH /api/pre-settlements/warnings/:id` - Revisar un desvío
- `POST /api/pre-settlements/:id/daily` - Agregar una línea diaria a mano
- `DELETE /api/pre-settlements/daily/:lineId` - Borrar una línea agregada a mano
- `POST /api/pre-settlements/generate` - Generar nueva
- `GET /api/pre-settlements/:id` - Detalle con desglose
- `PATCH /api/pre-settlements/daily/:lineId` - Editar línea diaria
- `POST /api/pre-settlements/:id/items` - Agregar ítem
- `PATCH /api/pre-settlements/items/:itemId` - Editar ítem
- `DELETE /api/pre-settlements/items/:itemId` - Eliminar ítem
- `PATCH /api/pre-settlements/:id/status` - Confirmar/cancelar

### Item Concepts (catálogo de conceptos de los ítems)
- `GET /api/item-concepts` - Los activos, para elegir al cargar un ítem
- `GET /api/item-concepts?all=1` - Todos, con cuántos ítems usa cada uno
- `POST /api/item-concepts` - Alta. El supervisor —o con `from_settlement: true`— da de alta sólo el nombre y queda a revisar; si el nombre ya existe devuelve 409 con el existente
- `PATCH /api/item-concepts/:id` - Editar, confirmar, desactivar o reactivar (administrador)
- `POST /api/item-concepts/:id/merge` - Unificar con otro: `{ into_id }` (administrador)

### Period Params (Evaluación mensual)
- `GET /api/period-params?year=&month=` - REG, SUPER REG y reintegro de monotributo del mes
- `PUT /api/period-params` - Guardar la evaluación del mes

### Settings (Configuración global)
- `GET /api/settings` - Multiplicadores y período
- `PUT /api/settings/rate-factors` - Actualizar multiplicadores
- `PUT /api/settings/period` - Día de corte, umbral y márgenes de normalización

### Dashboard
- `GET /api/dashboard/summary` - Pendientes: días a normalizar por mes, quién no marcó, config incompleta

### Agent Chat (Agentes IA)
- `POST /api/agent/normalization` - Chat con agente de normalización
- `POST /api/agent/settlement` - Chat con agente de liquidación
