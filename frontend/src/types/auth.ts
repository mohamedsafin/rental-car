/**
 * types/auth.ts
 * ---------------------------------------------------------------------------
 * Auth contracts, mirroring the backend's PublicUser.
 */

export type Role = 'CUSTOMER' | 'ADMIN' | 'STAFF';
export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';

export interface User {
  id: string;
  email: string;
  role: Role;
  status: UserStatus;
  fullName: string;
  phone: string | null;
  country: string | null;
  emailVerified: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

/** The refresh token is NOT here - it lives in an httpOnly cookie we cannot read. */
export interface AuthResponse {
  user: User;
  accessToken: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  fullName: string;
  email: string;
  password: string;
  /**
   * Required, as YYYY-MM-DD.
   *
   * Asked at sign-up so the minimum-age rule can be checked silently at
   * booking time, instead of stopping a customer who has already chosen a car
   * and picked dates.
   */
  dateOfBirth: string;
  phone?: string;
  country?: string;
}
