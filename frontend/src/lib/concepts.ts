import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';

export type ItemKind = 'fixed' | 'percentage' | 'hourly';

export interface ItemConcept {
  id: string;
  key: string;
  name: string;
  description: string | null;
  system: boolean;
  kind: ItemKind;
  default_amount: number | null;
  default_percentage: number | null;
  default_unit_minutes: number | null;
  default_days: number | null;
  default_band: string | null;
  default_tier: string | null;
  default_factor: number | null;
  sort_order: number;
  is_active: boolean;
  needs_review: boolean;
  origin: 'sistema' | 'configuracion' | 'liquidacion' | 'migracion';
  /** Sólo en el listado completo de Configuración */
  uses?: number;
}

export const KIND_LABELS: Record<ItemKind, string> = {
  fixed: 'Importe fijo',
  percentage: 'Porcentaje del subtotal',
  hourly: 'Por tiempo, a valor hora',
};

export const ORIGIN_LABELS: Record<ItemConcept['origin'], string> = {
  sistema: 'Lo calcula el sistema',
  configuracion: 'Cargado en Configuración',
  liquidacion: 'Creado al liquidar',
  migracion: 'Venía de antes, como texto libre',
};

/** Los conceptos activos, para elegir al cargar un ítem */
export function useConcepts() {
  return useQuery({
    queryKey: ['item-concepts'],
    queryFn: () => api.get<ItemConcept[]>('/item-concepts'),
    staleTime: 60_000,
  });
}

/** Todos, con cuántos ítems usa cada uno: para administrar el catálogo */
export function useConceptCatalog() {
  return useQuery({
    queryKey: ['item-concepts', 'todos'],
    queryFn: () => api.get<ItemConcept[]>('/item-concepts?all=1'),
  });
}

export function useInvalidateConcepts() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['item-concepts'] });
}

/**
 * Alta rápida al liquidar: sólo el nombre. Si ya existía, devuelve ese —así la
 * liquidación sigue sin frenar—.
 */
export function useQuickCreateConcept() {
  const invalidate = useInvalidateConcepts();
  return useMutation({
    mutationFn: async (name: string) => {
      try {
        return await api.post<ItemConcept>('/item-concepts', { name, from_settlement: true });
      } catch (err) {
        const existente = err instanceof ApiError && err.status === 409 ? (err.data?.existing as ItemConcept | undefined) : undefined;
        if (existente?.is_active) return existente;
        throw err;
      }
    },
    onSuccess: invalidate,
  });
}

/** Una línea que dice cómo se calcula por defecto: "3% del subtotal", "45 min por día a Diurna LD" */
export function describeDefaults(c: ItemConcept, bandLabels: Record<string, string>): string {
  if (c.system) return c.description ?? 'Lo calcula el sistema';
  if (c.kind === 'fixed') {
    return c.default_amount ? `Importe fijo · $ ${Number(c.default_amount).toLocaleString('es-AR', { minimumFractionDigits: 2 })}` : 'Importe fijo';
  }
  if (c.kind === 'percentage') {
    return c.default_percentage !== null ? `${String(Number((Number(c.default_percentage) * 100).toFixed(4))).replace('.', ',')}% del subtotal` : 'Porcentaje del subtotal';
  }
  const partes = [
    c.default_unit_minutes ? `${c.default_unit_minutes} min por día` : 'Por tiempo',
    c.default_days ? `× ${c.default_days} días` : null,
    c.default_band ? `a ${bandLabels[c.default_band] ?? c.default_band}` : null,
    c.default_factor !== null && Number(c.default_factor) !== 1 ? `× ${String(c.default_factor).replace('.', ',')}` : null,
  ];
  return partes.filter(Boolean).join(' ');
}
