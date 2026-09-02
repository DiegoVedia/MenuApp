import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, setAuthToken } from '../api/client.js';

const AuthContext = createContext(null);
const STORAGE_KEY = 'menuapp_token';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem(STORAGE_KEY);
    if (!token) {
      setLoading(false);
      return;
    }
    setAuthToken(token);
    api
      .get('/auth/me')
      .then(setUser)
      .catch(() => {
        localStorage.removeItem(STORAGE_KEY);
        setAuthToken(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email, password) => {
    const { token, user: loggedUser } = await api.post('/auth/login', { email, password });
    localStorage.setItem(STORAGE_KEY, token);
    setAuthToken(token);
    setUser(loggedUser);
  }, []);

  const register = useCallback(async (email, password, name) => {
    const { token, user: newUser } = await api.post('/auth/register', { email, password, name });
    localStorage.setItem(STORAGE_KEY, token);
    setAuthToken(token);
    setUser(newUser);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setAuthToken(null);
    setUser(null);
  }, []);

  const updateUser = useCallback((patch) => setUser((u) => ({ ...u, ...patch })), []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
