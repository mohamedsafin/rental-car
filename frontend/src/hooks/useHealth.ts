/**
 * hooks/useHealth.ts
 * ---------------------------------------------------------------------------
 * TanStack Query hook wrapping the health service.
 *
 * TanStack Query owns all *server* state: caching, refetching, loading and
 * error flags. That is why you will not see useState/useEffect data fetching
 * anywhere in this project.
 */
import { useQuery } from '@tanstack/react-query';
import { healthService } from '../services/health.service';
import type { HealthCheckResult, NormalisedApiError } from '../types/api';

export function useHealth() {
  return useQuery<HealthCheckResult, NormalisedApiError>({
    queryKey: ['health'],
    queryFn: healthService.check,
    refetchInterval: 30000,
    retry: 1,
  });
}
