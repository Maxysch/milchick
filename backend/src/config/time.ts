/**
 * La fecha y la hora de la operación.
 *
 * El servidor puede correr en cualquier zona horaria —en Vercel corre en UTC—,
 * así que nunca se usa su reloj local: una marcación a las 09:00 de Buenos
 * Aires es 09:00, y a las 22:30 sigue siendo el mismo día. APP_TIMEZONE permite
 * cambiar la zona si la operación estuviera en otra.
 */
export const APP_TIMEZONE = process.env.APP_TIMEZONE || 'America/Argentina/Buenos_Aires';

const formato = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Fecha (YYYY-MM-DD), hora (HH:MM) y minutos desde la medianoche, en la zona de la operación */
export function localNow(at: Date = new Date()): { date: string; time: string; minutes: number } {
  const p = Object.fromEntries(formato.formatToParts(at).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

/** Hoy, en la zona de la operación */
export const localToday = (at: Date = new Date()) => localNow(at).date;
