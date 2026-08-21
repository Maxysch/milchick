import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useFieldArray } from 'react-hook-form';
import { z } from 'zod';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { formatDate, formatCurrency } from '../../lib/utils';
import {
  AgentRate,
  cardClass,
  EmptyState,
  ErrorState,
  formatProfileName,
  inputClass,
  LoadingState,
  pageTitleClass,
  primaryButtonClass,
  secondaryButtonClass,
  tableClass,
  tdClass,
  thClass,
  useProfilesQuery,
} from '../shared';

// Los porcentajes se editan como número entero (4 = 4%) y se guardan en tanto
// por uno, que es lo que espera el motor.
const pctField = z.coerce.number().min(0).max(100);

const baseSchema = z.object({
  first_name: z.string().min(1, 'Ingresá el nombre'),
  last_name: z.string().min(1, 'Ingresá el apellido'),
  email: z.string().email('Ingresá un email válido'),
  employee_id: z.string().optional(),
  role: z.enum(['admin', 'supervisor', 'agent']),
  password: z.string().optional(),
  hire_date: z.string().optional(),
  reg_people_pct: pctField,
  reg_quantitative_pct: pctField,
  reg_qualitative_pct: pctField,
  super_reg_pct: pctField,
  equipment_pct: pctField,
  seniority_months: z.coerce.number().int().min(0),
  holiday_compensation_factor: z.coerce.number().min(0).max(2),
  vacation_plus_factor: z.coerce.number().min(0).max(2),
});

type ProfileFormValues = z.infer<typeof baseSchema>;

const rateSchema = z.object({
  id: z.string().optional(),
  amount_per_hour: z.coerce.number().positive('Ingresá un valor mayor a 0'),
  effective_from: z.string().min(1, 'Ingresá la vigencia'),
});

type RateFormValues = z.infer<typeof rateSchema>;

