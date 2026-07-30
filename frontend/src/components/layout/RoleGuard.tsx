import { Navigate, Outlet } from 'react-router-dom';
import { useProfile } from '../../hooks/useProfile';
import type { Role } from '@milchick/shared';

interface RoleGuardProps {
  allowed: Role[];
}

export default function RoleGuard({ allowed }: RoleGuardProps) {
  const { profile, loading } = useProfile();

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!profile || !allowed.includes(profile.role)) {
    // Agents go to their portal, others go to login
    if (profile?.role === 'agent') {
      return <Navigate to="/my-portal" replace />;
    }
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
