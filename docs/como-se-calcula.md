# Cómo se calcula la liquidación

Referencia del motor de cálculo. Los manuales por rol remiten acá cuando hace
falta el detalle.

---

## El principio

**El plan se paga solo cuando la marcación lo acompaña. Cuando no, el día se
normaliza.**

Tres ideas:

1. **El plan** de cada día sale de los datos cargados: el esquema, o el horario
   de una excepción.
2. **La marcación decide si el día se paga solo.** Si acompaña al plan dentro de
   los márgenes, no hace falta nadie. Si no, el día queda *a normalizar*: se
   paga el plan mientras tanto, y la preliquidación no se confirma.
3. **Normalizar es decidir, una vez, qué se paga ese día.** La decisión es un
   dato más —una *corrección del día*—, igual que una excepción: se conserva en
   cada recálculo y se puede deshacer.

---

## 1. El plan de cada día

| Si ese día hay… | El plan es… |
|---|---|
| Un **cambio de jornada** o una **cobertura extraordinaria** con horario | Ese horario, en lugar del esquema |
| Cualquier otra cosa | El esquema vigente ese día |
| Una fecha **anterior al ingreso** del agente | Nada: el esquema todavía no rige |

Si un día tiene más de una excepción, manda una, en este orden: ausencia,
vacaciones, licencia paga, cobertura extraordinaria, cambio de jornada.

## 2. Qué pasa con cada día, y en qué orden

El primero que aplica decide, y los siguientes no se miran.

| # | Situación | Qué hace |
|---|---|---|
| 1 | **Corrección del supervisor** | Paga lo que dice la corrección. Nada más se evalúa |
| 2 | **Ausencia** | No paga nada. Si marcó igual, queda a normalizar |
| 3 | **Feriado** sin cobertura extraordinaria | No paga horas: las del esquema van a la *compensación por feriado no trabajado*. Si marcó, queda a normalizar |
| 4 | **Vacaciones** o **licencia paga** | Paga el plan. Las vacaciones suman además al *plus vacacional*. Si marcó, queda a normalizar |
| 5 | **Día de trabajo** | Paga el plan y lo contrasta contra la marcación (abajo) |

Los días desde hoy en adelante se pagan **proyectados**: el plan, sin contrastar,
porque todavía no pasaron.

## 3. El contraste contra la marcación

En un día de trabajo, el motor compara el plan con lo marcado **tramo por
tramo**: en una jornada partida cada tramo tiene su ingreso y su egreso.

| Qué encuentra | Resultado |
|---|---|
| Entró y salió de cada tramo dentro de los márgenes, y no trabajó de más | **Se paga solo** |
| Entró a un tramo más de **20 min** tarde | A normalizar: *Llegó tarde* |
| Salió de un tramo más de **20 min** antes, o se ausentó más de 20 min en medio | A normalizar: *Se fue antes* |
| No marcó un tramo entero | A normalizar: *Llegó tarde* si era el primero, *Se fue antes* si era otro |
| La marcación casi no se superpone con el plan | A normalizar: *Marcó en otro horario* |
| Trabajó más de **30 min** por encima del plan, sin autorización que lo cubra | A normalizar: *Trabajó de más* |
| No marcó nada | Se paga el plan y queda un aviso *No marcó* |
| Marcó el ingreso y no el egreso, o al revés | Se paga el plan y queda un aviso *Marcación incompleta* |

**Llegar antes no cuenta**: no cambia lo que se paga.

**Trabajar de más se mide neto**: lo trabajado menos el plan. Una jornada corrida
de lugar —plan 09 a 15, marcó 17 a 23— no tiene excedente: son las mismas seis
horas. Así se evita pagar dos veces el mismo tiempo.

Las marcaciones sin nada o a medias no frenan en los agentes con antigüedad: en
julio y agosto la planilla pagó el plan en todos esos días. Sí frenan en los
**agentes nuevos** —los primeros 14 días desde la fecha de ingreso—, que además
se revisan sin sugerencia. Las dos cosas se configuran.

Una entrada y una salida en el mismo minuto son un doble toque: cuentan cero, no
veinticuatro horas.

## 4. Las horas autorizadas

Las *horas fuera del esquema* son una **autorización**, no un pago. Se pagan con
su tramo, hasta lo que la marcación muestra de más.

**Con la marcación completa**, contra el trabajo de más neto:

| Trabajo de más neto | Se paga |
|---|---|
| Hasta el umbral (30 min) | Nada. Si lo autorizado pasa el umbral, queda a normalizar: *Autorizado y no trabajado* |
| A menos del umbral de lo autorizado | **Todo lo autorizado**: en julio y agosto la planilla lo hizo así en todos los días de este tipo, nunca al minuto |
| Claramente menos que lo autorizado | Lo trabajado. Si la diferencia pasa el umbral, queda a normalizar: *Autorizado de más* |

