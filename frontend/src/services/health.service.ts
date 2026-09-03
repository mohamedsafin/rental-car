/**
 * services/health.service.ts
 * ---------------------------------------------------------------------------
 * All health-related API calls. Every backend module gets a matching service
 * file here - components never write URLs inline.
 */
import { getData } from './api';
import type { HealthCheckResult } from '../types/api';

export const healthService = {
  check: () => getData<HealthCheckResult>('/health'),
};
