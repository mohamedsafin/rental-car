/**
 * types/api.ts
 * ---------------------------------------------------------------------------
 * Mirrors the response envelope the backend always returns. Keeping this in
 * one place means every feature gets the same typed shape for free.
 *
 * From Phase 3 these types will be generated from the backend's OpenAPI spec
 * so the frontend can never drift from the API.
 */

export interface ApiSuccess<T> {
  success: true;
  data: T;
  message: string;
}

export interface ApiFieldError {
  field: string;
  message: string;
}

export interface ApiFailure {
  success: false;
  message: string;
  code: string;
  errors: ApiFieldError[];
  requestId?: string;
}

/** Normalised error thrown by the Axios layer - always safe to show a user. */
export interface NormalisedApiError {
  message: string;
  code: string;
  status: number;
  errors: ApiFieldError[];
  requestId?: string;
}

export type ServiceStatus = 'up' | 'down';

export interface HealthCheckResult {
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  environment: string;
  timestamp: string;
  uptimeSeconds: number;
  dependencies: {
    database: ServiceStatus;
  };
}
