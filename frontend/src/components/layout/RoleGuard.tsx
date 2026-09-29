import { Navigate, Outlet } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { useProfile } from '../../hooks/useProfile';
import { ApiError } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { cardClass, primaryButtonClass, secondaryButtonClass } from '../../pages/shared';
import type { Role } from '@milchick/shared';

interface RoleGuardProps {
  allowed: Role[];
}

/**
 * Pantalla de error.
 *
 * Antes, cualquier falla al traer el perfil terminaba en un `<Navigate>` al
 * login. Como la sesión seguía siendo válida, el login volvía a mandar a la
 * home y de ahí otra vez al login: el usuario veía un parpadeo y ninguna
 * explicación, con el motivo real —un 404, una credencial, la API que no
 * responde— perdido en la consola.
 */
function ErrorDelPerfil({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const api = error instanceof ApiError ? error : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className={`${cardClass} w-full max-w-lg`}>
        <div className="mb-4 flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-6 w-6 flex-shrink-0 text-amber-600" />
          <div>
            <h1 className="text-lg font-semibold text-gray-900">No pudimos cargar tu perfil</h1>
            <p className="mt-1 text-sm text-gray-600">
              Tu sesión está bien, pero el sistema no pudo leer tus datos.
            </p>
          </div>
        </div>

        <dl className="mb-5 space-y-1 rounded-lg bg-gray-50 px-4 py-3 text-sm">
          <div className="flex gap-2">
            <dt className="font-medium text-gray-700">Motivo</dt>
            <dd className="text-gray-600">{error.message}</dd>
          </div>
          {api?.status ? (
            <div className="flex gap-2">
              <dt className="font-medium text-gray-700">Código</dt>
              <dd className="text-gray-600">
                HTTP {api.status}
                {api.code ? ` · ${api.code}` : ''}
              </dd>
            </div>
          ) : null}
          {api?.detail ? (
            <div className="flex gap-2">
              <dt className="font-medium text-gray-700">Detalle</dt>
              <dd className="break-all text-gray-600">{api.detail}</dd>
            </div>
          ) : null}
        </dl>

        <div className="flex gap-3">
          <button type="button" className={primaryButtonClass} onClick={onRetry}>
            Reintentar
          </button>
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={() => supabase.auth.signOut()}
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RoleGuard({ allowed }: RoleGuardProps) {
  const { profile, error, loading, reintentar } = useProfile();

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (error) {
    return <ErrorDelPerfil error={error} onRetry={reintentar} />;
  }

  if (!profile) {
    return <Navigate to="/login" replace />;
  }

  if (!allowed.includes(profile.role)) {
    // Los agentes tienen su propia pantalla; cualquier otro rol sin permiso se
    // entera, en vez de rebotar a un login al que ya entró.
    if (profile.role === 'agent') {
      return <Navigate to="/my-portal" replace />;
    }
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className={`${cardClass} w-full max-w-md text-center`}>
          <h1 className="text-lg font-semibold text-gray-900">No tenés permiso</h1>
          <p className="mt-2 text-sm text-gray-600">
            Esta sección es para {allowed.join(' o ')}, y tu rol es {profile.role}.
          </p>
        </div>
      </div>
    );
  }

  return <Outlet />;
}
