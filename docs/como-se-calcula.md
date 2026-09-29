# Cómo se calcula la liquidación

Referencia del motor de cálculo. Los manuales por rol remiten acá cuando hace
falta el detalle.

---

## El principio

**Se paga el esquema. Las marcaciones avisan.**

El sistema liquida las horas del esquema de cada agente. Las marcaciones no
generan pago por sí solas: se usan para detectar diferencias y avisar. Una
diferencia que nadie carga, no se paga.

---

## 1. Qué pasa con cada día, y en qué orden

Para cada día del período el motor evalúa esto **en orden**. El primero que
aplica decide, y los siguientes no se miran.

| # | Situación | Qué hace |
|---|---|---|
| 1 | **Ausencia** | No paga nada. El día queda descontado. |
| 2 | **Feriado** sin cobertura extraordinaria | No paga horas. Las horas del esquema se acumulan para la *compensación por feriado no trabajado*. |
| 3 | **Vacaciones** | Paga el día completo, igual que uno normal, y además acumula para el *plus vacacional*. |
| 4 | **Cualquier otro día** | Paga las horas del esquema. Si hay una excepción cargada, la línea queda con origen *Excepción*; si no, *Esquema*. |

Una **cobertura extraordinaria** en un feriado lo convierte en día trabajado: se
paga en vez de compensarse.

Las **licencias pagas** se liquidan como un día normal, pero **no** suman al plus
vacacional: eso es sólo para vacaciones.

## 2. Las excepciones

Una excepción dice **qué clase de día fue**, para uno o varios días seguidos. Se
cargan en *Excepciones* con cuatro datos: agente, tipo, rango de fechas y una
nota. La cobertura extraordinaria lleva además el cliente.

**Una excepción no lleva horas ni horarios.** Define la naturaleza del día; las
horas las sigue poniendo el esquema.

| Tipo | Qué hace en la liquidación |
|---|---|
| **Ausencia** | El día no se paga |
| **Vacaciones** | Paga el día según esquema **y** suma al plus vacacional |
| **Licencia paga** | Paga el día según esquema, **sin** sumar al plus vacacional |
| **Cobertura extraordinaria** | En un feriado, lo convierte en día trabajado y lo paga en vez de compensarlo |
| **Cambio de jornada** | Marca el día como excepción en el detalle. **No modifica las horas.** |

Si el rango abarca varios días, aplica a cada uno por separado; los que caen en
fin de semana sin esquema no generan horas, porque no había nada que pagar.

En el desglose diario, los días con excepción aparecen con origen **Excepción** y
el tipo se ve en el tooltip de la fila.

### Dos cosas que conviene saber

**"Cambio de jornada" no cambia las horas.** El tipo existe y deja constancia, pero
el pago sigue saliendo del esquema. Para que un día se pague distinto hay dos
caminos: cargar la diferencia en *Horas fuera del esquema*, o corregir las horas
de ese día directamente en la preliquidación, que queda registrado como
*Corregido a mano*.

**"Cobertura extraordinaria" sólo suma en un feriado.** En un día normal no
agrega horas, y si el agente no tenía esquema ese día —que es el caso típico de
una cobertura— no paga nada por sí sola. Las horas de la cobertura hay que
cargarlas aparte, en *Horas fuera del esquema* o como día agregado en la
preliquidación.

En los dos casos el aviso **"Trabajó de más"** es la red: si el agente marcó,
el sistema avisa que esas horas están sin pagar.

---

## 3. Después, las horas cargadas por el supervisor

Las horas que un supervisor carga **no se suman sin más**. Se topean contra lo
que el agente efectivamente trabajó de más, medido con sus marcaciones:

```
excedente = lo marcado − lo que se superpone con el esquema
se paga   = excedente > umbral  ?  mín(cargado, excedente)  :  0
```

El umbral por defecto es **30 minutos**, configurable. Cuenta lo de antes de
entrar más lo de después de salir, sumado, no cada punta por separado.

Ejemplos, con una jornada de 7 h y 1 hora adicional cargada:

| El agente marcó | Se paga |
|---|---|
| 8 h | 7 normales + 1 adicional |
| 7 h 20 | 7 normales. El excedente no llega al umbral. |
| 7 h 40 | 7 normales + 0,67 adicionales (se recorta a lo trabajado) |
| 7 h | 7 normales |

El excedente se mide **por tramo**, no de la primera marca a la última: un bloque
desconectado del esquema cuenta entero.

Si **no hay marcaciones** ese día, no hay con qué topear y se paga lo cargado.

---

## 4. El valor de cada hora

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

## 5. Los conceptos

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
recalculan solos si después se corrigen horas; los de importe fijo, no.

---

## 6. El período y la conciliación

El período se define por el **día de corte** en Configuración. Con `1` se liquida
el mes calendario.

Si se liquida antes de que termine el mes, los días que faltan se pagan
**proyectados** desde el esquema. Cuando esos días efectivamente ocurren y fueron
distintos, la diferencia entra en el período siguiente como línea de **Ajuste**,
con la fecha original.

---

## 7. Los avisos del sistema

Al generar una preliquidación el motor compara el esquema contra las marcaciones y
levanta avisos. Cada uno queda pendiente hasta que alguien lo acepta o lo corrige.

### Sobre la marcación

| Aviso | Cuándo aparece |
|---|---|
| **No marcó ingreso** | Había esquema y no hay marcación |
| **No marcó egreso** | Marcó el ingreso y nunca cerró |
| **Llegó tarde** | Ingresó después del inicio, pasada la tolerancia |
| **Se fue antes** | Marcó menos horas que las del esquema |
| **Trabajó sin esquema** | Marcó un día en el que no tenía horario asignado |

Los días con excepción o feriado no generan estos avisos.

### Sobre las horas cargadas

| Aviso | Cuándo aparece | Efecto en el pago |
|---|---|---|
| **Trabajó de más** | Estuvo fuera del esquema por encima del umbral y no hay horas cargadas que lo cubran | Esas horas **no se pagan** hasta que alguien las cargue |
| **Cargado sin excedente** | Hay horas cargadas pero ese día no trabajó de más | No se liquidan |
| **Cargado de más** | Se autorizaron más horas de las que estuvo | Se recorta a lo trabajado |

Los tres primeros son los que suelen indicar plata: **"Trabajó de más" es el aviso
que hay que revisar sí o sí**, porque marca horas reales que hoy no se están
pagando.

Corregir las horas de un día desde la tabla resuelve automáticamente el aviso de
ese día y deja registro de quién lo cambió.
