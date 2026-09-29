import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setCurrentUser } from '../api/index.js';

const AuthCtx = createContext(null);
const KEY = 'ct_session';

const readSession = () => {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    const s = readSession();
    if (!s?.id) { setBooting(false); return; }
    api.me(s.id)
      .then(({ user: u }) => { setCurrentUser(u); setUser(u); })
      .catch(() => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } })
      .finally(() => setBooting(false));
  }, []);

  const signIn = useCallback(async (username, password) => {
    const { user: u } = await api.login(username, password);
    setCurrentUser(u);
    try { localStorage.setItem(KEY, JSON.stringify({ id: u.id })); } catch { /* ignore */ }
    setUser(u);
    return u;
  }, []);

  const signOut = useCallback(() => {
    setCurrentUser(null);
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, booting, signIn, signOut }), [user, booting, signIn, signOut]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
