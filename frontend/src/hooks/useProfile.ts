import { useEffect, useState } from 'react';
import { api } from '../lib/api';
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<UserProfile>('/auth/me')
      .then(setProfile)
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, []);

  return { profile, loading, isAgent: profile?.role === 'agent' };
}
