'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { authService } from '@/services/auth.service';
import { setAccessToken } from '@/lib/http-client';

interface AuthState {
  accessToken: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

interface AuthContextValue extends AuthState {
  login: (token: string) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    accessToken: null,
    isLoading: true,
    isAuthenticated: false,
  });

  useEffect(() => {
    authService
      .refresh()
      .then(({ access_token }) => {
        setAccessToken(access_token);
        setState({ accessToken: access_token, isLoading: false, isAuthenticated: true });
      })
      .catch(() => {
        // Clear the stale/invalid cookie so the middleware stops redirecting away from /login
        authService.logout().catch(() => {});
        setState({ accessToken: null, isLoading: false, isAuthenticated: false });
      });
  }, []);

  const login = (token: string) => {
    setAccessToken(token);
    setState({ accessToken: token, isLoading: false, isAuthenticated: true });
  };

  const logout = async () => {
    await authService.logout();
    setAccessToken(null);
    setState({ accessToken: null, isLoading: false, isAuthenticated: false });
  };

  return <AuthContext.Provider value={{ ...state, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthContext must be used within AuthProvider');
  return ctx;
}
