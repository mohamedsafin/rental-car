/**
 * context/AuthContext.tsx
 * ---------------------------------------------------------------------------
 * Holds the current user for the whole app.
 *
 * Auth is genuine global state - the header, the route guards and half the
 * pages all need to know who is signed in - so it belongs in Context. Note
 * this is the ONLY Context in the project: ordinary server data (cars,
 * bookings) is handled by TanStack Query, not by hand-rolled global state.
 *
 * The boot sequence is the interesting part. On first load there is no access
 * token in memory, but the browser may still hold a valid httpOnly refresh
 * cookie from a previous visit. So we try one silent refresh before deciding
 * the user is logged out - which is what makes a page reload keep you signed in
 * without ever writing a credential to localStorage.
 */
import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { setSessionExpiredHandler } from '../services/api';
import { tokenStore } from '../services/tokenStore';
import { authService } from '../services/auth.service';
import type { LoginCredentials, RegisterData, User } from '../types/auth';

export interface AuthContextValue {
  user: User | null;
  /** True until the initial silent-refresh attempt finishes. */
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (credentials: LoginCredentials) => Promise<User>;
  register: (data: RegisterData) => Promise<User>;
  logout: () => Promise<void>;
  setUser: (user: User | null) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Boot: attempt one silent refresh.
  useEffect(() => {
    let cancelled = false;

    authService
      .refresh()
      .then((result) => {
        if (cancelled) return;
        tokenStore.set(result.accessToken);
        setUser(result.user);
      })
      .catch(() => {
        // No valid cookie - simply not logged in. Not an error worth showing.
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // When the Axios layer gives up on refreshing, drop the user here too.
  useEffect(() => {
    setSessionExpiredHandler(() => {
      tokenStore.clear();
      setUser(null);
    });
  }, []);

  const login = useCallback(async (credentials: LoginCredentials) => {
    const result = await authService.login(credentials);
    tokenStore.set(result.accessToken);
    setUser(result.user);
    return result.user;
  }, []);

  const register = useCallback(async (data: RegisterData) => {
    const result = await authService.register(data);
    tokenStore.set(result.accessToken);
    setUser(result.user);
    return result.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authService.logout();
    } catch {
      // Even if the server call fails, clear local state - the user asked to
      // log out and must not be left looking signed in.
    } finally {
      tokenStore.clear();
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      isAuthenticated: user !== null,
      login,
      register,
      logout,
      setUser,
    }),
    [user, isLoading, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
