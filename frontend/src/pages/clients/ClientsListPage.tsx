import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import {
  cardClass,
  EmptyState,
  ErrorState,
  getBadgeClass,
  LoadingState,
  pageTitleClass,
  primaryButtonClass,
  secondaryButtonClass,
  tableClass,
  tdClass,
  thClass,
  useClientsQuery,
} from '../shared';

export default function ClientsListPage() {
  const queryClient = useQueryClient();
  const clientsQuery = useClientsQuery();

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/clients/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
  });

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className={`${pageTitleClass} mb-0`}>Clientes</h1>
          <Link to="/clients/new" className={`${primaryButtonClass} inline-flex items-center gap-2`}>
            <Plus className="h-4 w-4" />
            Nuevo cliente
          </Link>
        </div>

        {clientsQuery.isLoading ? <LoadingState message="Cargando clientes..." /> : null}
        {clientsQuery.error ? <ErrorState message={(clientsQuery.error as Error).message} /> : null}

        {!clientsQuery.isLoading && !clientsQuery.error ? (
          <div className={cardClass}>
            {(clientsQuery.data ?? []).length === 0 ? (
              <EmptyState message="No hay clientes cargados." />
            ) : (
              <div className="overflow-x-auto">
                <table className={tableClass}>
                  <thead className="bg-gray-50">
                    <tr>
                      <th className={thClass}>Nombre</th>
                      <th className={thClass}>Estado</th>
                      <th className={thClass}>Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {(clientsQuery.data ?? []).map((client) => (
                      <tr key={client.id}>
                        <td className={`${tdClass} font-medium text-gray-900`}>{client.name}</td>
                        <td className={tdClass}>
                          <span className={getBadgeClass(client.is_active ? 'green' : 'gray')}>
                            {client.is_active ? 'Activo' : 'Inactivo'}
                          </span>
                        </td>
                        <td className={tdClass}>
                          <div className="flex flex-wrap gap-2">
                            <Link to={`/clients/${client.id}`} className={`${secondaryButtonClass} inline-flex items-center gap-2`}>
                              <Pencil className="h-4 w-4" />
                              Editar
                            </Link>
                            <button
                              type="button"
                              className="inline-flex items-center gap-2 rounded-lg bg-red-100 px-4 py-2 text-red-700 hover:bg-red-200"
                              onClick={() => {
                                if (window.confirm(`¿Eliminar ${client.name}?`)) {
                                  deleteMutation.mutate(client.id);
                                }
                              }}
                              disabled={deleteMutation.isPending}
                            >
                              <Trash2 className="h-4 w-4" />
                              Eliminar
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
