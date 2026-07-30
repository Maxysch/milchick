# Milchick — Guía paso a paso para correr el proyecto en local

## Requisitos previos

- **Node.js** v20 o superior
- **npm** v10 o superior
- Una cuenta en [Supabase](https://supabase.com) (plan gratuito alcanza)
- *(Opcional)* Una API key de [OpenAI](https://platform.openai.com) para los agentes LangChain

---

## Paso 1 — Clonar el repositorio

```bash
git clone <url-del-repo>
cd milchick
```

---

## Paso 2 — Instalar dependencias

Desde la raíz del proyecto:

```bash
npm install
```

Esto instala las dependencias de los 4 workspaces: `shared`, `backend`, `frontend` y `agent`.

---

## Paso 3 — Crear el proyecto en Supabase

1. Ir a [app.supabase.com](https://app.supabase.com) y crear un nuevo proyecto.
2. Elegir una región cercana y definir la contraseña de la base de datos.
3. Esperar a que el proyecto se inicialice (~2 minutos).

### Obtener las credenciales

En **Project Settings > API** copiar:

| Variable | Dónde encontrarla |
|----------|------------------|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_ANON_KEY` | `anon` / `public` key |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` key (⚠️ secreta, no exponer al frontend) |

---

## Paso 4 — Ejecutar la migración de base de datos

1. En Supabase, ir a **SQL Editor**.
2. Crear un nuevo query.
3. Pegar el contenido completo de `supabase/migrations/001_initial_schema.sql`.
4. Ejecutar (Run).

Esto crea las 14 tablas necesarias, triggers, índices y políticas RLS.

---

## Paso 5 — Configurar variables de entorno

### Backend (`backend/.env`)

```bash
cp backend/.env.example backend/.env
```

Editar `backend/.env`:

```env
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
PORT=3001
```

### Frontend (`frontend/.env`)

```bash
cp frontend/.env.example frontend/.env
```

Editar `frontend/.env`:

```env
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...
```

### Agente LangChain (`agent/.env`) — *Opcional*

```bash
cp agent/.env.example agent/.env
```

Editar `agent/.env`:

```env
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
AGENT_PORT=3002
```

> Si no tenés API key de OpenAI, podés usar el sistema sin los agentes de IA. El resto del proyecto funciona normalmente.

---

## Paso 6 — Crear el primer usuario

Supabase no tiene usuarios por defecto. Tenés dos opciones:

### Opción A — Desde la UI de Supabase (recomendado)

1. Ir a **Authentication > Users** en el dashboard de Supabase.
2. Click en **Add user > Create new user**.
3. Ingresar email y contraseña. Marcar "Auto Confirm User".
4. Una vez creado, ir a **Table Editor > profiles** y editar el registro que se creó automáticamente:
   - `first_name`: tu nombre
   - `last_name`: tu apellido
   - `role`: cambiar a `admin`

### Opción B — Desde el SQL Editor

```sql
-- Crear usuario (reemplazar email y contraseña)
-- Nota: Supabase no permite crear usuarios directamente por SQL.
-- Usar la opción A o la API de Supabase.
```

---

## Paso 7 — Levantar los servicios

### Solo Backend + Frontend (lo mínimo):

```bash
npm run dev
```

Esto levanta:
- **Backend** en `http://localhost:3001`
- **Frontend** en `http://localhost:5173`

### Con el agente LangChain:

```bash
npm run dev:all
```

Esto levanta además:
- **Agent** en `http://localhost:3002`

### Levantar servicios individuales:

```bash
npm run dev:backend    # Solo backend (puerto 3001)
npm run dev:frontend   # Solo frontend (puerto 5173)
npm run dev:agent      # Solo agente  (puerto 3002)
```

---

## Paso 8 — Acceder a la aplicación

Abrir el navegador en:

```
http://localhost:5173
```

Iniciar sesión con el email y contraseña del usuario creado en el Paso 6.

---

## Paso 9 — Primeros pasos en la aplicación

Una vez adentro, el flujo típico es:

1. **Crear clientes** — Ir a "Clientes" y cargar los clientes del call center.
2. **Crear agentes** — Ir a "Agentes" y dar de alta a los agentes. Configurar sus tarifas por hora.
3. **Cargar esquemas** — Ir a "Esquemas", seleccionar un agente y definir su cronograma semanal con los clientes asignados.
4. **Cargar feriados** — (Opcional) Cargar los feriados del año.
5. **Cargar marcaciones** — Ir a "Marcaciones" y cargar las entradas/salidas de los agentes.
6. **Cargar excepciones** — Registrar vacaciones, ausencias, horas extra.
7. **Normalizar** — Ir a "Normalización", seleccionar agente y período, previsualizar y ejecutar.
8. **Preliquidar** — Ir a "Preliquidación", generar una nueva, revisar el desglose, ajustar si es necesario, y confirmar.

---

## Solución de problemas

### "Cannot find module" al iniciar el backend

```bash
npm install
```

### El frontend no conecta con el backend

Verificar que el backend esté corriendo en el puerto 3001. El frontend tiene configurado un proxy en `vite.config.ts` que redirige `/api` a `http://localhost:3001`.

### Error de autenticación

- Verificar que las variables de entorno estén correctas.
- Verificar que el usuario fue creado con "Auto Confirm" activado.
- Verificar que el perfil tenga `role` = `admin` o `supervisor`.

### El agente LangChain no responde

- Verificar que `OPENAI_API_KEY` sea válida.
- Verificar que el servicio `agent` esté corriendo (puerto 3002).
- El backend tiene una variable `AGENT_SERVICE_URL` (default: `http://localhost:3002`). Si cambiaste el puerto, actualizala en `backend/.env`.

### Error al ejecutar la migración

- Asegurarte de ejecutar el SQL completo sin recortar.
- Si falla por la función `handle_new_user` que referencia `auth.users`, es normal: esa tabla existe siempre en Supabase.

---

## Estructura de puertos

| Servicio | Puerto | Descripción |
|----------|--------|-------------|
| Backend  | 3001   | API REST (Express) |
| Frontend | 5173   | App React (Vite dev server) |
| Agent    | 3002   | Agentes LangChain |

---

## Scripts disponibles

| Comando | Descripción |
|---------|-------------|
| `npm run dev` | Backend + Frontend |
| `npm run dev:all` | Backend + Frontend + Agent |
| `npm run dev:backend` | Solo backend |
| `npm run dev:frontend` | Solo frontend |
| `npm run dev:agent` | Solo agente |
| `npm run build` | Build de producción (todos) |
| `npm run typecheck` | Verificar tipos TypeScript |
