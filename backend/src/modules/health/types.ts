/**
 * modules/health/types.ts
 * ---------------------------------------------------------------------------
 * Shapes returned by the health module. These are duplicated (by hand, for
 * now) in the React apps under `src/types/`. From Phase 3 we will generate the
 * frontend types from the OpenAPI spec so they can never drift.
 */

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
