import { describe, expect, it } from 'vitest';
import { settlementParamsFor } from './settlement-calc.js';

describe('los parámetros con que se liquida un mes', () => {
  const perfil = {
    reg_people_pct: 0.04, reg_quantitative_pct: 0.02, reg_qualitative_pct: 0.03, super_reg_pct: 0.05,
    monotributo_reimbursement: '49527.18', equipment_pct: 0.05, seniority_months: 36,
    holiday_compensation_factor: 0.5, vacation_plus_factor: 0,
  };

  it('un mes sin evaluación usa los valores por defecto del perfil, monotributo incluido', () => {
    const p = settlementParamsFor(perfil, null);
    expect(p.reg_people_pct).toBe(0.04);
    expect(p.super_reg_pct).toBe(0.05);
    expect(p.monotributo_reimbursement).toBe(49527.18);
  });

  it('un mes cargado manda sobre el perfil, también con el monotributo en cero', () => {
    const p = settlementParamsFor(perfil, { reg_people_pct: 0.01, reg_quantitative_pct: 0, reg_qualitative_pct: 0, super_reg_pct: 0, monotributo_reimbursement: 0 });
    expect(p.reg_people_pct).toBe(0.01);
    expect(p.monotributo_reimbursement).toBe(0);
  });

  it('equipos, antigüedad y factores salen siempre del perfil', () => {
    const p = settlementParamsFor(perfil, { reg_people_pct: 0, monotributo_reimbursement: 61032.18 });
    expect(p).toMatchObject({ equipment_pct: 0.05, seniority_months: 36, holiday_compensation_factor: 0.5, monotributo_reimbursement: 61032.18 });
  });

  it('sin monotributo en el perfil, arranca en cero', () => {
    expect(settlementParamsFor({ ...perfil, monotributo_reimbursement: null }, null).monotributo_reimbursement).toBe(0);
  });
});
