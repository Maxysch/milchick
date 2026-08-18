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
  DEFAULT_RATE_FACTORS,
  type Band,
  type ClockObservation,
  type DayContext,
  type HourBucket,
  type OvertimeRecord,
  type ScheduleSlot,
  type SettlementParams,
} from './settlement-calc.js';
import fixture from './__fixtures__/julio-2026.json' with { type: 'json' };

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

  it('con día 1 coincide con el mes calendario', () => {
    expect(settlementPeriod(2026, 3, 1)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
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
