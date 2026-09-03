/**
 * modules/health/service.ts
 * ---------------------------------------------------------------------------
 * Business logic for the health check.
 *
 * This is the pattern EVERY module follows: the service does the thinking,
 * knows nothing about `req`/`res`, and is therefore unit-testable on its own.
 *
 * "Healthy" here means: the process is running AND PostgreSQL answers. A car
 * rental API that cannot reach its database cannot check availability, so it
 * must report `degraded` rather than a cheerful `ok`.
 */
import { checkDatabaseConnection } from '../../config/prisma';
import { env } from '../../config/env';
import type { HealthCheckResult } from './types';

const SERVICE_NAME = 'uae-car-rental-api';
const SERVICE_VERSION = '0.1.0';

export const healthService = {
  /** Liveness: is the process up? Cheap, no I/O. */
  getLiveness(): Pick<HealthCheckResult, 'status' | 'service' | 'timestamp'> {
    return {
      status: 'ok',
      service: SERVICE_NAME,
      timestamp: new Date().toISOString(),
    };
  },

  /** Readiness: is the process up AND able to serve real traffic? */
  async getHealth(): Promise<HealthCheckResult> {
    const databaseUp = await checkDatabaseConnection();

    return {
      status: databaseUp ? 'ok' : 'degraded',
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      environment: env.NODE_ENV,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      dependencies: {
        database: databaseUp ? 'up' : 'down',
      },
    };
  },
};
