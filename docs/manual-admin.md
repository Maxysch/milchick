# Manual del administrador

Hacés todo lo del [manual del supervisor](manual-supervisor.md) —ese es el día a
día— y además configurás lo que el sistema usa para calcular.

Dentro de la aplicación las dos funciones son casi idénticas: **lo único
exclusivo del administrador es borrar clientes.** La diferencia real está en las
tareas de abajo, que nadie más debería tocar.

---

# Dar de alta gente

## Agentes → nuevo agente

El alta se hace acá, no en Supabase. El formulario crea el usuario y el perfil de
una:

| Campo | Para qué |
|---|---|
| Legajo, nombre, apellido, email | Identificación |
| Contraseña | La inicial. Conviene que la cambie después |
| **Rol** | Agente, Supervisor o Admin |
| Fecha de ingreso | De acá salen los meses de antigüedad |
| **Tarifa base por hora** + vigencia desde | Lo que cobra |
| Parámetros de liquidación | Ver abajo |

> Si en cambio invitás a alguien desde Supabase, el perfil se crea solo pero
> **siempre con rol `agent`**. Hay que corregírselo a mano. Si alguien entra y no
> ve el menú que debería, casi siempre es esto.

## Parámetros de liquidación del agente

Son los valores **por defecto** del agente:

- Gestión de personas, Cuantitativo, Cualitativo — los tres componentes del REG
- Reintegro por uso de equipos — % sobre el subtotal
- Factor de compensación por feriado
- Factor de plus vacacional

> El REG, el SUPER REG y el monotributo que se liquidan **no** salen de acá: salen
> de *Evaluación mensual*, mes a mes. Lo de acá es la red para un mes sin cargar.

---

# Configurar los módulos

## Tarifas

Cada agente tiene **una sola tarifa base por hora**. Todo lo demás son
multiplicadores globales que el sistema aplica solo.

> Si a un agente le figuran valores base distintos según la fecha sin que haya
> habido un aumento, es un error de carga, no una situación válida.

Las tarifas tienen **vigencia desde**: un aumento se carga como tarifa nueva, no
editando la anterior. Así los meses ya liquidados conservan lo que se pagó.

## Esquemas

Los bloques de cada agente por día de la semana, con cliente y vigencia.

- **Jornada partida** → un bloque por tramo, no uno solo de punta a punta.
- **Cambio de horario** → cerrá el esquema viejo con fecha de fin y creá uno
  nuevo. No edites el vigente.

> Un esquema desactualizado es la causa número uno de diferencias, y es
> silenciosa: como se paga el esquema, nadie se entera hasta que alguien compara
> con las marcaciones. El aviso **"Trabajó de más"** repetido todas las semanas en
> el mismo día de la semana es la señal típica.

## Clientes

Alta y edición. Borrar es exclusivo del administrador, pero **conviene desactivar
en vez de borrar**: hay liquidaciones viejas que referencian al cliente.

## Configuración

| Qué | Efecto |
|---|---|
| **Multiplicadores** — nocturno, HD, adicional, extras | Afectan **todos** los cálculos futuros. Tocalos sólo si cambió el acuerdo |
| **Día de corte** | En qué día arranca el período. Con `1`, mes calendario |
| **Umbral de minutos** | Cuánto hay que trabajar de más para que las horas adicionales se paguen. Por defecto 30 |

Los multiplicadores por defecto son: nocturno 1,13 · HD 1,0125 · adicional 1,25 ·
extra 50% 1,5 · extra 100% 2,0.

## Normalización

Las reglas que ajustan las marcaciones crudas: recortan lo marcado antes de entrar
y después de salir contra el esquema, y separan diurnas de nocturnas.

> **No alimenta la liquidación.** La preliquidación lee las marcaciones crudas.
> Quedó como herramienta de revisión del modelo anterior, cuando se pagaba lo
> marcado.

## Feriados

**No tienen pantalla todavía.** El sistema los usa —un feriado no trabajado no
paga horas y genera la compensación— pero hoy se cargan por base de datos:

```sql
insert into holidays (date, name) values ('2026-08-17', 'Paso a la Inmortalidad del Gral. San Martín');
```

Conviene cargar el año entero de una. **Si falta un feriado, ese día se liquida
como día normal.**

---

# Mantenimiento

- **Migraciones** — los `.sql` de `supabase/migrations/` se corren en orden desde
  el SQL Editor de Supabase. Una migración ya aplicada **no se edita**: si hay que
  cambiar algo, va una nueva.
- **Deploy** — ver [DEPLOY.md](../DEPLOY.md). Cada push a `main` publica.
- **Si algo no responde** — abrí `/api/health`. Dice si el servidor está vivo, si
  llega a la base y contra qué proyecto. Es el primer lugar donde mirar.

---

# Checklist de fin de mes

Antes de que se generen las preliquidaciones:

- [ ] **Agentes sin esquema** y **Agentes sin tarifa** en cero
- [ ] Las altas y bajas del mes están cargadas, con sus vigencias
- [ ] Los cambios de horario se cargaron como esquema nuevo, no editando el viejo
- [ ] Los feriados del mes están en la base
- [ ] La **Evaluación mensual** está completa para todos
