/**
 * types/auth.ts
 * ---------------------------------------------------------------------------
 * Auth contracts, mirroring the backend's PublicUser.
 */

/**
 * Who someone is, and therefore what they can reach.
 *
 * Mirrors the backend enum. Ordered by reach so a list built from it reads
 * from narrowest to widest rather than alphabetically.
 */
export type Role = 'CUSTOMER' | 'STAFF' | 'MANAGER' | 'ACCOUNTANT' | 'INSPECTOR' | 'ADMIN';
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
  /** Which branch a member of staff works at. Null for everyone else. */
  branchId: string | null;
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
  phone?: string;
  country?: string;
}
