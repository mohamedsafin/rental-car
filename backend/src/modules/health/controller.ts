/**
 * modules/health/controller.ts
 * ---------------------------------------------------------------------------
 * Controllers are THIN. They read the request, call a service, and format the
 * response. No business rules, no Prisma calls. If a controller starts growing
 * `if` statements about pricing or availability, that logic belongs in a
 * service instead.
 */
import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { healthService } from './service';

export const healthController = {
  live: asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, healthService.getLiveness(), 'Service is live');
  }),

  health: asyncHandler(async (_req: Request, res: Response) => {
    const result = await healthService.getHealth();
    // 503 when a dependency is down, so load balancers and uptime monitors
    // take this instance out of rotation instead of sending it customers.
    const statusCode = result.status === 'ok' ? 200 : 503;
    sendSuccess(res, result, result.status === 'ok' ? 'Service is healthy' : 'Service is degraded', statusCode);
  }),
};
