import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { Role } from '@milchick/shared';

interface UserProfile {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: Role;
  is_active: boolean;
}

export function useProfile() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  // El error se conserva. Descartarlo convertía cualquier falla del backend en
  // "no tenés perfil", y de ahí en una vuelta al login sin explicación.
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let vigente = true;
    setLoading(true);

    api.get<UserProfile>('/auth/me')
      .then((data) => {
        if (!vigente) return;
        setProfile(data);
        setError(null);
      })
      .catch((err: Error) => {
        if (!vigente) return;
        setProfile(null);
        setError(err);
      })
      .finally(() => {
        if (vigente) setLoading(false);
      });

    return () => {
      vigente = false;
    };
  }, [intento]);

  const reintentar = useCallback(() => setIntento((n) => n + 1), []);

  return { profile, error, loading, isAgent: profile?.role === 'agent', reintentar };
}
