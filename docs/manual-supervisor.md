# Manual del supervisor

## Lo único que hay que entender antes de empezar

**Se paga el esquema. Las marcaciones avisan.**

El sistema liquida las horas del esquema de cada agente. Las marcaciones no pagan
solas: sirven para detectar que algo no coincide y avisarte.

Consecuencia práctica: **una diferencia que no cargás, no se paga.** Tu trabajo
durante el mes es cargar lo que se salió del esquema.

El detalle completo del cálculo está en [Cómo se calcula](como-se-calcula.md).

---

# Los módulos

## Inicio

Tu tablero. Lo mirás cada día, lleva dos minutos.

| Tarjeta | Qué hacer |
|---|---|
| **No marcaron hoy** | Preguntar hoy, mientras se acuerdan |
| **Marcaciones sin cerrar** | Alguien marcó ingreso y no egreso: cerrarlo |
| **Desvíos sin revisar** | Avisos pendientes de las preliquidaciones abiertas |
| **Preliquidaciones en borrador** | Lo que falta confirmar |
| **Agentes sin esquema / sin tarifa** | Tiene que estar en cero: así no se puede liquidar |

## Marcaciones

Todas las marcaciones, filtrables por agente y por fechas. Acá corregís lo que el
agente no pudo: un ingreso olvidado, un egreso que quedó abierto.

- **Carga individual** — un agente, una fecha, ingreso y egreso.
- **Carga masiva** — varios días de una, para reponer un período entero.

Los agentes marcan solos desde su portal. Lo que cargás acá es la excepción, no la
regla, y conviene dejar una nota diciendo por qué.

> Las marcaciones **no pagan**: alimentan los avisos y el tope de las horas
> adicionales. Corregirlas bien es lo que hace que el sistema detecte las
> diferencias reales.

## Excepciones

Dos cosas distintas en la misma pantalla.

### Excepciones — qué clase de día fue

Se cargan con agente, tipo, **desde/hasta** y una nota. La cobertura
extraordinaria lleva además el cliente. **No llevan horas**: definen la naturaleza
del día, las horas las sigue poniendo el esquema.

| Tipo | Efecto |
|---|---|
| **Ausencia** | El día no se paga |
| **Vacaciones** | Paga según esquema y suma al plus vacacional |
| **Licencia paga** | Paga según esquema, sin plus vacacional |
| **Cobertura extraordinaria** | En un feriado, lo convierte en día trabajado |
| **Cambio de jornada** | Deja constancia. **No modifica las horas** |

Cargalas **antes** de generar la preliquidación: si el día ya se liquidó, hay que
regenerar o corregirlo a mano.

### Horas fuera del esquema — lo que se trabajó de más

Fecha, cantidad de horas, opcionalmente inicio y fin, cliente y nota. Y sobre todo
**el tramo**:

| Tramo | Se paga |
|---|---|
| Sin recargo | tarifa común |
| Adicional | × 1,25 |
| Extra 50% | × 1,50 |
| Extra 100% | × 2,00 |

> **Elegir mal el tramo es el error más caro del sistema.** Una hora cargada como
> Extra 100% en vez de Adicional se paga al doble.

**Se topean contra lo trabajado.** Lo que cargás es una autorización, no un pago:

| Jornada de 7 h, cargás 1 adicional | El agente marcó | Se paga |
|---|---|---|
| | 8 h | 7 normales + 1 adicional |
| | 7 h 20 | sólo 7 normales (no llega al umbral de 30 min) |
| | 7 h 40 | 7 normales + 0,67 adicionales |

## Cuál de los dos uso

Las dos mitades de *Excepciones* responden preguntas distintas:

| | Excepción | Horas fuera del esquema |
|---|---|---|
| Responde | **¿Qué clase de día fue?** | **¿Cuántas horas de más hizo?** |
| Alcance | Un rango de días | Un día |
| Lleva cantidad de horas | No | Sí |
| Lleva tramo (recargo) | No | Sí |
| Sobre las horas del esquema | Las **reinterpreta**: las suprime, las marca | Les **suma** |
| Se topea contra lo marcado | No | Sí |

Dicho corto: **la excepción habla del día, las horas hablan del trabajo extra.**
Una resta o reclasifica lo que ya está; la otra agrega.

No son excluyentes: un mismo día puede tener las dos.

### Qué cargar en cada caso

| Qué pasó | Qué cargás |
|---|---|
| Vacaciones del 1 al 15 | Excepción · Vacaciones, 01→15 |
| Faltó sin aviso | Excepción · Ausencia |
| Licencia por examen o duelo | Excepción · Licencia paga |
| Se quedó 2 h después de su horario | Horas fuera del esquema · 2 h, tramo Adicional |
| Vino un sábado que no le tocaba | Horas fuera del esquema · las horas que hizo |
| Trabajó en un feriado, y ese día tenía esquema | Excepción · Cobertura extraordinaria |
| Trabajó en un feriado que no era día suyo | Excepción · Cobertura extraordinaria **+** las horas |
| Cubrió a un compañero en su propio horario | Nada: el esquema ya lo paga |
| Entró y salió distinto, mismas horas | Nada: el total no cambia |
| Ese día trabajó menos, de común acuerdo | Corregir las horas en la preliquidación |

