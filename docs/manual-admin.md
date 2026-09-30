# Manual del administrador

Hacés todo lo del [manual del supervisor](manual-supervisor.md) —ese es el día a
día— y además configurás lo que el sistema usa para calcular.

Dentro de la aplicación las dos funciones son casi idénticas: **lo único
exclusivo del administrador es borrar clientes.** La diferencia real está en las
tareas de abajo, que nadie más debería tocar.

Los cambios en agentes, tarifas, esquemas, feriados y configuración
**recalculan solos** las preliquidaciones en borrador. Las confirmadas no se
tocan.

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
| **Fecha de ingreso** | La antigüedad, y desde cuándo rige el esquema (ver abajo) |
| **Tarifa base por hora** + vigencia desde | Lo que cobra |
| Parámetros de liquidación | Ver abajo |
| **Compensación diaria fija** | Minutos que se pagan cada día trabajado, además del plan |

> Si en cambio invitás a alguien desde Supabase, el perfil se crea solo pero
> **siempre con rol `agent`**. Hay que corregírselo a mano. Si alguien entra y no
> ve el menú que debería, casi siempre es esto.

### La fecha de ingreso importa

- **Antes de esa fecha el esquema no rige**: no se paga nada por esquema. Si hubo
  capacitación previa al alta, se carga como excepción con horario.
- **Las primeras dos semanas se revisan siempre**: todos los días que no cierran
  van a la bandeja, sin sugerencia y aunque sea un olvido de marcación. La
  inducción no sigue el esquema: en agosto, los cinco ingresos del 07/08
  tuvieron sus dos primeras semanas distintas del plan. Los días se ajustan en
  *Configuración*.

### La compensación diaria fija

Para acuerdos del tipo "se le pagan 45 minutos más por día". Minutos por día y la
banda a la que se pagan. Entran al subtotal —el REG, el SUPER REG, la antigüedad
y el reintegro de equipos se calculan encima— y no se pagan en feriados,
licencias ni ausencias.

## Parámetros de liquidación del agente

Son los valores **por defecto** del agente:

- Gestión de personas, Cuantitativo, Cualitativo — los tres componentes del REG
- Reintegro por uso de equipos — % sobre el subtotal
- Meses de antigüedad reconocidos
- Factor de compensación por feriado
- Factor de plus vacacional

> El REG, el SUPER REG y el monotributo que se liquidan **no** salen de acá: salen
> de *Evaluación mensual*, mes a mes. Lo de acá es la red para un mes sin cargar.

---

# Configurar los módulos

## Tarifas

Cada agente tiene **una sola tarifa base por hora**. Todo lo demás son
multiplicadores globales que el sistema aplica solo.

Las tarifas tienen **vigencia desde**: un aumento se carga como tarifa nueva, no
editando la anterior. Así los meses ya liquidados conservan lo que se pagó.

## Esquemas

La pantalla muestra **la semana** del agente: una fila por día, con cada bloque
ubicado en su horario sobre una línea de 6 a 24. El fondo marca la banda de cada
hora —nocturna LD, diurna y nocturna HD—, así se ve qué parte de un horario va
con recargo. **Semana vigente al** muestra el esquema que regía una fecha dada, y
debajo, la tabla de **Bloques** con su vigencia y su estado (vigente, empieza más
adelante, terminó).

| Para… | Usá |
|---|---|
| Cargar un horario | **Agregar bloques**: el mismo bloque en varios días de una ("Lunes a viernes") |
| Un horario que cambia desde un día | **Cambiar desde una fecha** (o tocar el bloque): el vigente se cierra el día anterior y el nuevo rige desde ahí |
| Un error de carga | **Corregir**: cambia el bloque en toda su vigencia |
| Un día puntual distinto | Una excepción con horario, no el esquema |

- **Jornada partida** → un bloque por tramo, no uno solo de punta a punta. Los
  márgenes se miden tramo por tramo.
- **Dos bloques del mismo día no se pueden pisar**: el sistema no deja guardarlo,
  porque esas horas se pagarían dos veces.

> Un esquema desactualizado es la causa número uno de días a normalizar: el
> agente marca bien, pero contra un horario que ya no es el suyo, y el mismo día
> cae en la bandeja todas las semanas.

### Las sugerencias de esquema

Arriba de *Esquemas* aparece **"N esquemas parecen desactualizados"** cuando el
sistema encuentra un agente que, el mismo día de la semana, marcó distinto a su
esquema casi todas las semanas de las últimas ocho.

Cada sugerencia muestra el esquema actual, cuántas semanas marcó distinto, el
horario sugerido y **cuántos días a normalizar se evitan**. Sólo se propone si el
horario nuevo al menos reduce esos días a la mitad.

- Revisá el horario —se puede ajustar antes de aplicarlo: la sugerencia sale de
  lo marcado, el acuerdo lo decidís vos— y la fecha **Desde**.
- **Aplicar** cierra el esquema actual el día anterior y crea el nuevo. Los meses
  ya liquidados no cambian; los borradores se recalculan.
- La **X** la ignora por ahora.

Sobre julio 2026 propuso tres cambios: el jueves de un agente (de 08:00–12:00 a
08:00–13:00) y el lunes y martes de otro. En agosto, con horarios más
irregulares, ninguno.

## Clientes

Alta y edición. Borrar es exclusivo del administrador, pero **conviene desactivar
en vez de borrar**: hay liquidaciones viejas que referencian al cliente.

## Configuración

