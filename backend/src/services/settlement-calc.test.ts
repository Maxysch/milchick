import { describe, it, expect } from 'vitest';
import {
  bandAt,
  buildDailyLines,
  compareAgainstClockIns,
  computeConcepts,
  computeRate,
  roundCents,
  settlementPeriod,
  splitIntoBands,
  subtotalFromBuckets,
  computeAdjustments,
  computeItemAmount,
  hoursFromMinutesPerDay,
  reviewOvertimeOutcomes,
  DEFAULT_RATE_FACTORS,
  DEFAULT_SETTLEMENT_PARAMS,
  type Band,
  type ClockObservation,
  type DailyLine,
  type DayContext,
  type PaidLine,
  type Tier,
  type HourBucket,
  type OvertimeRecord,
  type ScheduleSlot,
  type SettlementParams,
} from './settlement-calc.js';
import fixture from './__fixtures__/julio-2026.json' with { type: 'json' };
import tope from './__fixtures__/tope-julio-2026.json' with { type: 'json' };

// ─────────────────────────────────────────────────────────────────────
// Clasificación de bandas
// ─────────────────────────────────────────────────────────────────────

describe('bandAt', () => {
  const at = (dow: number, hh: number, mm = 0) => bandAt(dow, hh * 60 + mm);

  it('de lunes a jueves la franja diurna LD va de 06:00 a 21:00', () => {
    for (const dow of [1, 2, 3, 4]) {
      expect(at(dow, 6)).toBe('day_ld');
      expect(at(dow, 20, 59)).toBe('day_ld');
      expect(at(dow, 21)).toBe('night_ld');
    }
  });

  it('el viernes la franja LD cierra a las 20:00', () => {
    expect(at(5, 19, 59)).toBe('day_ld');
    expect(at(5, 20)).toBe('day_hd');
    expect(at(5, 21)).toBe('night_hd');
  });

  it('la nocturna LD es el continuo del lunes 21:00 al viernes 05:00', () => {
    expect(at(1, 22)).toBe('night_ld');   // lunes a la noche
    expect(at(5, 4)).toBe('night_ld');    // viernes de madrugada
    expect(at(1, 4)).toBe('night_hd');    // lunes de madrugada: viene del domingo
    expect(at(6, 4)).toBe('night_hd');    // sábado de madrugada
  });

  it('sábado y domingo caen enteros en HD', () => {
    for (const dow of [6, 7]) {
      expect(at(dow, 10)).toBe('day_hd');
      expect(at(dow, 23)).toBe('night_hd');
    }
  });

  it('la hora entre 05:00 y 06:00 no es LD ningún día', () => {
    for (const dow of [1, 2, 3, 4, 5, 6, 7]) {
      expect(at(dow, 5, 30)).toBe('night_hd');
    }
  });
});

