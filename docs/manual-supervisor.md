# Manual del supervisor

## Lo único que hay que entender antes de empezar

**El plan se paga solo cuando la marcación lo acompaña. Cuando no, el día se
normaliza.**

- El **plan** de un día es el esquema del agente, o el horario de la excepción si
  cargaste una con horario.
- Si el agente marcó dentro de los **márgenes** —20 minutos al entrar y 20 al
  salir de cada tramo—, el día se paga sin que nadie lo toque. Llegar antes no
  cuenta: no cambia lo que se paga.
- Si no, el día queda en **Normalización** con una respuesta sugerida. Mientras
  tanto se paga el plan, pero la preliquidación **no se puede confirmar**.
- Cada decisión queda guardada como **corrección del día**: sobrevive a los
  recálculos, dice quién la tomó y se puede deshacer.

Tu trabajo tiene dos partes: **durante el mes** cargás lo que ya sabés
(licencias, cambios de horario, horas autorizadas); **al cierre** resolvés lo que
el sistema no pudo decidir solo.

El detalle del cálculo está en [Cómo se calcula](como-se-calcula.md).

---

# Al cierre

> **¿Cierre del mes o Preliquidación?** Cierre del mes es el **recorrido**; la
> preliquidación es el **documento**. Cada agente tiene una preliquidación por
> mes —sus horas día por día, los conceptos, el neto—, y *Cierre del mes* te
> lleva por los cinco pasos para todos a la vez: el paso 3 las crea o actualiza,
> el 4 resuelve sus días, el 5 las confirma. A *Preliquidación* vas cuando
> necesitás el detalle de un agente o exportar el resumen.

## Cierre del mes

La pantalla del cierre, en cinco pasos. Abre con el mes que toca cerrar —el
último que terminó— y ese mes viaja a las demás pantallas cuando entrás desde acá.

| Paso | Qué mira | Qué hacés |
|---|---|---|
| **1. Datos del mes** | Agentes sin esquema o sin tarifa, y los feriados cargados | Completar lo que falte. Sin esquema y tarifa no se puede liquidar |
| **2. Evaluación mensual** | A quién le falta | **Cargarla** |
| **3. Preliquidar** | Quién no tiene preliquidación | **Preliquidar** los que faltan, o **Actualizar todas** |
| **4. Normalizar** | Cuántos días no cierran contra el plan | **Ir a la bandeja** |
| **5. Confirmar** | Las que están listas | **Confirmar las listas**, y al final **Resumen para pagar** (CSV para Excel) |

Una preliquidación está **lista** cuando no le quedan días a normalizar y tiene
la evaluación cargada. La tabla **Por agente** muestra el estado de cada uno.

Si el paso 4 avisa que hay **esquemas que parecen desactualizados**, conviene
corregirlos: sacan días de la bandeja todos los meses (ver *Cuando el mismo
problema se repite*, abajo).

## Normalización — la bandeja

Los días del mes que no cierran, **un renglón por agente y día**, con todos los
motivos juntos, el plan y lo que marcó. Arriba ves cuántos son, cuántos tienen
respuesta sugerida y cuántos son de agentes en sus primeras semanas.

- **Filtrar por agente** con los botones de nombres.
- **La sugerida** aparece resaltada, con el motivo. Es la que suele tomar el
  liquidador en casos así: en julio y agosto coincidió 9 de cada 10 veces.
- **Aceptar en bloque**: los días con sugerencia vienen tildados. Destildá los que
  no van y tocá **Aceptar las sugeridas**; antes de aplicar te muestra el resumen.
- Los que **no tienen sugerencia** —los de agentes nuevos, por ejemplo— se
  resuelven de a uno.
- **Traer marcaciones nuevas** recalcula con lo que marcaron los agentes desde la
  última actualización.
- **Correcciones aplicadas** lista lo resuelto en el mes, con quién y la nota.
  **Deshacer** vuelve el día a calcularse solo. Las de un mes ya confirmado
  figuran como *Confirmada* y no se deshacen: primero hay que volver la
  preliquidación a borrador.

No hace falta esperar al cierre: los días que ya pasaron se pueden resolver
durante el mes.