### Multiplicadores y período

| Qué | Efecto |
|---|---|
| **Multiplicadores** — nocturno, HD, adicional, extras | Afectan **todos** los cálculos. Tocalos sólo si cambió el acuerdo |
| **Día de corte** | En qué día arranca el período. Con `1`, mes calendario |

Los multiplicadores por defecto son: nocturno 1,13 · HD 1,0125 · adicional 1,25 ·
extra 50% 1,5 · extra 100% 2,0.

### Normalización

Deciden qué día se paga solo y cuál va a la bandeja.

| Qué | Por defecto | Qué hace |
|---|---|---|
| **Llegó tarde** | 20 min | Tolerancia al entrar a cada tramo |
| **Se fue antes** | 20 min | Tolerancia al salir de cada tramo |
| **Trabajó de más** | 30 min | Por encima de esto se revisa, y es el mínimo para pagar horas autorizadas. Cuenta lo de antes de entrar más lo de después de salir |
| **Un día sin ninguna marcación se revisa** | Apagado | Apagado, se paga el plan y queda un aviso |
| **Un ingreso sin egreso se revisa** | Apagado | Mismo criterio, para las marcaciones a medias |
| **Agentes nuevos: se revisa todo durante** | 14 días | Desde la fecha de ingreso |

Los valores salen de las liquidaciones reales de julio y agosto 2026:

- En los agentes con antigüedad, la planilla pagó el plan **en todos** los días
  sin marcación o con la marcación a medias: siempre fue un olvido. Por eso esos
  días no frenan.
- De los días con 30 a 45 minutos de más, la planilla pagó algo extra sólo en 2
  de 32. **Subir *Trabajó de más* a 45** saca esos días de la bandeja; queda en 30
  hasta que lo decidas.

### Conceptos de los ítems

La lista de la que se eligen los ítems al liquidar. Evita que el mismo concepto
aparezca escrito de tres formas y que el resumen del mes lo sume en tres columnas.

| Acción | Qué hace |
|---|---|
| **Agregar concepto** | Nombre, cómo se calcula —importe fijo, porcentaje del subtotal o por tiempo a valor hora— y los valores por defecto, que se completan solos al elegirlo en un ítem. Si el nombre se parece a uno que ya existe, avisa |
| **Editar** | Nombre, valores por defecto, descripción y orden. No toca los ítems ya cargados: los valores por defecto son para los nuevos |
| **Desactivar** | Sale de la lista para elegir; los ítems que ya lo usan lo conservan. **Reactivar** lo devuelve. Nada se borra |
| **Confirmar** | Para los *a revisar*: queda como está |
| **Unificar con…** | Sus ítems pasan al otro concepto y este deja de existir. Primero se ofrecen los parecidos. Lo confirmado conserva el nombre con que se confirmó: sólo cambia en qué columna suma |

**A revisar** son los que se crearon al liquidar, sólo con el nombre. Cuando hay,
aparece un aviso arriba de la lista. Para cada uno: confirmalo si está bien,
editalo para completarle los valores, o unificalo si ya existía con otro nombre.

Los **del sistema** —REG, SUPER REG, antigüedad, equipos, feriado, vacaciones,
monotributo— los calcula el motor: se les cambia el nombre, la descripción y el
orden, pero no se desactivan ni se unifican.

El catálogo lo edita el administrador. El supervisor lo ve y, al liquidar, puede
crear el concepto que falte; ése queda a revisar. El **orden** es también el de
las columnas del resumen en CSV: primero los del sistema, después los demás.

## Feriados

Nombre, fecha y tipo —nacional o de la empresa—, y un selector de año para ver
los cargados.

Un feriado no trabajado **no paga horas**: las del esquema pasan a la
*compensación por feriado no trabajado*. Si un agente trabajó ese día, se le
carga una excepción de **cobertura extraordinaria**.

> **Si falta un feriado, ese día se liquida como día normal.** Conviene cargar el
> año entero de una vez, apenas salen las fechas.

---

# Mantenimiento

- **Migraciones** — los `.sql` de `supabase/migrations/` se corren en orden desde
  el SQL Editor de Supabase. Una migración ya aplicada **no se edita**: si hay que
  cambiar algo, va una nueva. La `018_normalizacion.sql` y la
  `019_conceptos.sql` se pueden volver a correr sin romper nada.
- **Deploy** — ver [DEPLOY.md](../DEPLOY.md). Cada push a `main` publica.
- **Si algo no responde** — abrí `/api/health`. Dice si el servidor está vivo, si
  llega a la base y contra qué proyecto. Es el primer lugar donde mirar.
- **La hora** — las marcaciones del portal se registran con la hora de Buenos
  Aires, esté donde esté el servidor. Si la operación estuviera en otra zona, se
  cambia con la variable `APP_TIMEZONE`.

---

# Checklist de fin de mes

Antes de cerrar (el paso 1 de *Cierre del mes* muestra casi todo esto):

- [ ] **Agentes sin esquema** y **Agentes sin tarifa** en cero
- [ ] Las altas del mes tienen **fecha de ingreso**, tarifa y esquema
- [ ] Los cambios de horario se cargaron con **Cambiar desde una fecha**, no editando el vigente
- [ ] Revisaste las **sugerencias de esquema**
- [ ] Los feriados del mes están cargados en **Feriados**
- [ ] No quedan conceptos **a revisar** en *Configuración → Conceptos de los ítems*
- [ ] La **Evaluación mensual** está completa para todos
