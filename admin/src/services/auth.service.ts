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
};