### Las decisiones

Una sola por día. Si el día tiene dos motivos —llegó tarde **y** tenía horas
autorizadas—, una decisión lo resuelve entero.

| Botón | Qué se paga | Cuándo va |
|---|---|---|
| **Está bien así** | Lo que calculó el sistema: el plan, y las autorizadas hasta lo que se ve en la marcación | El desvío no cambia lo que corresponde. Es lo más común |
| **Pagar lo marcado** | Lo que marcó, todo como horas normales, cada hora en su banda | Trabajó otro horario de verdad |
| **Autorizar X h** | El plan más esas horas con el tramo que elijas, hasta lo que trabajó de más | Trabajó de más y corresponde pagarlo con recargo |
| **Pagar lo autorizado igual** | Lo autorizado, aunque la marcación no lo muestre | Un arrastre del mes anterior, una marcación mal hecha |
| **Pagar otro horario** | Los tramos que cargues | Lo acordado no es ni el plan ni lo marcado |
| **No pagar el día** | Nada. Un feriado se sigue compensando | No trabajó y no corresponde pagarlo |

En un **feriado** o una **licencia** en que el agente marcó, *Está bien así* se
llama **Dejarlo como feriado** o **Dejar la licencia / la ausencia**: deja el día
como estaba, sin pagar el esquema.

Cada decisión admite una **nota**. Usala: es lo que explica el día cuando alguien
pregunta en tres meses.

> **Pagar lo marcado paga todo como horas normales.** Si las de más van con
> recargo, la decisión es **Autorizar**, eligiendo bien el tramo.

### Cuando el mismo problema se repite

Si un agente aparece todas las semanas el mismo día con el mismo desvío, el
problema no es el agente: es el esquema. El sistema lo detecta solo y lo propone
en **Esquemas → sugerencias** (ver el [manual del administrador](manual-admin.md)).
Corregir el esquema saca esos días de la bandeja de ahí en adelante.

## Preliquidación

Hay **una por agente y por mes**. Mientras está en borrador está **viva**: se
recalcula sola cada vez que cambia un dato de ese agente —una excepción, una
hora autorizada, un feriado, el esquema, la tarifa, una marcación que corregís,
la evaluación o la configuración—. Las marcaciones que hacen los agentes desde su
portal entran cuando tocás **Actualizar** o **Traer marcaciones nuevas**.

**En el listado**: el mes, **Actualizar todas**, **Exportar resumen** y el
resumen del período con los días que faltan normalizar.

**En el detalle** de cada agente:

- Arriba, cuándo se actualizó por última vez y cómo quedaron los días: *se
  pagaron solos · normalizados · a normalizar · feriados*.
- **Días a normalizar** — los mismos de la bandeja, con las mismas decisiones.
- **Desglose diario** — cada día con sus horas, banda, tramo, tarifa, importe,
  cliente y origen. El reloj de cada fecha muestra lo que marcó, las excepciones
  y las horas autorizadas.
- **Editar horas** de una línea, o **Agregar un día**: quedan como *Horas
  cargadas a mano*, una corrección más que se conserva al recalcular.
- **Ítems** — lo que va arriba del subtotal.

El **origen** de cada línea:

| Origen | De dónde sale |
|---|---|
| Esquema | El plan del día, pagado solo |
| Excepción | Vacaciones, licencia, o el horario de una excepción |
| Autorizada | Horas autorizadas |
| Normalizado | Una decisión de la bandeja o una edición a mano (pasá el mouse para ver cuál) |
| Compensación | La compensación diaria fija del agente |
| Ajuste mes anterior | La diferencia de un día que se pagó proyectado el mes pasado |

Una línea con la marca **Proyectado** es de un día que todavía no pasó: se paga
el plan y, si el día termina distinto, la diferencia entra el mes siguiente como
*Ajuste mes anterior*.

### Los ítems

| Forma | Cuándo | ¿Se recalcula? |
|---|---|---|
| Importe fijo | un reintegro puntual | No |
| Porcentaje del subtotal | un premio sobre honorarios | Sí |
| Por tiempo, a valor hora | 45 min × 20 días a Diurna LD | Sí |

### Confirmar

