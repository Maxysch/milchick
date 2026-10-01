# Milchick — Deploy

Todo en **un solo proyecto de Vercel**: el frontend como sitio estático y el
backend como función. La base sigue en Supabase y no se mueve.

Que compartan dominio simplifica dos cosas que separados hay que configurar a
mano: el frontend pide `/api` relativo, así que no hace falta `VITE_API_URL`, y
como no hay cross-origin tampoco hace falta `CORS_ORIGIN`.

| Pieza | Dónde | Qué necesita |
|---|---|---|
| `frontend` | Vercel (estático) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |
| `backend` | Vercel (función en `api/`) | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| `supabase` | Supabase | ya está |
| `agent` | — | no se deploya por ahora |

El servicio de agentes queda afuera a propósito: necesita una API key de OpenAI
que se paga aparte, y sin él la app funciona entera salvo los dos chats, que
devuelven *"Agent service unavailable"*.

---

## Cómo está armado

`vercel.json` deja el reparto resuelto, pero conviene saber qué hace cada cosa:

- **`installCommand`** instala y **compila `shared`**. Va en el install y no en
  el build porque la función de `api/` importa ese paquete, y Vercel la arma
  por su cuenta: si `shared/dist` no existiera en ese momento, el bundle de la
  función fallaría.
- **`buildCommand`** compila el frontend a `frontend/dist`, que es lo que
  Vercel publica.
- **`api/index.ts`** es la API entera. Vercel no mantiene un proceso
  escuchando un puerto: invoca ese archivo una vez por request. Por eso la app
  de Express vive en `backend/src/app.ts` sin `listen`, y el archivo de `api/`
  sólo la expone.
- **La reescritura de `/api/*`** manda todo a esa función y le adjunta la ruta
  original en `__ruta`, que el handler le devuelve a Express antes de pasarle
  la request. No se usa la convención de archivos de Vercel a propósito: un
  catch-all `api/[...path].ts` matcheaba **un solo segmento**, así que
  `/api/health` llegaba y `/api/auth/me` moría en un NOT_FOUND del propio
  Vercel, antes de tocar la app.
- **La reescritura** manda a `index.html` cualquier ruta que no sea de la API
  ni un archivo del build. Sin eso, entrar directo a `/pre-settlements` —o
  recargar la página— da 404.

---

## Paso 1 — Crear el proyecto

1. En [vercel.com/new](https://vercel.com/new), importar el repo.
2. Vercel lee `vercel.json`: el comando de build, la carpeta a publicar y el
   ruteo ya vienen resueltos. No hace falta tocar nada de eso.
3. Cargar las cuatro variables antes del primer deploy:

   | Variable | De dónde sale |
   |---|---|
   | `VITE_SUPABASE_URL` | Supabase → Project Settings > API → Project URL |
   | `VITE_SUPABASE_ANON_KEY` | la misma pantalla, key `anon` / `public` |
   | `SUPABASE_URL` | el mismo Project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | la misma pantalla, `service_role` |

4. Deployar.

> ⚠️ **La `service_role` key saltea RLS por completo.** Va sin prefijo, para que
> la lea la función y nadie más. Nunca como `VITE_SUPABASE_SERVICE_ROLE_KEY`:
> todo lo que empieza con `VITE_` queda adentro del bundle que descarga el
> navegador, y eso le daría a cualquiera acceso total a la base.

Las dos `VITE_` se leen **en el build**, no en runtime: si se cambian después,
hay que volver a deployar para que tomen el valor nuevo. Las otras dos las lee
la función en cada invocación, así que alcanza con redeployar para refrescarlas.

La hora de las marcaciones y el "hoy" del sistema son los de Buenos Aires aunque
la función corra en UTC. Sólo si la operación estuviera en otra zona hace falta
una quinta variable, `APP_TIMEZONE` (por ejemplo `America/Montevideo`).

---

## Paso 2 — Configurar el acceso en Supabase

Para que los agentes puedan crear o recuperar su contraseña, en Supabase →
**Authentication → URL Configuration**:

| Campo | Qué poner |
|---|---|
| **Site URL** | La dirección de la app, por ejemplo `https://<tu-proyecto>.vercel.app` |
| **Redirect URLs** | `https://<tu-proyecto>.vercel.app/reset-password` |

Sin esto, el enlace igual funciona —la app detecta la sesión de recuperación y
lleva a elegir la contraseña—, pero conviene tenerlo bien.

**Los correos de Supabase no son confiables en el plan gratuito.** El servicio de
correo de fábrica manda muy pocos por hora y, en proyectos nuevos, sólo a
direcciones del equipo. Por eso el administrador puede **generar el enlace a
mano** en *Agentes → (el agente) → Acceso* y pasárselo por WhatsApp: no depende de
ningún correo. El "¿Olvidaste tu contraseña?" del login sí manda un correo; para
que llegue a cualquiera hay que configurar un SMTP propio en **Authentication →
Emails → SMTP Settings**.

Un enlace vale una vez y dura una hora (**Authentication → Sessions**, o
*Emails → OTP Expiration*).

---

## Paso 3 — Verificar

1. `https://<tu-proyecto>.vercel.app/api/health` tiene que devolver
   `{"status":"ok",...}`. Si eso anda, la función está viva.
2. Entrar al sitio e iniciar sesión. El login va directo del navegador a
   Supabase, sin pasar por la función: si anda, las dos `VITE_` están bien.
3. Abrir el Dashboard. Si carga datos, la función está hablando con Supabase.
4. Recargar la página estando en `/pre-settlements`. Si da 404, el problema es
   la reescritura; si carga, el ruteo del cliente está bien.

---

## Lo que hay que saber

**El plan Hobby de Vercel no permite uso comercial.** Para probar y pilotear
está bien; el día que esto reemplace a la planilla en serio, o se pasa a Pro, o
se mueve a un host que sí lo permita gratis. Para eso quedaron en el repo
`netlify.toml` y `render.yaml`, que arman la variante separada —frontend en
Netlify, backend en Render— sin tocar una línea de código: sólo hay que cargar
`VITE_API_URL` con la URL del backend y `CORS_ORIGIN` con la del frontend.

**Las funciones tienen un tope de duración.** La generación masiva de
preliquidaciones recorre agente por agente, y con la nómina completa puede
acercarse al límite del plan. El síntoma es claro: la request muere con un
error de timeout a los pocos segundos, siempre en el mismo endpoint. Se arregla
subiendo `maxDuration` de la función en `vercel.json` —hasta donde el plan
permita— o generando por tandas.

**La primera request después de un rato es más lenta.** La función arranca en
frío. Son segundos, no el medio minuto de un servidor que se apaga, pero se
nota.

**Supabase pausa el proyecto** después de varios días sin actividad. Si la app
se usa a diario no molesta; si se usa sólo para liquidar una vez por mes, hay
riesgo de encontrar la base dormida justo cuando hace falta.

---

## Desarrollo local

No cambia nada de lo de siempre:

```bash
npm run dev
```

Lo único nuevo es que `shared` se compila antes de arrancar y queda en watch,
porque ahora se consume compilado en lugar de como TypeScript crudo. Eso es lo
que permite que Node, esbuild y el bundler de Vercel lo resuelvan igual que
cualquier otra dependencia.
