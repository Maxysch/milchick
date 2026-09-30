/**
 * Las bandas horarias, con las mismas reglas que el motor (bandAt en
 * backend/src/services/settlement-calc.ts). Sirven para mostrar en qué banda cae
 * cada parte de un horario; lo que se paga lo sigue calculando el backend.
 */
export type Band = 'day_ld' | 'night_ld' | 'day_hd' | 'night_hd';

const H = 60;

/** @param isoDow 1 = lunes … 7 = domingo · @param minute minutos desde la medianoche */
export function bandAt(isoDow: number, minute: number): Band {
  const ldDayEnd = isoDow <= 4 ? 21 * H : isoDow === 5 ? 20 * H : -1;
  if (minute >= 6 * H && minute < ldDayEnd) return 'day_ld';
  if (isoDow <= 4 && minute >= 21 * H) return 'night_ld';
  if (isoDow >= 2 && isoDow <= 5 && minute < 5 * H) return 'night_ld';
  return minute >= 21 * H || minute < 6 * H ? 'night_hd' : 'day_hd';
}

/** Colores de fondo de cada banda en la vista semanal */
export const BAND_STYLE: Record<Band, { label: string; color: string }> = {
  day_ld: { label: 'Diurna LD', color: '#ffffff' },
  night_ld: { label: 'Nocturna LD', color: '#dbeafe' },
  day_hd: { label: 'Diurna HD', color: '#fef3c7' },
  night_hd: { label: 'Nocturna HD', color: '#e9d5ff' },
};

/** Día de la semana de JS (0 = domingo) → ISO (7 = domingo) */
export const isoDow = (jsDow: number) => (jsDow === 0 ? 7 : jsDow);

/**
 * Los tramos de banda constante entre dos minutos de un día. `to` puede pasar
 * de 1440: lo que cruza la medianoche cae en las bandas del día siguiente.
 */
export function bandSegments(iso: number, from: number, to: number, step = 15) {
  const out: { band: Band; from: number; to: number }[] = [];
  for (let m = from; m < to; m += step) {
    const offset = Math.floor(m / (24 * H));
    const dow = ((iso - 1 + offset) % 7) + 1;
    const band = bandAt(dow, m - offset * 24 * H);
    const end = Math.min(m + step, to);
    const last = out[out.length - 1];
    if (last && last.band === band && last.to === m) last.to = end;
    else out.push({ band, from: m, to: end });
  }
  return out;
}

/** "08:00" o "08:00:00" → minutos desde la medianoche */
export const toMinutes = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

/** Un tramo en minutos; si termina antes de empezar, cruza la medianoche */
export function blockMinutes(start: string, end: string): [number, number] {
  const a = toMinutes(start);
  const b = toMinutes(end);
  return [a, b > a ? b : b === a ? a : b + 24 * H];
}

/** 360 → "6 h" · 450 → "7,5 h" */
export const formatHours = (minutes: number) =>
  `${String(Number((minutes / 60).toFixed(2))).replace('.', ',')} h`;
