/**
 * services/auth.service.ts
 * ---------------------------------------------------------------------------
 * All auth API calls. The only file in the app that knows these URLs.
 */
import { getData, patchData, postData } from './api';
import type { AuthResponse, LoginCredentials, RegisterData, User } from '../types/auth';

export const authService = {
  login: (credentials: LoginCredentials) => postData<AuthResponse>('/auth/login', credentials),

  register: (data: RegisterData) => postData<AuthResponse>('/auth/register', data),

  /**
   * Called on app boot. Succeeds if the browser still holds a valid httpOnly
   * refresh cookie, which is how a page reload keeps the user logged in
   * without us ever storing a token in readable storage.
   */
  refresh: () => postData<AuthResponse>('/auth/refresh'),

  logout: () => postData<null>('/auth/logout'),

  me: () => getData<{ user: User }>('/auth/me'),

  updateProfile: (data: { fullName?: string; phone?: string; country?: string }) =>
    patchData<{ user: User }>('/auth/me', data),

  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    postData<null>('/auth/change-password', data),

  /*
   * Forgotten passwords.
   *
   * `forgotPassword` resolves the same way whether or not the address has an
   * account - the server refuses to say, so the page must not pretend to know
   * either. Anything the UI does with the answer would leak what the API
   * deliberately withheld.
   */
  forgotPassword: (email: string) => postData<null>('/auth/forgot-password', { email }),

  resetPassword: (token: string, password: string) =>
    postData<null>('/auth/reset-password', { token, password }),

  verifyEmail: (token: string) => postData<{ email: string }>('/auth/verify-email', { token }),

  resendVerification: () =>
    postData<{ alreadyVerified: boolean }>('/auth/resend-verification'),
};
