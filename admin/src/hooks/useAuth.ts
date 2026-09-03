/**
 * hooks/useAuth.ts
 * ---------------------------------------------------------------------------
 * Typed access to AuthContext. Throwing when the provider is missing turns a
 * confusing "cannot read property of null" into a clear setup error.
 */
import { useContext } from 'react';
import { AuthContext, type AuthContextValue } from '../context/AuthContext';

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside an <AuthProvider>');
  }
  return context;
}