**Sin marcación completa** no hay con qué contradecirlo: se paga lo autorizado y
queda el aviso *Autorizado sin marcación*. No saber cuánto trabajó no es lo mismo
que saber que no trabajó.

**Marcadas "pagar aunque la marcación no lo respalde"**, se pagan siempre.

**En qué banda caen**: si la autorización tiene inicio y fin, en esas horas. Si
no, en lo marcado fuera del plan, del final hacia atrás —lo típico es quedarse,
no llegar antes—. Sin marcación, en diurna LD. Si hay que recortar, se recorta
primero lo de recargo más alto.

## 5. Normalizar: las correcciones del día

Cada decisión de la bandeja es una corrección, y decide el día entero:

| Decisión | Qué se paga ese día |
|---|---|
| **Está bien así** | Lo que calculó el sistema: el plan —en un feriado no trabajado o una ausencia, nada— y las autorizadas según el tope |
| **Pagar lo marcado** | Lo marcado, como horas normales, cada una en su banda |
| **Autorizar X h** | Crea la autorización con su tramo y deja el día como *Está bien así* |
| **Pagar lo autorizado igual** | Marca esas autorizaciones para pagarse sin tope y deja el día como *Está bien así* |
| **Pagar otro horario** | Los tramos cargados, cada hora en su banda |
| **No pagar el día** | Nada. Un feriado se sigue compensando |
| Editar horas en el desglose | Exactamente esas horas: *Horas cargadas a mano* |

La corrección registra lo que tocó —una autorización creada, una que pasó a
pagarse sin tope— y **deshacerla revierte todo junto**. Una corrección de un mes
confirmado no se puede cambiar ni deshacer: primero se vuelve la preliquidación a
borrador.

### Las sugerencias

Cada día a normalizar trae la respuesta que suele tomar el liquidador:

| Si el día… | Se sugiere |
|---|---|
| Sólo tiene autorizadas que la marcación no muestra | Pagar lo autorizado igual |
| Marcó en otro horario, las mismas horas (±30 min) | Pagar lo marcado |
| Marcó en otro horario, bastante menos | Está bien así |
| Llegó tarde, se fue antes o trabajó de más | Está bien así |
| Es de un agente nuevo, o cualquier otra combinación | Nada: se decide a mano |

## 6. La compensación diaria fija

Si el agente la tiene, cada día de trabajo que se paga suma esos minutos en la
banda elegida, con origen *Compensación*. Entra al subtotal —los conceptos se
calculan encima— y no se paga en feriados, licencias ni ausencias.

---

## 7. El valor de cada hora

```
valor hora = tarifa base × multiplicador de banda × multiplicador de tramo
```

Cada agente tiene **una sola tarifa base**. Todo lo demás son multiplicadores
iguales para todos.

### Bandas — según cuándo cae la hora

| Banda | Cuándo | Multiplicador |
|---|---|---|
| **Diurna LD** | lun–jue 06:00–21:00 · vie 06:00–20:00 | 1 |
| **Nocturna LD** | el continuo del lun 21:00 al vie 05:00 | 1,13 |
| **Diurna HD** | el resto, entre 06:00 y 21:00 | 1,0125 |
| **Nocturna HD** | el resto, entre 21:00 y 06:00 | 1,1441 |

LD es la semana hábil; HD arranca el **viernes a las 20:00** y va hasta el domingo
a la medianoche. La Nocturna HD es 1,13 × 1,0125.

Una jornada que cruza de una banda a otra se parte sola: cada porción se paga a
su valor.

### Tramos — según por qué se trabajó esa hora

| Tramo | Multiplicador |
|---|---|
| Normal | 1 |
| Adicional | 1,25 |
| Extra 50% | 1,50 |
| Extra 100% | 2,00 |

Los dos multiplicadores se combinan. Una hora adicional en banda nocturna LD vale
`base × 1,13 × 1,25`.

> No hay redondeos intermedios: se redondea recién el importe final.

---

## 8. Los conceptos

Sobre el subtotal de horas se calculan:

| Concepto | Cómo sale |
|---|---|
| Premio a la Excelencia (REG) | subtotal × el % del mes (suma de gestión de personas + cuantitativo + cualitativo) |
| SUPER REG | subtotal × el % del mes |
| Antigüedad | subtotal × 0,08333% × meses reconocidos |
| Reintegro por uso de equipos | subtotal × su % |
| Compensación por feriado no trabajado | horas del feriado × valor hora × factor |
| Plus vacacional | horas de vacaciones × valor hora × factor |
| Reintegro de monotributo | importe cargado para ese mes |