export default function AgentFormPage() {
  const { id } = useParams();
  const isEditing = Boolean(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const profilesQuery = useProfilesQuery();
  const [rateError, setRateError] = useState<string | null>(null);

  const schema = useMemo(() => {
    if (isEditing) {
      return baseSchema.extend({ password: z.string().optional() });
    }

    return baseSchema.extend({
      password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres'),
    });
  }, [isEditing]);

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      first_name: '',
      last_name: '',
      email: '',
      employee_id: '',
      role: 'agent',
      password: '',
      hire_date: '',
      reg_people_pct: 0,
      reg_quantitative_pct: 0,
      reg_qualitative_pct: 0,
      super_reg_pct: 0,
      equipment_pct: 5,
      seniority_months: 0,
      holiday_compensation_factor: 0.5,
      vacation_plus_factor: 0,
    },
  });

  const profileQuery = useQuery({
    queryKey: ['profiles', id],
    queryFn: () => api.get<{
      id: string; first_name: string; last_name: string; email: string;
      employee_id: string | null; role: 'admin' | 'supervisor' | 'agent';
      hire_date: string | null;
      reg_people_pct: number; reg_quantitative_pct: number; reg_qualitative_pct: number;
      super_reg_pct: number; equipment_pct: number; seniority_months: number;
      holiday_compensation_factor: number; vacation_plus_factor: number;
    }>(`/profiles/${id}`),
    enabled: isEditing,
  });

  const ratesQuery = useQuery({
    queryKey: ['agent-rates', id],
    queryFn: () => api.get<AgentRate[]>(`/agent-rates/profile/${id}`),
    enabled: isEditing,
  });

  useEffect(() => {
    if (!profileQuery.data) return;
    form.reset({
      first_name: profileQuery.data.first_name,
      last_name: profileQuery.data.last_name,
      email: profileQuery.data.email,
      employee_id: profileQuery.data.employee_id ?? '',
      role: profileQuery.data.role,
      password: '',
      hire_date: profileQuery.data.hire_date ?? '',
      reg_people_pct: Number(profileQuery.data.reg_people_pct ?? 0) * 100,
      reg_quantitative_pct: Number(profileQuery.data.reg_quantitative_pct ?? 0) * 100,
      reg_qualitative_pct: Number(profileQuery.data.reg_qualitative_pct ?? 0) * 100,
      super_reg_pct: Number(profileQuery.data.super_reg_pct ?? 0) * 100,
      equipment_pct: Number(profileQuery.data.equipment_pct ?? 0) * 100,
      seniority_months: Number(profileQuery.data.seniority_months ?? 0),
      holiday_compensation_factor: Number(profileQuery.data.holiday_compensation_factor ?? 0),
      vacation_plus_factor: Number(profileQuery.data.vacation_plus_factor ?? 0),
    });
  }, [form, profileQuery.data]);

  const saveProfileMutation = useMutation({
    mutationFn: async (values: ProfileFormValues) => {
      const settlementParams = {
        hire_date: values.hire_date || null,
        reg_people_pct: values.reg_people_pct / 100,
        reg_quantitative_pct: values.reg_quantitative_pct / 100,
        reg_qualitative_pct: values.reg_qualitative_pct / 100,
        super_reg_pct: values.super_reg_pct / 100,
        equipment_pct: values.equipment_pct / 100,
        seniority_months: values.seniority_months,
        holiday_compensation_factor: values.holiday_compensation_factor,
        vacation_plus_factor: values.vacation_plus_factor,
      };

      if (isEditing && id) {
        return api.patch(`/profiles/${id}`, {
          first_name: values.first_name,
          last_name: values.last_name,
          employee_id: values.employee_id || null,
          role: values.role,
          ...settlementParams,
        });
      }

      return api.post<{ id: string }>('/profiles', {
        first_name: values.first_name,
        last_name: values.last_name,
        email: values.email,
        employee_id: values.employee_id || null,
        role: values.role,
        password: values.password,
        ...settlementParams,
      });
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['profiles'] }),
        queryClient.invalidateQueries({ queryKey: ['profiles', id] }),
      ]);

      if (!isEditing && result && typeof result === 'object' && 'id' in result && typeof result.id === 'string') {
        navigate(`/agents/${result.id}`);
        return;
      }

      navigate('/agents');
    },
  });

  const rateForm = useForm<{ rates: RateFormValues[] }>({
    defaultValues: {
      rates: [{ amount_per_hour: 0, effective_from: '' }],
    },
  });
  const rateFields = useFieldArray({ control: rateForm.control, name: 'rates' });

  const saveRatesMutation = useMutation({
    mutationFn: (values: RateFormValues[]) => api.put(`/agent-rates/profile/${id}`, { rates: values }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['agent-rates', id] });
      setRateError(null);
      rateForm.reset({ rates: [{ amount_per_hour: 0, effective_from: '' }] });
    },
    onError: (error) => {
      setRateError((error as Error).message);
    },
  });

  const deleteRateMutation = useMutation({
    mutationFn: (rateId: string) => api.delete<void>(`/agent-rates/${rateId}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['agent-rates', id] });
    },
  });

  const handleProfileSubmit = form.handleSubmit((values) => saveProfileMutation.mutate(values));

  // Se recalculan mientras se escribe, para no tener que sumar de cabeza
  const watched = form.watch();
  const regTotal =
    Number(watched.reg_people_pct || 0) +
    Number(watched.reg_quantitative_pct || 0) +
    Number(watched.reg_qualitative_pct || 0);
  const seniorityMonths = Number(watched.seniority_months || 0);

  const handleRatesSubmit = rateForm.handleSubmit((values) => {
    if (!id) return;
    const parsed = z.array(rateSchema).safeParse(values.rates);
    if (!parsed.success) {
      setRateError(parsed.error.issues[0]?.message ?? 'Revisá las tarifas cargadas.');
      return;
    }
    saveRatesMutation.mutate(parsed.data);
  });

  if (isEditing && profileQuery.isLoading) {
    return <div className="min-h-screen bg-gray-50 px-4 py-8"><div className="mx-auto max-w-6xl"><LoadingState message="Cargando agente..." /></div></div>;
  }

  if (profileQuery.error) {
    return <div className="min-h-screen bg-gray-50 px-4 py-8"><div className="mx-auto max-w-6xl"><ErrorState message={(profileQuery.error as Error).message} /></div></div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Link to="/agents" className="mb-3 inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700">
              <ArrowLeft className="h-4 w-4" />
              Volver
            </Link>
            <h1 className={`${pageTitleClass} mb-0`}>{isEditing ? 'Editar agente' : 'Nuevo agente'}</h1>
          </div>
          {isEditing && profileQuery.data ? (
            <div className="text-sm text-gray-500">{formatProfileName(profileQuery.data)}</div>
          ) : null}
        </div>

        <form className={`${cardClass} space-y-4`} onSubmit={handleProfileSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Nombre</label>
              <input className={inputClass} {...form.register('first_name')} />
              <p className="mt-1 text-xs text-red-600">{form.formState.errors.first_name?.message}</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Apellido</label>
              <input className={inputClass} {...form.register('last_name')} />
              <p className="mt-1 text-xs text-red-600">{form.formState.errors.last_name?.message}</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
              <input className={inputClass} {...form.register('email')} disabled={isEditing} />
              <p className="mt-1 text-xs text-red-600">{form.formState.errors.email?.message}</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Legajo</label>
              <input className={inputClass} {...form.register('employee_id')} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Rol</label>
              <select className={inputClass} {...form.register('role')}>
                <option value="admin">Admin</option>
                <option value="supervisor">Supervisor</option>
                <option value="agent">Agente</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Fecha de ingreso</label>
              <input className={inputClass} type="date" {...form.register('hire_date')} />
            </div>
            {!isEditing ? (
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Contraseña</label>
                <input className={inputClass} type="password" {...form.register('password')} />
                <p className="mt-1 text-xs text-red-600">{form.formState.errors.password?.message}</p>
              </div>
            ) : null}
          </div>

          {/* ── Parámetros de liquidación ── */}
          <div className="border-t border-gray-200 pt-4">
            <h2 className="text-base font-semibold text-gray-900">Parámetros de liquidación</h2>
            <p className="mt-1 text-sm text-gray-500">
              Los conceptos que el motor calcula sobre el subtotal de horas de cada período.
            </p>

            <div className="mt-4 rounded-lg border border-gray-200 p-4">
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-medium text-gray-900">
                  Premio a la Excelencia (REG) — valores por defecto
                </h3>
                <span className="text-sm text-gray-500">
                  Total: <strong className="text-gray-900">{regTotal.toLocaleString('es-AR', { maximumFractionDigits: 2 })}%</strong>
                </span>
              </div>
              <p className="mb-3 text-xs text-gray-500">
                Lo que se liquida sale de{' '}
                <Link to="/period-params" className="text-blue-600 hover:text-blue-700">
                  Evaluación mensual
                </Link>
                : el REG depende de cómo performó el agente cada mes. Esto es sólo el valor
                con el que se precarga un mes nuevo.
              </p>
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Gestión de personas</label>
                  <div className="relative">
                    <input className={inputClass} type="number" min="0" max="100" step="0.5" {...form.register('reg_people_pct')} />
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-gray-400">%</span>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Cuantitativo</label>
                  <div className="relative">
                    <input className={inputClass} type="number" min="0" max="100" step="0.5" {...form.register('reg_quantitative_pct')} />
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-gray-400">%</span>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Cualitativo</label>
                  <div className="relative">
                    <input className={inputClass} type="number" min="0" max="100" step="0.5" {...form.register('reg_qualitative_pct')} />
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-gray-400">%</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">SUPER REG (por defecto)</label>
                <div className="relative">
                  <input className={inputClass} type="number" min="0" max="100" step="0.5" {...form.register('super_reg_pct')} />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-gray-400">%</span>
                </div>
                <p className="mt-1 text-xs text-gray-500">Se carga por mes en Evaluación mensual</p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Reintegro por uso de equipos</label>
                <div className="relative">
                  <input className={inputClass} type="number" min="0" max="100" step="0.5" {...form.register('equipment_pct')} />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-gray-400">%</span>
                </div>
                <p className="mt-1 text-xs text-gray-500">Sobre el subtotal</p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Meses de antigüedad reconocidos</label>
                <input className={inputClass} type="number" min="0" step="1" {...form.register('seniority_months')} />
                <p className="mt-1 text-xs text-gray-500">
                  0,08333% por mes = {(seniorityMonths * 0.08333).toLocaleString('es-AR', { maximumFractionDigits: 4 })}% del subtotal
                </p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Factor de compensación por feriado</label>
                <input className={inputClass} type="number" min="0" max="2" step="0.05" {...form.register('holiday_compensation_factor')} />
                <p className="mt-1 text-xs text-gray-500">Proporción del valor hora por feriado no trabajado</p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Factor de plus vacacional</label>
                <input className={inputClass} type="number" min="0" max="2" step="0.05" {...form.register('vacation_plus_factor')} />
                <p className="mt-1 text-xs text-gray-500">0 = sin plus</p>
              </div>
            </div>
          </div>

          {saveProfileMutation.error ? <p className="text-sm text-red-600">{(saveProfileMutation.error as Error).message}</p> : null}

          <div className="flex gap-3">
            <button type="submit" className={primaryButtonClass} disabled={saveProfileMutation.isPending}>
              {saveProfileMutation.isPending ? 'Guardando...' : 'Guardar agente'}
            </button>
            <Link to="/agents" className={secondaryButtonClass}>Cancelar</Link>
          </div>
        </form>

        <section className={cardClass}>
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold text-gray-900">Tarifas del agente</h2>
            {!id ? <span className="text-sm text-gray-500">Guardá el perfil para cargar tarifas.</span> : null}
          </div>

          {!id ? null : (
            <div className="space-y-6">
              <form className="space-y-4" onSubmit={handleRatesSubmit}>
                <div className="space-y-3">
                  {rateFields.fields.map((field, index) => (
                    <div key={field.id} className="grid gap-3 rounded-lg border border-gray-200 p-4 md:grid-cols-3">
                      <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700">Tarifa base por hora</label>
                        <input className={inputClass} type="number" min="0" step="0.01" {...rateForm.register(`rates.${index}.amount_per_hour`, { valueAsNumber: true })} />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700">Vigencia desde</label>
                        <input className={inputClass} type="date" {...rateForm.register(`rates.${index}.effective_from`)} />
                      </div>
                      <div className="flex items-end">
                        <button
                          type="button"
                          className="inline-flex h-10 items-center justify-center rounded-lg bg-red-100 px-3 text-red-700 hover:bg-red-200"
                          onClick={() => rateFields.remove(index)}
                          disabled={rateFields.fields.length === 1}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    className={`${secondaryButtonClass} inline-flex items-center gap-2`}
                    onClick={() => rateFields.append({ amount_per_hour: 0, effective_from: '' })}
                  >
                    <Plus className="h-4 w-4" />
                    Agregar línea
                  </button>
                  <button type="submit" className={primaryButtonClass} disabled={saveRatesMutation.isPending}>
                    {saveRatesMutation.isPending ? 'Guardando...' : 'Guardar tarifas'}
                  </button>
                </div>

                {rateError ? <p className="text-sm text-red-600">{rateError}</p> : null}
              </form>

              {ratesQuery.isLoading ? <LoadingState message="Cargando tarifas..." /> : null}
              {ratesQuery.error ? <ErrorState message={(ratesQuery.error as Error).message} /> : null}
              {!ratesQuery.isLoading && !ratesQuery.error ? (
                (ratesQuery.data ?? []).length === 0 ? (
                  <EmptyState message="Todavía no hay tarifas configuradas." />
                ) : (
                  <div className="overflow-x-auto">
                    <table className={tableClass}>
                      <thead className="bg-gray-50">
                        <tr>
                          <th className={thClass}>Tarifa base</th>
                          <th className={thClass}>Vigencia desde</th>
                          <th className={thClass}>Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 bg-white">
                        {(ratesQuery.data ?? []).map((rate) => (
                          <tr key={rate.id}>
                            <td className={tdClass}>{formatCurrency(rate.amount_per_hour)}</td>
                            <td className={tdClass}>{formatDate(rate.effective_from)}</td>
                            <td className={tdClass}>
                              <button
                                type="button"
                                className="rounded-lg bg-red-100 px-3 py-2 text-red-700 hover:bg-red-200"
                                onClick={() => {
                                  if (window.confirm('¿Eliminar tarifa?')) {
                                    deleteRateMutation.mutate(rate.id);
                                  }
                                }}
                              >
                                Eliminar
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              ) : null}
            </div>
          )}
        </section>

        {profilesQuery.error ? <ErrorState message={(profilesQuery.error as Error).message} /> : null}
      </div>
    </div>
  );
}
