# Manuales

| Si sos | Leé | Tiempo |
|---|---|---|
| Agente | [Manual del agente](manual-agente.md) | 3 min |
| Supervisor | [Manual del supervisor](manual-supervisor.md) | 15 min |
| Administrador | [Manual del administrador](manual-admin.md) | 10 min |

Y como referencia, cuando haga falta el detalle de un número:

**[Cómo se calcula la liquidación](como-se-calcula.md)** — el orden en que se
evalúa cada día, las bandas y multiplicadores, los conceptos, la conciliación de
lo proyectado y los avisos que levanta el sistema.

---

## En una frase

**Se paga el esquema. Las marcaciones avisan.**

El sistema liquida las horas del esquema de cada agente. Las marcaciones sirven
para detectar diferencias —llegó tarde, no marcó, trabajó de más— y avisar, no
para pagar. Una diferencia que nadie carga, no se paga.

## El ciclo

```
  el agente marca  ──►  el supervisor carga lo que se salió del esquema
                        (excepciones · horas de más)
                                    │
                                    ▼
                        Evaluación mensual  (REG, SUPER REG, monotributo)
                                    │
                                    ▼
                        Preliquidación  ──►  revisar avisos  ──►  confirmar
                                                                      │
                                                                      ▼
                                                              exportar a Excel
```
