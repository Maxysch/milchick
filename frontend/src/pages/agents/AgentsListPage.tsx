import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Plus, Search } from 'lucide-react';
import {
  cardClass,
  EmptyState,
  ErrorState,
  getBadgeClass,
  LoadingState,
  pageTitleClass,
  primaryButtonClass,
  tableClass,
  tdClass,
  thClass,
  useProfilesQuery,
} from '../shared';

export default function AgentsListPage() {
  const [search, setSearch] = useState('');
  const profilesQuery = useProfilesQuery();

  const filteredProfiles = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return profilesQuery.data ?? [];

    return (profilesQuery.data ?? []).filter((profile) => {
      const haystack = `${profile.first_name} ${profile.last_name} ${profile.email} ${profile.employee_id ?? ''} ${profile.role}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [profilesQuery.data, search]);

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className={`${pageTitleClass} mb-0`}>Agentes</h1>
          <Link to="/agents/new" className={`${primaryButtonClass} inline-flex items-center gap-2`}>
            <Plus className="h-4 w-4" />
            Nuevo agente
          </Link>
        </div>

        <div className={cardClass}>
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nombre, email o legajo"
            />
          </div>
        </div>

        {profilesQuery.isLoading ? <LoadingState message="Cargando agentes..." /> : null}
        {profilesQuery.error ? <ErrorState message={(profilesQuery.error as Error).message} /> : null}

        {!profilesQuery.isLoading && !profilesQuery.error ? (
          <div className={cardClass}>
            {filteredProfiles.length === 0 ? (
              <EmptyState message="No hay agentes para mostrar." />
            ) : (
              <div className="overflow-x-auto">
                <table className={tableClass}>
                  <thead className="bg-gray-50">
                    <tr>
                      <th className={thClass}>Nombre</th>
                      <th className={thClass}>Email</th>
                      <th className={thClass}>Rol</th>
                      <th className={thClass}>Estado</th>
                      <th className={thClass}>Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {filteredProfiles.map((profile) => (
                      <tr key={profile.id}>
                        <td className={tdClass}>
                          <div className="font-medium text-gray-900">{profile.first_name} {profile.last_name}</div>
                          <div className="text-xs text-gray-500">{profile.employee_id || 'Sin legajo'}</div>
                        </td>
                        <td className={tdClass}>{profile.email}</td>
                        <td className={`${tdClass} capitalize`}>{profile.role}</td>
                        <td className={tdClass}>
                          <span className={getBadgeClass(profile.is_active ? 'green' : 'gray')}>
                            {profile.is_active ? 'Activo' : 'Inactivo'}
                          </span>
                        </td>
                        <td className={tdClass}>
                          <Link to={`/agents/${profile.id}`} className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700">
                            <Pencil className="h-4 w-4" />
                            Editar
                          </Link>
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
