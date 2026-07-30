import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api } from '../../lib/api';
import { cardClass, ErrorState, inputClass, LoadingState, pageTitleClass, primaryButtonClass, secondaryButtonClass } from '../shared';

export default function ClientFormPage() {
  const { id } = useParams();
  const isEditing = Boolean(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [isActive, setIsActive] = useState(true);

  const clientQuery = useQuery({
    queryKey: ['clients', id],
    queryFn: () => api.get<{ name: string; is_active: boolean }>(`/clients/${id}`),
    enabled: isEditing,
  });

  useEffect(() => {
    if (!clientQuery.data) return;
    setName(clientQuery.data.name);
    setIsActive(clientQuery.data.is_active);
  }, [clientQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () => isEditing ? api.patch(`/clients/${id}`, { name, is_active: isActive }) : api.post('/clients', { name, is_active: isActive }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['clients'] }),
        queryClient.invalidateQueries({ queryKey: ['clients', id] }),
      ]);
      navigate('/clients');
    },
  });

  if (clientQuery.isLoading) {
    return <div className="min-h-screen bg-gray-50 px-4 py-8"><div className="mx-auto max-w-3xl"><LoadingState message="Cargando cliente..." /></div></div>;
  }

  if (clientQuery.error) {
    return <div className="min-h-screen bg-gray-50 px-4 py-8"><div className="mx-auto max-w-3xl"><ErrorState message={(clientQuery.error as Error).message} /></div></div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <Link to="/clients" className="mb-3 inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700">
            <ArrowLeft className="h-4 w-4" />
            Volver
          </Link>
          <h1 className={`${pageTitleClass} mb-0`}>{isEditing ? 'Editar cliente' : 'Nuevo cliente'}</h1>
        </div>

        <form
          className={`${cardClass} space-y-4`}
          onSubmit={(event) => {
            event.preventDefault();
            saveMutation.mutate();
          }}
        >
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Nombre</label>
            <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} required />
          </div>

          <label className="flex items-center gap-3 text-sm text-gray-700">
            <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
            Cliente activo
          </label>

          {saveMutation.error ? <p className="text-sm text-red-600">{(saveMutation.error as Error).message}</p> : null}

          <div className="flex gap-3">
            <button type="submit" className={primaryButtonClass} disabled={saveMutation.isPending || !name.trim()}>
              {saveMutation.isPending ? 'Guardando...' : 'Guardar cliente'}
            </button>
            <Link to="/clients" className={secondaryButtonClass}>Cancelar</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
