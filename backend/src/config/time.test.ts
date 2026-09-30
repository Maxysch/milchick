import { describe, expect, it } from 'vitest';
import { localNow, localToday } from './time.js';

describe('la hora de la operación', () => {
  it('no depende del reloj del servidor: 01:30 UTC son las 22:30 del día anterior en Buenos Aires', () => {
    expect(localNow(new Date('2026-09-30T01:30:00Z'))).toEqual({ date: '2026-09-29', time: '22:30', minutes: 1350 });
  });

  it('una marcación a las 09:00 de Buenos Aires es 09:00, no las 12:00 de UTC', () => {
    expect(localNow(new Date('2026-08-03T12:00:00Z')).time).toBe('09:00');
  });

  it('la medianoche es 00:00, nunca 24:00', () => {
    expect(localNow(new Date('2026-09-30T03:05:00Z'))).toEqual({ date: '2026-09-30', time: '00:05', minutes: 5 });
    expect(localToday(new Date('2026-09-30T02:59:00Z'))).toBe('2026-09-29');
  });
});