> **El único caso que no tiene una carga natural** es cuando el día se pagó
> distinto del esquema: ni la excepción ni las horas extra lo cubren, porque una
> no lleva cantidad y la otra sólo suma. Va corregido a mano en la preliquidación,
> que deja registro de quién lo cambió.

## Feriados

Nombre, fecha y tipo. El año se toma de la fecha.

Un feriado no trabajado no paga horas: las del esquema pasan a la *compensación
por feriado*. Si alguien igual trabajó, cargale una **cobertura extraordinaria**
en Excepciones, y las horas en *Horas fuera del esquema* si ese día no tenía
esquema.

> Un feriado que falta se liquida como día normal. Revisá que estén todos antes
> de generar el mes.

## Normalización

Produce una versión ajustada de las marcaciones: recorta lo marcado antes de
entrar y después de salir contra el esquema, y separa diurnas de nocturnas. Podés
revisarla y corregirla a mano.

> **No alimenta la liquidación.** La preliquidación lee las marcaciones crudas.
> Es una herramienta de revisión, resabio del modelo anterior en el que se pagaba
> lo marcado. Si querés ver quién se desvía del horario, sirve; para liquidar, no
> hace falta pasar por acá.

## Evaluación mensual

Por agente y por mes:

- los tres componentes del **REG** — gestión de personas, cuantitativo, cualitativo,
- el **SUPER REG**,
- el **reintegro de monotributo**.

Dependen de cómo performó cada uno **ese mes**, así que no se heredan. Un mes sin
cargar arranca con el valor por defecto del agente, pero eso es una red, no un
dato: hay que revisarlo. El monotributo arranca siempre en cero.

El cartel **"N sin cargar"** te dice cuántos faltan. **Completalo antes de
generar**, porque estos porcentajes se aplican sobre el subtotal de horas.

## Preliquidación

Elegís el **mes a liquidar** y generás, para todos de una o agente por agente.

En el detalle de cada uno:

- **Desglose diario** — día por día: horas, banda, tramo, tarifa, importe y de
  dónde salió cada línea. El tooltip de cada fila muestra las marcaciones reales,
  las excepciones y las horas adicionales de ese día.
- **Desvíos** — los avisos, arriba. Cada uno se acepta o se corrige.
- **Agregar un día** — para un día que el motor no generó.
- **Conceptos e ítems** — lo que va arriba del subtotal.

Las líneas **Proyectado** son días futuros todavía no trabajados: si terminan
siendo distintos, la diferencia entra sola el mes siguiente como **Ajuste**.

Las líneas **Corregido a mano** guardan las horas originales y quién las cambió.

### Los ítems

| Forma | Cuándo | ¿Se recalcula? |
|---|---|---|
| Importe fijo | un reintegro puntual | No |
| Porcentaje del subtotal | un premio sobre honorarios | Sí |
| Por tiempo, a valor hora | 45 min × 20 días a Diurna LD | Sí |

Los que se recalculan se ajustan solos si después corregís horas. Los fijos, no:
si corregís horas, revisalos.

### Cerrar

**Confirmar** cierra la preliquidación. Desde el listado, **Resumen del período**
te da la planilla completa de todos los agentes y la exportás a CSV para Excel.

---

# Los avisos

Al generar, el sistema compara el esquema contra las marcaciones. Cada aviso queda
pendiente hasta que lo resolvés.

### De marcación

| Aviso | Qué pasó | Qué hacer |
|---|---|---|
| **No marcó ingreso** | Había esquema y no marcó | Confirmar si trabajó; si sí, cargar la marcación |
| **No marcó egreso** | Marcó ingreso y no cerró | Cerrarlo en *Marcaciones* |
| **Llegó tarde** | Ingresó pasada la tolerancia | Aceptar, o corregir las horas del día |
| **Se fue antes** | Marcó menos horas que el esquema | Aceptar, o corregir las horas |
| **Trabajó sin esquema** | Marcó un día sin horario asignado | Cargar las horas, o revisar el esquema |

### De horas cargadas

| Aviso | Qué pasó | Efecto |
|---|---|---|
| **Trabajó de más** | Estuvo fuera del esquema y no hay horas que lo cubran | **Esas horas no se pagan** hasta que las cargues |
| **Cargado sin excedente** | Cargaste horas y ese día no trabajó de más | No se liquidan |
| **Cargado de más** | Autorizaste más de lo que estuvo | Se recorta a lo trabajado |

> **"Trabajó de más" es el que hay que revisar sí o sí**: son horas reales que hoy
> no se están pagando.

Corregir las horas de un día desde la tabla resuelve solo el aviso de ese día.

---

# El ritmo del mes

| Cuándo | Dónde | Qué |
|---|---|---|
| Cada día | Inicio | Quién no marcó, quién no cerró |
| Cada día | Marcaciones | Reponer lo que falta, con nota |
| Cuando pasa | Excepciones | Licencias, ausencias, coberturas |
| Cuando pasa | Horas fuera del esquema | Lo trabajado de más, con su tramo |
| Fin de mes | Evaluación mensual | REG, SUPER REG, monotributo |
| Fin de mes | Preliquidación | Generar → revisar avisos → ítems → confirmar → exportar |

**Regla de oro:** todo lo que se salió del esquema se carga *cuando pasa*, no en
el cierre. En el cierre ya nadie se acuerda de qué pasó el día 9.
