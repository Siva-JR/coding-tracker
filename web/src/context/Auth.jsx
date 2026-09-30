import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, onUnauthenticated, setCurrentUser } from '../api/index.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);

  const set = useCallback((u) => { setCurrentUser(u); setUser(u); }, []);

  useEffect(() => {
    api.auth.me().then(set).catch(() => set(null)).finally(() => setBooting(false));
  }, [set]);

  // An expired or revoked session anywhere in the app sends the user back to sign-in.
  useEffect(() => { onUnauthenticated(() => set(null)); }, [set]);

  const signIn = useCallback(async (username, password) => {
    const u = await api.auth.login(username, password);
    set(u);
    return u;
  }, [set]);

  const signOut = useCallback(async () => {
    await api.auth.logout();
    set(null);
  }, [set]);

  const changePassword = useCallback(async (current, next) => {
    const u = await api.auth.changePassword(current, next);
    set(u);
  }, [set]);

  const value = useMemo(() => ({ user, booting, signIn, signOut, changePassword }), [user, booting, signIn, signOut, changePassword]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