El REG, el SUPER REG y el monotributo se cargan **por agente y por mes** en
*Evaluación mensual*: dependen de cómo performó cada uno ese mes.

A esto se le suman los **ítems manuales**, que pueden ser importe fijo, porcentaje
del subtotal, o por tiempo a valor hora. Los de porcentaje y los de tiempo se
recalculan solos si cambian las horas; los de importe fijo, no.

---

## 9. El período y la conciliación

El período se define por el **día de corte** en Configuración. Con `1` se liquida
el mes calendario. El mes que toca cerrar es el último período que terminó.

Si se liquida antes de que termine el mes, los días que faltan se pagan
**proyectados** desde el plan. Cuando esos días efectivamente ocurren y fueron
distintos, la diferencia entra en el período siguiente como línea de **Ajuste
mes anterior**, con la fecha original.

---

## 10. La preliquidación viva

Una preliquidación en **borrador** no es una foto: se recalcula sola cada vez que
cambia un dato del agente —excepción, hora autorizada, feriado, esquema, tarifa,
una marcación corregida por un supervisor, la evaluación, la configuración o una
corrección del día—. Las marcaciones que el agente hace desde su portal entran
con **Actualizar** o **Traer marcaciones nuevas**.

**Confirmar** exige que no queden días a normalizar ni falte la evaluación
mensual. Antes de confirmar se recalcula una última vez; si el total cambió, no
confirma y avisa, para que se mire. Una preliquidación **confirmada** queda como
constancia de lo pagado y no se recalcula más; **Volver a borrador** la reabre.

---

## 11. Los avisos

### A normalizar — frenan la confirmación

| Aviso | Cuándo aparece |
|---|---|
| **Llegó tarde** | Entró a un tramo pasado el margen, o no marcó el primer tramo |
| **Se fue antes** | Salió de un tramo antes del margen, se ausentó en medio, o no marcó un tramo posterior |
| **Marcó en otro horario** | La marcación no se superpone con el plan, o cubre menos de la mitad y trabajó al menos la mitad de sus horas |
| **Trabajó de más** | Trabajo de más neto por encima del umbral, sin autorización que lo cubra |
| **Trabajó sin esquema** | Marcó, por encima del umbral, un día sin plan |
| **Trabajó un feriado** | Marcó en un feriado sin cobertura cargada |
| **Marcó un día de licencia** | Marcó en vacaciones, licencia paga o ausencia |
| **Autorizado y no trabajado** | Con marcación completa, no se ve nada de lo autorizado |
| **Autorizado de más** | Con marcación completa, se ve bastante menos que lo autorizado |
| **No marcó** / **Marcación incompleta** | Sólo en agentes nuevos, o si se activó en Configuración |
| **Falta la evaluación mensual** | No es de un día: falta cargarla para el mes |

### Informativos — no frenan

| Aviso | Cuándo aparece |
|---|---|
| **No marcó** / **Marcación incompleta** | Agentes con antigüedad: se pagó el plan |
| **Autorizado sin marcación** | Se pagó lo autorizado sin marcación completa |
| **Autorizado de más** / **Autorizado y no trabajado** | Cuando la diferencia no llega al umbral |
| **Ausencia** | Día de ausencia registrado |

---

## 12. Las sugerencias de esquema

Mirando las últimas ocho semanas, el sistema busca agentes que, el mismo día de
la semana, marcaron distinto a su esquema al menos tres veces y en al menos el
75% de las semanas. Propone el horario típico que marcaron —redondeado a 15
minutos, tramo por tramo— y lo prueba: sólo lo sugiere si con él los días a
normalizar de esas semanas bajan al menos a la mitad.

Aplicarlo cierra el esquema viejo el día anterior y crea el nuevo, así los meses
ya liquidados no cambian.

---

## 13. Cómo se validó

Contra las liquidaciones hechas en Excel de julio y agosto 2026, con las
marcaciones reales:

| | Julio | Agosto |
|---|---|---|
| Días con plan | 277 | 359 |
| Se pagaron solos | 233 (84%) | 253 (70%) |
| Quedaron para normalizar | 44 | 106 — 30 de los cinco ingresos del 07/08 |
| La sugerida coincidió con la planilla | 38 de 43 | 67 de 76 |
| Neto por agente | al centavo | al centavo |

Tomando las decisiones del liquidador como correcciones del día, el neto de cada
agente cierra al centavo en los dos meses. Los únicos días que se pagan distinto
sin pasar por la bandeja son seis en total, y en ninguno el sistema tiene dato
para saberlo: la planilla pagó algo que no está en el esquema, las marcaciones ni
las autorizaciones.