describe('splitIntoBands', () => {
  const total = (b: Record<Band, number>) =>
    b.day_ld + b.night_ld + b.day_hd + b.night_hd;

  it('una jornada diurna de miércoles es toda LD', () => {
    // 2026-07-01 es miércoles
    const b = splitIntoBands('2026-07-01', '11:00', '19:00');
    expect(b.day_ld).toBe(8);
    expect(total(b)).toBe(8);
  });

  it('reparte una jornada que cruza el cierre de la franja diurna', () => {
    const b = splitIntoBands('2026-07-01', '19:00', '23:00');
    expect(b.day_ld).toBe(2);    // 19 → 21
    expect(b.night_ld).toBe(2);  // 21 → 23
  });

  it('el viernes a la tarde pasa a HD a las 20:00', () => {
    // 2026-07-03 es viernes
    const b = splitIntoBands('2026-07-03', '18:00', '22:00');
    expect(b.day_ld).toBe(2);    // 18 → 20
    expect(b.day_hd).toBe(1);    // 20 → 21
    expect(b.night_hd).toBe(1);  // 21 → 22
  });

  it('un turno que cruza la medianoche se reparte entre los dos días', () => {
    // martes 22:00 → miércoles 02:00, todo nocturna LD
    const b = splitIntoBands('2026-07-07', '22:00', '02:00');
    expect(b.night_ld).toBe(4);
    expect(total(b)).toBe(4);
  });

  it('un sábado entero es HD', () => {
    // 2026-07-04 es sábado
    const b = splitIntoBands('2026-07-04', '09:00', '15:00');
    expect(b.day_hd).toBe(6);
    expect(total(b)).toBe(6);
  });

  it('conserva el total de horas al repartir', () => {
    const b = splitIntoBands('2026-07-06', '04:30', '23:45');
    expect(total(b)).toBeCloseTo(19.25, 10);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Tarifas
// ─────────────────────────────────────────────────────────────────────

describe('computeRate', () => {
  const base = 1000;

  it('la banda diurna LD normal es la tarifa base', () => {
    expect(computeRate(base, 'day_ld', 'normal')).toBe(1000);
  });

  it('aplica los multiplicadores de banda', () => {
    expect(computeRate(base, 'night_ld', 'normal')).toBeCloseTo(1130, 10);
    expect(computeRate(base, 'day_hd', 'normal')).toBeCloseTo(1012.5, 10);
    expect(computeRate(base, 'night_hd', 'normal')).toBeCloseTo(1144.125, 10);
  });

  it('compone banda y tramo', () => {
    expect(computeRate(base, 'day_ld', 'additional')).toBeCloseTo(1250, 10);
    expect(computeRate(base, 'day_ld', 'overtime_50')).toBeCloseTo(1500, 10);
    expect(computeRate(base, 'day_ld', 'overtime_100')).toBeCloseTo(2000, 10);
    expect(computeRate(base, 'night_ld', 'overtime_100')).toBeCloseTo(2260, 10);
  });

  it('no redondea la tarifa (el redondeo va al final)', () => {
    expect(computeRate(4040.16029, 'night_ld', 'normal')).toBeCloseTo(4565.3811277, 6);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Liquidación real: julio 2026
// ─────────────────────────────────────────────────────────────────────

describe('liquidación de julio 2026', () => {
  const agents = fixture.agents;
  const TOLERANCIA = 0.01; // un centavo

  it('el fixture trae los 13 agentes', () => {
    expect(agents).toHaveLength(13);
  });

  it.each(agents.map((a) => [a.agent, a] as const))(
    'reproduce el subtotal de %s',
    (_nombre, a) => {
      const subtotal = subtotalFromBuckets(
        a.buckets as HourBucket[],
        a.baseRate,
        DEFAULT_RATE_FACTORS
      );

      // Tres hojas del Excel tienen el tramo "Adicional" escrito como 20% en el
      // encabezado. El criterio acordado es 25% para todos, así que en esos casos
      // el motor paga de más a propósito.
      const horasAdicionales = (a.buckets as HourBucket[])
        .filter((b) => b.tier === 'additional')
        .reduce((s, b) => s + b.hours, 0);
      const desvioEsperado =
        a.expected.additionalPctInSheet !== null &&
        Math.abs(a.expected.additionalPctInSheet - 0.25) > 1e-9
          ? horasAdicionales * a.baseRate * (0.25 - a.expected.additionalPctInSheet)
          : 0;

      expect(subtotal - desvioEsperado).toBeCloseTo(a.expected.subtotal, 2);
    }
  );

  it.each(agents.map((a) => [a.agent, a] as const))(
    'reproduce el neto de %s',
    (_nombre, a) => {
      const subtotal = subtotalFromBuckets(
        a.buckets as HourBucket[],
        a.baseRate,
        DEFAULT_RATE_FACTORS
      );
      const conceptos = computeConcepts({
        subtotal,
        baseRate: a.baseRate,
        unworkedHolidayHours: a.unworkedHolidayHours,
        vacationHours: a.vacationHours,
        params: a.params as SettlementParams,
      });
      const neto = roundCents(
        subtotal +
          conceptos.reduce((s, c) => s + c.amount, 0) +
          a.manualItemsTotal
      );

      const horasAdicionales = (a.buckets as HourBucket[])
        .filter((b) => b.tier === 'additional')
        .reduce((s, b) => s + b.hours, 0);
      const desvioSubtotal =
        a.expected.additionalPctInSheet !== null &&
        Math.abs(a.expected.additionalPctInSheet - 0.25) > 1e-9
          ? horasAdicionales * a.baseRate * (0.25 - a.expected.additionalPctInSheet)
          : 0;
      // El desvío arrastra a los conceptos que son % del subtotal
      const pctSobreSubtotal =
        a.params.reg_people_pct +
        a.params.reg_quantitative_pct +
        a.params.reg_qualitative_pct +
        a.params.super_reg_pct +
        a.params.equipment_pct +
        a.params.seniority_months * 0.0008333;

      expect(neto - desvioSubtotal * (1 + pctSobreSubtotal)).toBeCloseTo(
        a.expected.net,
        TOLERANCIA
      );
    }
  );

  it('sólo Micaela Abraham cambia al llevar el Adicional a 25%', () => {
    const cambian = agents.filter(
      (a) =>
        a.expected.additionalPctInSheet !== null &&
        Math.abs(a.expected.additionalPctInSheet - 0.25) > 1e-9 &&
        (a.buckets as HourBucket[]).some((b) => b.tier === 'additional' && b.hours > 0)
    );
    expect(cambian.map((a) => a.agent)).toEqual(['Micaela Abraham']);
  });

  it('el total liquidado del período cierra contra la planilla', () => {
    const esperado = agents.reduce((s, a) => s + a.expected.net, 0);
    const calculado = agents.reduce((s, a) => {
      const subtotal = subtotalFromBuckets(
        a.buckets as HourBucket[],
        a.baseRate,
        DEFAULT_RATE_FACTORS
      );
      const conceptos = computeConcepts({
        subtotal,
        baseRate: a.baseRate,
        unworkedHolidayHours: a.unworkedHolidayHours,
        vacationHours: a.vacationHours,
        params: a.params as SettlementParams,
      });
      return s + subtotal + conceptos.reduce((x, c) => x + c.amount, 0) + a.manualItemsTotal;
    }, 0);

    // La única diferencia admitida es la corrección del Adicional de Micaela.
    expect(calculado - esperado).toBeCloseTo(246.45, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Armado del desglose a partir del esquema
// ─────────────────────────────────────────────────────────────────────

/** Esquema de Yanina Benítez, con el turno partido de los lunes. */
const ESQUEMA_YANINA: ScheduleSlot[] = [
  { day_of_week: 1, start_time: '09:00', end_time: '13:00', client_id: 'c1' }, // lunes, 1er tramo
  { day_of_week: 1, start_time: '15:00', end_time: '18:00', client_id: 'c1' }, // lunes, 2do tramo
  { day_of_week: 2, start_time: '08:00', end_time: '15:00', client_id: 'c1' },
  { day_of_week: 3, start_time: '11:00', end_time: '19:00', client_id: 'c1' },
  { day_of_week: 4, start_time: '12:00', end_time: '16:00', client_id: 'c1' },
  { day_of_week: 5, start_time: '12:00', end_time: '16:00', client_id: 'c1' },
];

const FERIADOS_JULIO = new Set(['2026-07-09', '2026-07-10']);

function diasDeJulio(overrides: Record<string, DayContext['exception']> = {}): DayContext[] {
  const days: DayContext[] = [];
  for (let d = 1; d <= 31; d++) {
    const date = `2026-07-${String(d).padStart(2, '0')}`;
    days.push({
      date,
      isHoliday: FERIADOS_JULIO.has(date),
      exception: overrides[date] ?? null,
    });
  }
  return days;
}

const porEsquema = (slots: ScheduleSlot[]) => (date: string) => {
  const jsDow = new Date(date + 'T12:00:00').getDay();
  return slots.filter((s) => s.day_of_week === jsDow);
};

describe('buildDailyLines', () => {
  const totalHoras = (lines: { hours: number }[]) => lines.reduce((s, l) => s + l.hours, 0);

  it('reproduce las 128 h de esquema de Yanina en julio 2026', () => {
    const r = buildDailyLines({
      days: diasDeJulio(),
      schedulesByDate: porEsquema(ESQUEMA_YANINA),
      overtime: [],
    });
    expect(totalHoras(r.lines)).toBeCloseTo(128, 6);
    expect(r.lines.every((l) => l.band === 'day_ld')).toBe(true);
    expect(r.lines.every((l) => l.tier === 'normal')).toBe(true);
  });

  it('cuenta las horas de esquema del feriado para compensarlas aparte', () => {
    const r = buildDailyLines({
      days: diasDeJulio(),
      schedulesByDate: porEsquema(ESQUEMA_YANINA),
      overtime: [],
    });
    // Jueves 9 (4 h) + viernes 10 (4 h) — el coeficiente que usa la planilla
    expect(r.unworkedHolidayHours).toBe(8);
    expect(r.lines.some((l) => FERIADOS_JULIO.has(l.date))).toBe(false);
  });

  it('toma los dos tramos del turno partido de los lunes', () => {
    const lunes = buildDailyLines({
      days: [{ date: '2026-07-06', isHoliday: false, exception: null }],
      schedulesByDate: porEsquema(ESQUEMA_YANINA),
      overtime: [],
    });
    expect(totalHoras(lunes.lines)).toBe(7); // 4 h + 3 h, no 4 h
  });

  it('no liquida las ausencias', () => {
    const r = buildDailyLines({
      days: diasDeJulio({ '2026-07-06': 'absence' }),
      schedulesByDate: porEsquema(ESQUEMA_YANINA),
      overtime: [],
    });
    expect(totalHoras(r.lines)).toBeCloseTo(121, 6); // 128 − 7
    expect(r.absenceDates).toEqual(['2026-07-06']);
  });

  it('paga las vacaciones según esquema y las contabiliza para el plus', () => {
    const r = buildDailyLines({
      days: diasDeJulio({ '2026-07-07': 'vacation', '2026-07-08': 'vacation' }),
      schedulesByDate: porEsquema(ESQUEMA_YANINA),
      overtime: [],
    });
    expect(totalHoras(r.lines)).toBeCloseTo(128, 6); // se siguen pagando
    expect(r.vacationHours).toBe(15); // martes 7 h + miércoles 8 h
    expect(r.lines.filter((l) => l.date === '2026-07-07').every((l) => l.source === 'exception'))
      .toBe(true);
  });

  it('si hay cobertura extraordinaria, el feriado se trabaja y se paga', () => {
    const r = buildDailyLines({
      days: diasDeJulio({ '2026-07-09': 'extraordinary_coverage' }),
      schedulesByDate: porEsquema(ESQUEMA_YANINA),
      overtime: [],
    });
    expect(r.unworkedHolidayHours).toBe(4); // sólo el viernes 10
    expect(r.lines.some((l) => l.date === '2026-07-09')).toBe(true);
  });

  it('suma las horas adicionales con su tramo', () => {
    const overtime: OvertimeRecord[] = [
      { date: '2026-07-01', hours: 1, start_time: '08:00', end_time: '09:00', tier: 'additional', client_id: 'c1' },
    ];
    const r = buildDailyLines({
      days: diasDeJulio(),
      schedulesByDate: porEsquema(ESQUEMA_YANINA),
      overtime,
    });
    const extra = r.lines.filter((l) => l.tier === 'additional');
    expect(extra).toHaveLength(1);
    expect(extra[0].hours).toBe(1);
    expect(extra[0].source).toBe('overtime');
  });

  it('no paga horas extra cargadas en un día de ausencia', () => {
    const overtime: OvertimeRecord[] = [
      { date: '2026-07-06', hours: 2, start_time: null, end_time: null, tier: 'overtime_50', client_id: null },
    ];
    const r = buildDailyLines({
      days: diasDeJulio({ '2026-07-06': 'absence' }),
      schedulesByDate: porEsquema(ESQUEMA_YANINA),
      overtime,
    });
    expect(r.lines.some((l) => l.date === '2026-07-06')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Alertas contra las marcaciones
// ─────────────────────────────────────────────────────────────────────

describe('compareAgainstClockIns', () => {
  const miercoles: DayContext[] = [{ date: '2026-07-01', isHoliday: false, exception: null }];
  const obs = (o: Partial<ClockObservation>): Map<string, ClockObservation> =>
    new Map([['2026-07-01', { date: '2026-07-01', clockedHours: null, clockIn: null, clockOut: null, ...o }]]);

  it('avisa cuando se pagó esquema sin marcación', () => {
    const w = compareAgainstClockIns(miercoles, porEsquema(ESQUEMA_YANINA), new Map());
    expect(w).toHaveLength(1);
    expect(w[0].code).toBe('no_clock_in');
  });

  it('avisa cuando falta el egreso', () => {
    const w = compareAgainstClockIns(miercoles, porEsquema(ESQUEMA_YANINA), obs({ clockIn: '11:00' }));
    expect(w[0].code).toBe('no_clock_out');
  });

  it('no se queja si entró dentro de la tolerancia', () => {
    const w = compareAgainstClockIns(
      miercoles,
      porEsquema(ESQUEMA_YANINA),
      obs({ clockIn: '11:10', clockOut: '19:10', clockedHours: 8 })
    );
    expect(w).toHaveLength(0);
  });

  it('marca la llegada tarde y la salida temprana', () => {
    const w = compareAgainstClockIns(
      miercoles,
      porEsquema(ESQUEMA_YANINA),
      obs({ clockIn: '12:00', clockOut: '17:00', clockedHours: 5 })
    );
    expect(w.map((x) => x.code).sort()).toEqual(['arrived_late', 'left_early']);
  });

  it('marca haber trabajado un día sin esquema', () => {
    const sabado: DayContext[] = [{ date: '2026-07-04', isHoliday: false, exception: null }];
    const w = compareAgainstClockIns(
      sabado,
      porEsquema(ESQUEMA_YANINA),
      new Map([['2026-07-04', { date: '2026-07-04', clockIn: '09:00', clockOut: '15:00', clockedHours: 6 }]])
    );
    expect(w[0].code).toBe('worked_without_schedule');
  });

  it('no reclama marcación en feriados ni en días con excepción', () => {
    const feriado: DayContext[] = [{ date: '2026-07-09', isHoliday: true, exception: null }];
    expect(compareAgainstClockIns(feriado, porEsquema(ESQUEMA_YANINA), new Map())).toHaveLength(0);

    const vacaciones: DayContext[] = [{ date: '2026-07-01', isHoliday: false, exception: 'vacation' }];
    expect(compareAgainstClockIns(vacaciones, porEsquema(ESQUEMA_YANINA), new Map())).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Período de liquidación
// ─────────────────────────────────────────────────────────────────────

describe('settlementPeriod', () => {
  it('julio 2026 va del 26 de junio al 25 de julio', () => {
    expect(settlementPeriod(2026, 7, 26)).toEqual({ from: '2026-06-26', to: '2026-07-25' });
  });

  it('cruza el año correctamente', () => {
    expect(settlementPeriod(2026, 1, 26)).toEqual({ from: '2025-12-26', to: '2026-01-25' });
  });

  it('con día 1 es el mes calendario, no el anterior', () => {
    expect(settlementPeriod(2026, 7, 1)).toEqual({ from: '2026-07-01', to: '2026-07-31' });
    expect(settlementPeriod(2026, 2, 1)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('con día 1 permite reproducir la grilla del Excel para comparar', () => {
    // La planilla liquidaba julio con el mes calendario
    expect(settlementPeriod(2026, 7, 1).from).toBe('2026-07-01');
  });
});

// ─────────────────────────────────────────────────────────────────────
// De punta a punta: esquema → horas → tarifas → conceptos → neto
//
// Los bloques anteriores validan la mitad de abajo de la cadena: reciben las
// horas ya clasificadas y verifican el precio. Este bloque arranca del esquema
// del agente, que es lo que hace el motor en producción.
// ─────────────────────────────────────────────────────────────────────

describe('de punta a punta: esquema → neto (julio 2026)', () => {
  /**
   * Agentes donde el motor NO reproduce la planilla. En los seis casos la causa
   * está en los datos de entrada, no en el cálculo — ver validacion/conciliar_presentismo.py.
   * Se dejan fijados para que cualquier cambio del motor los mueva y salte el test.
   */
  const DESVIOS_CONOCIDOS: Record<string, { horas: number; motivo: string }> = {
    'Paola Farías': {
      horas: -15.0833,
      motivo: "el esquema dice 09:00-18:00 (9 h) pero se le liquidan 9:45 por día",
    },
    'María Sol Olaviaga': {
      horas: -12,
      motivo: 'tres días de cobertura de 8 h sin excepción cargada, uno de ellos el feriado del 10',
    },
    'Walter Palavecino': {
      horas: -4,
      motivo: 'el esquema dice 4 h los jueves y se le liquidan 5',
    },
    'Alanis Brenda': {
      horas: -1,
      motivo: 'el esquema dice 5 h el jueves 2 y se le liquidan 6',
    },
    'Moreno Laura': {
      horas: -1,
      motivo: 'el esquema dice 5 h el jueves 2 y se le liquidan 6',
    },
    'Bissuti Stefano': {
      horas: -6,
      motivo: 'arrastre del 30/06 cargado en el sábado 4; con el período 26→25 cae en el mes anterior',
    },
  };

  /** Micaela es el único cambio deliberado: el Adicional pasa de 20% a 25%. */
  const CORRECCION_ADICIONAL: Record<string, number> = { 'Micaela Abraham': 246.45 };

  const diasDeJulio2026 = (): DayContext[] => {
    const feriados = new Set(fixture.holidays);
    const days: DayContext[] = [];
    for (let d = 1; d <= 31; d++) {
      const date = `2026-07-${String(d).padStart(2, '0')}`;
      days.push({ date, isHoliday: feriados.has(date), exception: null });
    }
    return days;
  };

  /** Corre la cadena completa tal como lo hace `generatePreSettlement`. */
  function liquidar(a: (typeof fixture.agents)[number]) {
    const slots = a.schedule as ScheduleSlot[];
    const schedulesByDate = (date: string) => {
      const jsDow = new Date(date + 'T12:00:00').getDay();
      return slots.filter((s) => s.day_of_week === jsDow);
    };

    const built = buildDailyLines({
      days: diasDeJulio2026(),
      schedulesByDate,
      overtime: a.overtime as OvertimeRecord[],
    });

    const subtotal = built.lines.reduce(
      (s, l) => s + l.hours * computeRate(a.baseRate, l.band, l.tier, DEFAULT_RATE_FACTORS),
      0
    );
    const conceptos = computeConcepts({
      subtotal,
      baseRate: a.baseRate,
      unworkedHolidayHours: built.unworkedHolidayHours,
      vacationHours: built.vacationHours,
      params: a.params as SettlementParams,
    });

    return {
      horas: built.lines.reduce((s, l) => s + l.hours, 0),
      unworkedHolidayHours: built.unworkedHolidayHours,
      neto: roundCents(subtotal + conceptos.reduce((s, c) => s + c.amount, 0) + a.manualItemsTotal),
    };
  }

  const conEsquema = fixture.agents.filter((a) => a.schedule !== null);
  const sinDesvio = conEsquema.filter((a) => !(a.agent in DESVIOS_CONOCIDOS));

  it('12 de los 13 agentes tienen esquema cargado', () => {
    expect(conEsquema).toHaveLength(12);
    expect(fixture.agents.filter((a) => a.schedule === null).map((a) => a.agent))
      .toEqual(['Ferreyra Priscila']);
  });

  it.each(sinDesvio.map((a) => [a.agent, a] as const))(
    'parte del esquema y llega al neto exacto de %s',
    (nombre, a) => {
      const r = liquidar(a);
      expect(r.horas).toBeCloseTo(a.expectedHours, 4);
      expect(r.unworkedHolidayHours).toBeCloseTo(a.unworkedHolidayHours, 4);
      expect(r.neto).toBeCloseTo(a.expected.net + (CORRECCION_ADICIONAL[nombre] ?? 0), 2);
    }
  );

  it.each(Object.entries(DESVIOS_CONOCIDOS))(
    'el desvío de %s sigue siendo el conocido',
    (nombre, esperado) => {
      const a = fixture.agents.find((x) => x.agent === nombre)!;
      const r = liquidar(a);
      expect(r.horas - a.expectedHours).toBeCloseTo(esperado.horas, 3);
    }
  );

  it('no queda ninguna diferencia sin explicar', () => {
    // Los únicos agentes que pueden diferir son los seis con datos de entrada
    // desactualizados, más Micaela por la corrección del Adicional.
    const conDiferencia = conEsquema
      .filter((a) => Math.abs(liquidar(a).neto - a.expected.net) > 0.01)
      .map((a) => a.agent)
      .sort();

    expect(conDiferencia).toEqual(
      [...Object.keys(DESVIOS_CONOCIDOS), ...Object.keys(CORRECCION_ADICIONAL)].sort()
    );
  });

  it('la brecha total es la que aportan los desvíos conocidos', () => {
    const netoPlanilla = conEsquema.reduce((s, a) => s + a.expected.net, 0);
    const netoMotor = conEsquema.reduce((s, a) => s + liquidar(a).neto, 0);

    const brechaEsperada = conEsquema
      .filter((a) => a.agent in DESVIOS_CONOCIDOS || a.agent in CORRECCION_ADICIONAL)
      .reduce((s, a) => s + (liquidar(a).neto - a.expected.net), 0);

    expect(netoMotor - netoPlanilla).toBeCloseTo(brechaEsperada, 2);
    // Para dimensionarla: ~2% del total, todo por datos de entrada
    expect(Math.abs(brechaEsperada) / netoPlanilla).toBeLessThan(0.025);
  });
});

describe('mergeDailyLines', () => {
  it('junta los dos tramos del turno partido en una sola línea', () => {
    const r = buildDailyLines({
      days: [{ date: '2026-07-06', isHoliday: false, exception: null }],
      schedulesByDate: porEsquema(ESQUEMA_YANINA),
      overtime: [],
    });
    // El lunes son 09:00-13:00 + 15:00-18:00: una línea de 7 h, no dos
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].hours).toBe(7);
  });

  it('no junta si cambia el cliente', () => {
    const dosClientes: ScheduleSlot[] = [
      { day_of_week: 1, start_time: '09:00', end_time: '13:00', client_id: 'a' },
      { day_of_week: 1, start_time: '15:00', end_time: '18:00', client_id: 'b' },
    ];
    const r = buildDailyLines({
      days: [{ date: '2026-07-06', isHoliday: false, exception: null }],
      schedulesByDate: porEsquema(dosClientes),
      overtime: [],
    });
    expect(r.lines).toHaveLength(2);
  });

  it('no junta el esquema con las horas extra', () => {
    const r = buildDailyLines({
      days: [{ date: '2026-07-06', isHoliday: false, exception: null }],
      schedulesByDate: porEsquema(ESQUEMA_YANINA),
      overtime: [{ date: '2026-07-06', hours: 2, start_time: null, end_time: null,
                   tier: 'additional', client_id: 'c1' }],
    });
    expect(r.lines).toHaveLength(2);
    expect(r.lines.map((l) => l.tier).sort()).toEqual(['additional', 'normal']);
  });

  it('el total de horas no cambia al juntar', () => {
    const r = buildDailyLines({
      days: diasDeJulio(),
      schedulesByDate: porEsquema(ESQUEMA_YANINA),
      overtime: [],
    });
    expect(r.lines.reduce((s, l) => s + l.hours, 0)).toBeCloseTo(128, 6);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Conciliación del período anterior
// ─────────────────────────────────────────────────────────────────────

describe('computeAdjustments', () => {
  const pagado = (date: string, hours: number, tier: Tier = 'normal'): PaidLine =>
    ({ date, band: 'day_ld', tier, hours, client_id: 'c1' });
  const real = (date: string, hours: number, tier: Tier = 'normal'): DailyLine =>
    ({ date, band: 'day_ld', tier, hours, client_id: 'c1', source: 'schedule' });

  const DIAS = ['2026-07-29', '2026-07-30', '2026-07-31'];

  it('no ajusta nada si la realidad coincidió con lo proyectado', () => {
    const r = computeAdjustments(
      DIAS.map((d) => pagado(d, 7)),
      DIAS.map((d) => real(d, 7)),
      DIAS
    );
    expect(r).toEqual([]);
  });

  it('descuenta lo pagado de más cuando el día terminó siendo una ausencia', () => {
    const r = computeAdjustments(
      DIAS.map((d) => pagado(d, 7)),
      [real('2026-07-29', 7), real('2026-07-31', 7)], // el 30 no se trabajó
      DIAS
    );
    expect(r).toHaveLength(1);
    expect(r[0].date).toBe('2026-07-30');
    expect(r[0].hours).toBe(-7);
    expect(r[0].source).toBe('adjustment');
  });

  it('suma lo que faltó cuando aparecieron horas después del cierre', () => {
    const r = computeAdjustments(
      [pagado('2026-07-29', 7)],
      [real('2026-07-29', 7), real('2026-07-29', 2, 'additional')],
      DIAS
    );
    expect(r).toHaveLength(1);
    expect(r[0].tier).toBe('additional');
    expect(r[0].hours).toBe(2);
  });

  it('ajusta la diferencia parcial de un día', () => {
    const r = computeAdjustments([pagado('2026-07-29', 7)], [real('2026-07-29', 4)], DIAS);
    expect(r[0].hours).toBe(-3);
  });

  it('ignora los días fuera del rango a conciliar', () => {
    const r = computeAdjustments(
      [pagado('2026-07-01', 7), pagado('2026-07-29', 7)],
      [real('2026-07-29', 7)], // el 01 no se recalculó: está fuera del rango
      DIAS
    );
    expect(r).toEqual([]);
  });

  it('separa el ajuste por banda y por tramo', () => {
    const r = computeAdjustments(
      [pagado('2026-07-29', 7), pagado('2026-07-29', 2, 'overtime_50')],
      [real('2026-07-29', 5)],
      DIAS
    );
    expect(r).toHaveLength(2);
    expect(r.find((x) => x.tier === 'normal')?.hours).toBe(-2);
    expect(r.find((x) => x.tier === 'overtime_50')?.hours).toBe(-2);
  });

  it('conserva la fecha original aunque caiga fuera del período que se liquida', () => {
    const r = computeAdjustments([pagado('2026-07-31', 7)], [], DIAS);
    expect(r[0].date).toBe('2026-07-31');
  });
});

describe('reintegro de monotributo', () => {
  const base = { subtotal: 500_000, baseRate: 4040.16029, unworkedHolidayHours: 0, vacationHours: 0 };
  const params = (over: Partial<SettlementParams>): SettlementParams => ({
    ...DEFAULT_SETTLEMENT_PARAMS,
    equipment_pct: 0,
    holiday_compensation_factor: 0,
    ...over,
  });

  it('se paga por el importe cargado, sin tocar el subtotal', () => {
    const lines = computeConcepts({
      ...base,
      params: params({ monotributo_reimbursement: 70497.18 }),
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].concept).toBe('monotributo');
    expect(lines[0].amount).toBe(70497.18);
  });

  it('no aparece si no se cargó nada para el mes', () => {
    const lines = computeConcepts({ ...base, params: params({ monotributo_reimbursement: 0 }) });
    expect(lines.map((l) => l.concept)).not.toContain('monotributo');
  });

  it('no escala con el subtotal: es un importe fijo', () => {
    const p = params({ monotributo_reimbursement: 49527.18 });
    const chico = computeConcepts({ ...base, subtotal: 100_000, params: p });
    const grande = computeConcepts({ ...base, subtotal: 900_000, params: p });
    expect(chico[0].amount).toBe(grande[0].amount);
  });

  it('convive con los conceptos que sí son porcentaje', () => {
    const lines = computeConcepts({
      ...base,
      params: params({ reg_people_pct: 0.04, monotributo_reimbursement: 61032.18 }),
    });
    expect(lines.map((l) => l.concept)).toEqual(['reg', 'monotributo']);
    expect(lines[0].amount).toBeCloseTo(20_000, 6);
    expect(lines[1].amount).toBe(61032.18);
  });
});

describe('tope de las horas cargadas contra lo trabajado', () => {
  // Esquema del miércoles: 09:00 a 16:00 = 7 h
  const ESQUEMA: ScheduleSlot[] = [
    { day_of_week: 3, start_time: '09:00', end_time: '16:00', client_id: 'c1' },
  ];
  const porDia = (d: string) =>
    ESQUEMA.filter((s) => s.day_of_week === new Date(d + 'T12:00:00').getDay());

  const FECHA = '2026-07-01';
  const dias: DayContext[] = [{ date: FECHA, isHoliday: false, exception: null }];

  const marcado = (clockIn: string, clockOut: string, horas: number) =>
    new Map<string, ClockObservation>([
      [FECHA, { date: FECHA, clockIn, clockOut, clockedHours: horas }],
    ]);

  const cargado = (hours: number, tier: Tier = 'additional'): OvertimeRecord[] => [
    { date: FECHA, hours, start_time: null, end_time: null, tier, client_id: 'c1' },
  ];

  const liquidar = (overtime: OvertimeRecord[], observations: Map<string, ClockObservation>) =>
    buildDailyLines({ days: dias, schedulesByDate: porDia, overtime, observations });

  it('paga esquema + adicional cuando trabajó exactamente lo cargado', () => {
    // 7 h de esquema, 1 h cargada, estuvo 8 h -> 7 normales + 1 adicional
    const r = liquidar(cargado(1), marcado('09:00', '17:00', 8));
    expect(r.lines.find((l) => l.tier === 'normal')!.hours).toBe(7);
    expect(r.lines.find((l) => l.tier === 'additional')!.hours).toBe(1);
    expect(r.lines.reduce((s, l) => s + l.hours, 0)).toBe(8);
  });

  it('no paga la adicional si trabajó justo su esquema', () => {
    const r = liquidar(cargado(1), marcado('09:00', '16:00', 7));
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].tier).toBe('normal');
    expect(r.lines[0].hours).toBe(7);
  });

  it('recorta la adicional a lo que efectivamente trabajó de más', () => {
    // Cargaron 2 h y sólo estuvo 1 h de más
    const r = liquidar(cargado(2), marcado('09:00', '17:00', 8));
    expect(r.lines.find((l) => l.tier === 'additional')!.hours).toBe(1);
    expect(r.lines.reduce((s, l) => s + l.hours, 0)).toBe(8);
  });

  it('no paga nada si el excedente no llega al umbral', () => {
    // 20 minutos de más: por debajo de los 30
    const r = liquidar(cargado(1), marcado('09:00', '16:20', 7 + 20 / 60));
    expect(r.lines.every((l) => l.tier === 'normal')).toBe(true);
  });

  it('el excedente suma lo de antes de entrar y lo de después de salir', () => {
    // 20 min antes + 20 min después = 40 min, pasa el umbral
    const r = liquidar(cargado(1), marcado('08:40', '16:20', 7 + 40 / 60));
    expect(r.lines.find((l) => l.tier === 'additional')!.hours).toBeCloseTo(40 / 60, 6);
  });

  it('sin marcaciones se paga lo cargado, como antes', () => {
    const r = buildDailyLines({ days: dias, schedulesByDate: porDia, overtime: cargado(1) });
    expect(r.lines.find((l) => l.tier === 'additional')!.hours).toBe(1);
  });

  it('las horas de más no se pagan solas si nadie las cargó', () => {
    const r = liquidar([], marcado('09:00', '18:00', 9));
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].hours).toBe(7);
  });

  it('con dos tramos cargados consume primero el de menor recargo', () => {
    const overtime: OvertimeRecord[] = [
      { date: FECHA, hours: 1, start_time: null, end_time: null, tier: 'overtime_50', client_id: 'c1' },
      { date: FECHA, hours: 1, start_time: null, end_time: null, tier: 'additional', client_id: 'c1' },
    ];
    // Sólo 1 h de excedente para dos horas cargadas
    const r = liquidar(overtime, marcado('09:00', '17:00', 8));
    expect(r.lines.find((l) => l.tier === 'additional')!.hours).toBe(1);
    expect(r.lines.find((l) => l.tier === 'overtime_50')).toBeUndefined();
  });
});

describe('reviewOvertimeOutcomes', () => {
  const dia = '2026-07-01';

  it('avisa cuando trabajó de más sin nada cargado', () => {
    const w = reviewOvertimeOutcomes([
      { date: dia, loadedHours: 0, excessHours: 2, paidHours: 0 },
    ]);
    expect(w).toHaveLength(1);
    expect(w[0].code).toBe('worked_more_than_schedule');
    expect(w[0].detail).toContain('sin horas cargadas');
  });

  it('avisa cuando lo cargado no cubre el excedente', () => {
    const w = reviewOvertimeOutcomes([
      { date: dia, loadedHours: 1, excessHours: 2, paidHours: 1 },
    ]);
    expect(w.map((x) => x.code)).toContain('worked_more_than_schedule');
    expect(w[0].detail).toContain('1.00 h sin autorizar');
  });

  it('no avisa si lo que falta cubrir está por debajo del umbral', () => {
    const w = reviewOvertimeOutcomes([
      { date: dia, loadedHours: 1, excessHours: 1.2, paidHours: 1 },
    ]);
    expect(w).toHaveLength(0);
  });

  it('avisa cuando se cargaron horas y no hubo excedente', () => {
    const w = reviewOvertimeOutcomes([
      { date: dia, loadedHours: 3, excessHours: 0.1, paidHours: 0 },
    ]);
    expect(w).toHaveLength(1);
    expect(w[0].code).toBe('additional_without_excess');
    expect(w[0].detail).toContain('no se liquidan');
  });

  it('avisa cuando se recortó por haber cargado más de lo trabajado', () => {
    const w = reviewOvertimeOutcomes([
      { date: dia, loadedHours: 2, excessHours: 1, paidHours: 1 },
    ]);
    expect(w.map((x) => x.code)).toContain('additional_over_worked');
  });

  it('no avisa nada cuando cargado y trabajado coinciden', () => {
    const w = reviewOvertimeOutcomes([
      { date: dia, loadedHours: 1, excessHours: 1, paidHours: 1 },
    ]);
    expect(w).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// El tope contra los datos reales de julio 2026
// ─────────────────────────────────────────────────────────────────────

describe('el tope sobre julio 2026 real', () => {
  const feriados = new Set(tope.holidays);
  const dias = (): DayContext[] => {
    const out: DayContext[] = [];
    for (let d = 1; d <= 31; d++) {
      const date = `2026-07-${String(d).padStart(2, '0')}`;
      out.push({ date, isHoliday: feriados.has(date), exception: null });
    }
    return out;
  };

  const correr = (a: (typeof tope.agents)[number]) => {
    const slots = a.schedule as ScheduleSlot[];
    const byDate = (date: string) =>
      slots.filter((s) => s.day_of_week === new Date(date + 'T12:00:00').getDay());
    const obs = new Map<string, ClockObservation>(
      (a.observations as ClockObservation[]).map((o) => [o.date, o])
    );
    return buildDailyLines({
      days: dias(),
      schedulesByDate: byDate,
      overtime: a.overtime as OvertimeRecord[],
      observations: obs,
    });
  };

  it('el fixture trae los 12 agentes con esquema', () => {
    expect(tope.agents).toHaveLength(12);
  });

  it('la planilla pagó 44,50 h de adicionales y la regla paga 31,00', () => {
    let planilla = 0;
    let regla = 0;
    for (const a of tope.agents) {
      planilla += Object.values(a.paidBySheet as Record<string, number>).reduce((s, v) => s + v, 0);
      regla += correr(a)
        .lines.filter((l) => l.tier !== 'normal')
        .reduce((s, l) => s + l.hours, 0);
    }
    expect(planilla).toBeCloseTo(44.5, 2);
    expect(regla).toBeCloseTo(31, 2);
  });

  it('los únicos 6 días que cambian son arrastres del mes anterior', () => {
    const cambios: string[] = [];
    for (const a of tope.agents) {
      const porFecha = new Map<string, number>();
      for (const l of correr(a).lines) {
        if (l.tier === 'normal') continue;
        porFecha.set(l.date, (porFecha.get(l.date) ?? 0) + l.hours);
      }
      for (const [fecha, pagado] of Object.entries(a.paidBySheet as Record<string, number>)) {
        const nuestro = porFecha.get(fecha) ?? 0;
        if (Math.abs(nuestro - pagado) > 0.02) cambios.push(`${a.agent} ${fecha}`);
      }
    }
    // Los seis tenían adicionales de junio cargadas en un día de julio donde el
    // agente no trabajó de más. La conciliación del período ya reemplaza esa
    // práctica, así que dejan de cargarse así.
    expect(cambios.sort()).toEqual([
      'Alanis Brenda 2026-07-02',
      'Ascona Gonzalo 2026-07-02',
      'Giuliana Yaccusi 2026-07-03',
      'Rodríguez Liliana 2026-07-06',
      'Walter Palavecino 2026-07-01',
      'Yanina Benitez 2026-07-03',
    ]);
  });

  it('las adicionales nunca superan el excedente trabajado', () => {
    // Las horas normales pueden superar lo marcado: se paga el esquema y eso se
    // avisa como `left_early`. Lo que el tope garantiza es que las adicionales
    // no pasen de lo que estuvo fuera del esquema.
    for (const a of tope.agents) {
      const r = correr(a);
      const porFecha = new Map<string, number>();
      for (const l of r.lines) {
        if (l.tier === 'normal') continue;
        porFecha.set(l.date, (porFecha.get(l.date) ?? 0) + l.hours);
      }
      const excedente = new Map(r.overtimeOutcomes.map((o) => [o.date, o.excessHours]));
      for (const [fecha, adicionales] of porFecha) {
        expect(adicionales).toBeLessThanOrEqual((excedente.get(fecha) ?? 0) + 0.001);
      }
    }
  });

  it('marca 38 días con excedente sin cubrir', () => {
    let dias = 0;
    for (const a of tope.agents) {
      const w = reviewOvertimeOutcomes(correr(a).overtimeOutcomes);
      dias += w.filter((x) => x.code === 'worked_more_than_schedule').length;
    }
    // 34 días sin nada cargado + 4 donde lo cargado no alcanza y lo que falta
    // supera el umbral por sí solo
    expect(dias).toBe(38);
  });

  it('marca los 6 días de adicionales cargadas sin excedente', () => {
    let dias = 0;
    for (const a of tope.agents) {
      const w = reviewOvertimeOutcomes(correr(a).overtimeOutcomes);
      dias += w.filter((x) => x.code === 'additional_without_excess').length;
    }
    expect(dias).toBe(6);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Ítems que se calculan
// ─────────────────────────────────────────────────────────────────────

describe('computeItemAmount', () => {
  const ctx = { subtotal: 800_000, baseRate: 4040.16029, factors: DEFAULT_RATE_FACTORS };

  it('el importe fijo se paga tal cual', () => {
    expect(computeItemAmount({ kind: 'fixed', amount: 70497.18 }, ctx)).toBe(70497.18);
  });

  it('el porcentaje se aplica sobre el subtotal', () => {
    expect(computeItemAmount({ kind: 'percentage', percentage: 0.09 }, ctx)).toBeCloseTo(72_000, 6);
  });

  it('el porcentaje sigue al subtotal cuando cambia', () => {
    const item = { kind: 'percentage' as const, percentage: 0.09 };
    expect(computeItemAmount(item, { ...ctx, subtotal: 400_000 })).toBeCloseTo(36_000, 6);
  });

  it('por tiempo: horas × valor hora × factor', () => {
    // La compensación de los 45 min de Paola: 0,75 h × 21 días = 15,75 h
    const horas = hoursFromMinutesPerDay(45, 21);
    expect(horas).toBe(15.75);
    expect(
      computeItemAmount(
        { kind: 'hourly', quantity: horas, band: 'day_ld', tier: 'normal', factor: 1 },
        ctx
      )
    ).toBeCloseTo(15.75 * 4040.16029, 4);
  });

  it('respeta la banda elegida', () => {
    const item = { kind: 'hourly' as const, quantity: 10, tier: 'normal' as const, factor: 1 };
    const diurna = computeItemAmount({ ...item, band: 'day_ld' }, ctx);
    const nocturna = computeItemAmount({ ...item, band: 'night_ld' }, ctx);
    expect(nocturna / diurna).toBeCloseTo(1.13, 6);
  });

  it('respeta el tramo elegido', () => {
    const item = { kind: 'hourly' as const, quantity: 10, band: 'day_ld' as const, factor: 1 };
    const normal = computeItemAmount({ ...item, tier: 'normal' }, ctx);
    const adicional = computeItemAmount({ ...item, tier: 'additional' }, ctx);
    expect(adicional / normal).toBeCloseTo(1.25, 6);
  });

  it('el factor 0,5 reproduce la compensación por feriado', () => {
    // Yanina: 8 h de feriado no trabajado al 50%
    expect(
      computeItemAmount(
        { kind: 'hourly', quantity: 8, band: 'day_ld', tier: 'normal', factor: 0.5 },
        ctx
      )
    ).toBeCloseTo(16160.64116, 4);
  });

  it('un ítem por tiempo no depende del subtotal', () => {
    const item = { kind: 'hourly' as const, quantity: 8, band: 'day_ld' as const,
                   tier: 'normal' as const, factor: 0.5 };
    expect(computeItemAmount(item, ctx)).toBe(computeItemAmount(item, { ...ctx, subtotal: 1 }));
  });

  it('los conceptos calculados declaran su forma de cálculo', () => {
    const lines = computeConcepts({
      subtotal: 800_000,
      baseRate: 4040.16029,
      unworkedHolidayHours: 8,
      vacationHours: 0,
      params: {
        ...DEFAULT_SETTLEMENT_PARAMS,
        reg_people_pct: 0.04,
        monotributo_reimbursement: 49527.18,
      },
    });
    const porConcepto = new Map(lines.map((l) => [l.concept, l]));
    expect(porConcepto.get('reg')!.kind).toBe('percentage');
    expect(porConcepto.get('equipment')!.kind).toBe('percentage');
    expect(porConcepto.get('holiday_compensation')!.kind).toBe('hourly');
    expect(porConcepto.get('holiday_compensation')!.quantity).toBe(8);
    expect(porConcepto.get('monotributo')!.kind).toBe('fixed');
  });

  it('recalcular con el subtotal corregido arrastra los porcentuales, no los fijos', () => {
    const lines = computeConcepts({
      subtotal: 800_000,
      baseRate: 4040.16029,
      unworkedHolidayHours: 8,
      vacationHours: 0,
      params: {
        ...DEFAULT_SETTLEMENT_PARAMS,
        reg_people_pct: 0.09,
        monotributo_reimbursement: 49527.18,
      },
    });
    // Se corrigieron horas: el subtotal baja a la mitad
    const nuevo = { subtotal: 400_000, baseRate: 4040.16029, factors: DEFAULT_RATE_FACTORS };
    const reg = lines.find((l) => l.concept === 'reg')!;
    const fnt = lines.find((l) => l.concept === 'holiday_compensation')!;
    const mono = lines.find((l) => l.concept === 'monotributo')!;

    expect(computeItemAmount(reg, nuevo)).toBeCloseTo(reg.amount / 2, 4);
    expect(computeItemAmount(fnt, nuevo)).toBeCloseTo(fnt.amount, 4);
    expect(computeItemAmount(mono, nuevo)).toBe(mono.amount);
  });
});
