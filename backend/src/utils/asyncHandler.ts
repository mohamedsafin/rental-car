/**
 * utils/asyncHandler.ts
 * ---------------------------------------------------------------------------
 * Wraps an async controller so a rejected promise reaches Express's error
 * middleware instead of becoming an unhandled rejection.
 *
 * Express 5 forwards async errors on its own, but we keep this wrapper because
 * it is explicit, works identically on Express 4, and makes the intent obvious
 * in every route file.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

export function asyncHandler(fn: AsyncRequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