**Confirmar** sólo se puede sin días a normalizar y con la evaluación cargada.
Al confirmar se recalcula una última vez: si el total cambió —entró una marcación
o un dato nuevo—, avisa y no confirma, para que lo mires antes.

Una preliquidación confirmada es la constancia de lo que se pagó: ya no se
recalcula ni se normaliza. **Volver a borrador** la reabre y la recalcula con los
datos de ese momento.

---

# Durante el mes

## Inicio

Tu tablero, dos minutos por día.

| Tarjeta | Qué hacer |
|---|---|
| **Días a normalizar** | Cuántos hay, por mes. Te lleva a la bandeja del más viejo |
| **No marcaron hoy** | Preguntar hoy, mientras se acuerdan |
| **Marcaciones sin cerrar** | Alguien marcó ingreso y no egreso: cerrarlo |
| **Preliquidaciones en borrador** | Lo que falta confirmar |
| **Agentes sin esquema / sin tarifa** | Tiene que estar en cero: así no se puede liquidar |

## Marcaciones

Todas las marcaciones, filtrables por agente y fechas. Acá corregís lo que el
agente no pudo: un ingreso olvidado, un egreso que quedó abierto. **Carga
individual** o **masiva** para reponer varios días. Dejá una nota diciendo por qué.

Corregir una marcación recalcula la preliquidación del agente: si el día ahora
acompaña al plan, sale solo de la bandeja.

## Excepciones

Una excepción dice **qué clase de día fue**. Se carga con agente, tipo,
**desde/hasta** y una nota. La cobertura extraordinaria lleva además el cliente,
y dos tipos pueden llevar **horario**.

| Tipo | Qué hace | ¿Horario? |
|---|---|---|
| **Ausencia** | El día no se paga | No |
| **Vacaciones** | Se paga el plan y suma al plus vacacional. No se espera marcación | No |
| **Licencia paga** | Se paga el plan, sin plus vacacional. No se espera marcación | No |
| **Cambio de jornada** | Con horario, **ese es el plan del día**: se paga solo si la marcación lo acompaña. Sin horario, sólo deja constancia | Opcional |
| **Cobertura extraordinaria** | En un feriado, lo vuelve día trabajado. Con horario, ese es el plan del día —sirve también para un día sin esquema— | Opcional |

Si un día tiene dos excepciones, manda una: ausencia, después vacaciones,
licencia paga, cobertura y, al final, cambio de jornada.

**Cargala cuando la sabés.** No hace falta regenerar nada: la preliquidación se
actualiza sola.

> **Ejemplo.** Trabaja de lunes a viernes de 9 a 15, y el miércoles va a hacer de
> 17 a 23. Cargás un *Cambio de jornada* para ese miércoles con horario 17:00 a
> 23:00. Si marca 17 a 23, el día se paga solo, y lo que pase de las 21 va como
> nocturna. Si no cargás nada, el día cae en la bandeja como *Marcó en otro
> horario* y se resuelve con **Pagar lo marcado**.

## Horas fuera del esquema — las horas autorizadas

Una **autorización** para pagar horas por encima del plan: fecha, cantidad,
opcionalmente inicio y fin, cliente, nota y, sobre todo, **el tramo**.

| Tramo | Se paga |
|---|---|
| Sin recargo | tarifa común |
| Adicional | × 1,25 |
| Extra 50% | × 1,50 |
| Extra 100% | × 2,00 |

> **Elegir mal el tramo es el error más caro del sistema.** Una hora cargada como
> Extra 100% en vez de Adicional se paga al doble.

**Se pagan hasta lo que muestra la marcación.** Lo que se mide es el trabajo de
más *neto*: lo trabajado menos el plan. Con una jornada de 7 h y 1 h autorizada:

| El agente marcó | Se paga |
|---|---|
| 8 h | 7 normales + 1 adicional |
| 7 h 40 | 7 normales + 1 adicional: quedó a menos de 30 min de lo autorizado |
| 7 h 20 | 7 normales, y el día queda en la bandeja como *Autorizado y no trabajado* |
| Nada, o la marcación quedó incompleta | 7 normales + 1 adicional, con un aviso: no hay con qué contrastarlo |

