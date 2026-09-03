/**
 * middleware/notFound.ts
 * ---------------------------------------------------------------------------
 * Runs after all routes. If nothing matched, produce a proper 404 in our
 * standard error shape instead of Express's default HTML page.
 */
import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/ApiError';

export function notFound(req: Request, _res: Response, next: NextFunction): void {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}
