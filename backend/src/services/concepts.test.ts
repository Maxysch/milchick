import { describe, expect, it } from 'vitest';
import { conceptKeyFromName, normalizeConceptName, similarConcepts } from '@milchick/shared';

describe('los nombres de los conceptos', () => {
  it('mayúsculas, acentos y signos no hacen un concepto distinto', () => {
    expect(normalizeConceptName('Bono')).toBe('bono');
    expect(normalizeConceptName('BONO.')).toBe('bono');
    expect(normalizeConceptName('  Compensación  ESPECIAL—Nº 2 ')).toBe('compensacion especial n 2');
    expect(normalizeConceptName('compensacion_especial')).toBe(normalizeConceptName('Compensación especial'));
  });

  it('la clave sale del nombre, limpia', () => {
    expect(conceptKeyFromName('Bono por cobertura')).toBe('bono_por_cobertura');
    expect(conceptKeyFromName('Reintegro de internet (fijo)')).toBe('reintegro_de_internet_fijo');
  });
});

describe('los parecidos', () => {
  const catalogo = [
    { name: 'Bono por objetivos' },
    { name: 'Bono por cobertura' },
    { name: 'Reintegro de internet' },
    { name: 'Compensación especial' },
    { name: 'Adelanto de honorarios' },
  ];
  const nombres = (texto: string) => similarConcepts(texto, catalogo).map((c) => c.name);

  it('encuentra el mismo concepto escrito de otra forma', () => {
    expect(nombres('compensacion especial')[0]).toBe('Compensación especial');
    expect(nombres('Reintegro de Internet')[0]).toBe('Reintegro de internet');
  });

  it('ofrece los que empiezan igual mientras se escribe', () => {
    expect(nombres('bono')).toEqual(expect.arrayContaining(['Bono por objetivos', 'Bono por cobertura']));
  });

  it('tolera un error de tipeo', () => {
    expect(nombres('Reintegro de interet')[0]).toBe('Reintegro de internet');
    expect(nombres('Bono por obejtivos')[0]).toBe('Bono por objetivos');
  });

  it('no se fija en "por", "de" o "x", ni en singular o plural', () => {
    expect(nombres('bono objetivo')[0]).toBe('Bono por objetivos');
    expect(nombres('Bono x objetivos')[0]).toBe('Bono por objetivos');
    expect(nombres('Adelantos honorarios')[0]).toBe('Adelanto de honorarios');
  });

  it('una sola palabra en común entre varias no alcanza', () => {
    expect(nombres('Bono cobertura de turno')).not.toContain('Bono por objetivos');
    expect(nombres('Bono navideño')).toEqual([]);
    expect(nombres('Reintegro de gastos de viaje')).toEqual([]);
  });

  it('no inventa parecidos', () => {
    expect(nombres('Premio anual')).toEqual([]);
    expect(nombres('x')).toEqual([]);
  });
});
