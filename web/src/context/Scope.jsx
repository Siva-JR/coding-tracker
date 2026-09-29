import { createContext, useContext, useMemo } from 'react';
import { api } from '../api/index.js';
import { useAsync } from '../lib/hooks.js';
import { accessOf } from '../lib/access.js';
import { useAuth } from './Auth.jsx';

const ScopeCtx = createContext(null);

/**
 * What the signed-in user can see. `departments` comes from the server (already filtered to the user's
 * scopes). A user who can see exactly one department gets a department-only experience.
 */
export function ScopeProvider({ children }) {
  const { user } = useAuth();
  const { data: departments, error, reload } = useAsync(() => api.departments(), [user.id]);
  const value = useMemo(() => {
    const access = accessOf(user);
    return {
      ready: !!departments || !!error,
      departments: departments || [],
      single: departments?.length === 1 ? departments[0] : null,
      multi: (departments?.length || 0) > 1,
      years: access.years, // null = every year
      reload,
    };
  }, [user, departments, error, reload]);
  return <ScopeCtx.Provider value={value}>{children}</ScopeCtx.Provider>;
}

export const useScope = () => useContext(ScopeCtx);