**Pagar aunque la marcación no lo respalde** — tildalo cuando ya sabés que no se
va a ver en la marcación, por ejemplo un arrastre del mes anterior. Se paga lo
autorizado siempre.

Y al revés: si trabajó de más **sin** autorización, se paga el plan y el día cae
en la bandeja como *Trabajó de más*, con **Autorizar X h** ya calculado.

## Feriados

| Qué pasó | Qué se paga |
|---|---|
| No trabajó | Ninguna hora: las del esquema van a la *compensación por feriado* |
| Trabajó, y cargaste una *Cobertura extraordinaria* | El día como trabajado (con horario, ese horario) |
| Marcó sin cobertura cargada | Queda en la bandeja como *Trabajó un feriado* |

> Un feriado que falta se liquida como día normal. Revisá que estén todos antes
> de cerrar: el paso 1 del cierre te los muestra.

## Evaluación mensual

Por agente y por mes: los tres componentes del **REG** —gestión de personas,
cuantitativo, cualitativo—, el **SUPER REG** y el **reintegro de monotributo**.

Dependen de cómo performó cada uno **ese mes**, así que no se heredan. Un mes sin
cargar arranca con el valor por defecto del agente, pero eso es una red, no un
dato: **sin la evaluación cargada la preliquidación no se confirma**. El
monotributo arranca siempre en cero.

---

# Los avisos

Hay dos familias. Los **a normalizar** frenan la confirmación hasta que decidís;
los **informativos** quedan escritos y no frenan nada.

### A normalizar

| Aviso | Qué pasó | Lo habitual |
|---|---|---|
| **Llegó tarde** | Entró a un tramo pasados los 20 min, o no marcó el primer tramo | Está bien así |
| **Se fue antes** | Salió de un tramo 20 min antes, se ausentó en medio, o no marcó un tramo posterior | Está bien así |
| **Marcó en otro horario** | La marcación casi no se superpone con el plan | Pagar lo marcado, si son las mismas horas |
| **Trabajó de más** | Trabajó más de 30 min por encima del plan, sin autorización | Está bien así; Autorizar si corresponde |
| **Trabajó sin esquema** | Marcó un día sin plan | Autorizar o Pagar lo marcado |
| **Trabajó un feriado** | Marcó en un feriado sin cobertura | Según lo acordado |
| **Marcó un día de licencia** | Marcó en vacaciones, licencia o ausencia | Según lo acordado |
| **Autorizado y no trabajado** / **Autorizado de más** | La marcación no muestra lo autorizado | Pagar lo autorizado igual |
| **No marcó** / **Marcación incompleta** | Sólo en agentes nuevos, o si se activó en Configuración | Revisar con el agente |
| **Falta la evaluación mensual** | No es un día: falta cargarla | Evaluación mensual |

Los **agentes nuevos** —las primeras dos semanas desde la fecha de ingreso— se
revisan siempre y sin sugerencia: la inducción y la capacitación no siguen el
esquema.

### Informativos

| Aviso | Qué significa |
|---|---|
| **No marcó** / **Marcación incompleta** | En agentes con antigüedad se paga el plan: casi siempre es un olvido |
| **Autorizado sin marcación** | Se pagó lo autorizado sin marcación completa para contrastarlo |
| **Ausencia** | Día de ausencia: no se pagan horas |

---

# El ritmo del mes

| Cuándo | Dónde | Qué |
|---|---|---|
| Cada día | Inicio | Quién no marcó, quién no cerró, días a normalizar |
| Cada día | Marcaciones | Reponer lo que falta, con nota |
| Cuando pasa | Excepciones | Licencias, ausencias, coberturas, cambios de horario **con horario** |
| Cuando pasa | Horas fuera del esquema | Lo que autorizás, con su tramo |
| Cuando quieras | Normalización | Resolver los días que ya pasaron |
| Al cierre | Cierre del mes | Los cinco pasos, de arriba abajo |

**Regla de oro:** lo que ya sabés, cargalo *cuando pasa*. Una excepción cargada a
tiempo es un día que se paga solo; la misma cosa descubierta en el cierre es un
día en la bandeja.
