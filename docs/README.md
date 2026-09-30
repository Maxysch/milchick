# Manuales

| Si sos | Leé | Tiempo |
|---|---|---|
| Agente | [Manual del agente](manual-agente.md) | 3 min |
| Supervisor | [Manual del supervisor](manual-supervisor.md) | 15 min |
| Administrador | [Manual del administrador](manual-admin.md) | 10 min |

Y como referencia, cuando haga falta el detalle de un número:

**[Cómo se calcula la liquidación](como-se-calcula.md)** — el orden en que se
evalúa cada día, los márgenes, el tope de las horas autorizadas, las bandas y
multiplicadores, los conceptos y todos los avisos.

---

## En una frase

**El plan se paga solo cuando la marcación lo acompaña. Cuando no, alguien
decide qué se paga ese día —una vez— y el sistema lo recuerda.**

El *plan* de un día es el esquema del agente, o el horario de la excepción si se
cargó una con horario. Si el agente marcó dentro de los márgenes, el día se paga
sin que nadie lo toque. Si no —llegó tarde, se fue antes, trabajó de más o en
otro horario—, el día queda en la bandeja de **Normalización** con una respuesta
sugerida, y la preliquidación no se confirma hasta resolverlo.

Probado contra las liquidaciones reales: en julio y agosto 2026 el sistema
resolvió solo el 84% y el 70% de los días, y en los que quedaron para revisar la
respuesta sugerida coincidió con lo que decidió la planilla en 9 de cada 10.

## El ciclo

```
 durante el mes                            al cierre, en "Cierre del mes"
 ──────────────────────────────            ──────────────────────────────────
 el agente marca                           1. Datos del mes: esquemas, tarifas, feriados
 el supervisor carga excepciones   ──►     2. Evaluación mensual
 y horas autorizadas                       3. Preliquidar
                                           4. Normalizar los días que no cierran
 la preliquidación en borrador             5. Confirmar  ──►  resumen para pagar
 se recalcula sola con cada dato
```
