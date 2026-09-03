/**
 * middleware/validate.ts
 * ---------------------------------------------------------------------------
 * Generic Zod validation. Every module from here on uses this - it is the
 * single answer to "where does input validation happen?".
 *
 * Two jobs, and the second is the one people forget:
 *
 *  1. Reject malformed input at the edge, so services can trust their inputs
 *     and controllers contain no `if (!req.body.email)` noise.
 *
 *  2. REPLACE req.body/query/params with the PARSED result. Zod strips unknown
 *     keys, so a client posting `{ email, password, role: "ADMIN" }` to the
 *     register endpoint has `role` silently removed rather than mass-assigned.
 *     That single behaviour prevents a whole class of privilege-escalation bug.
 *
 * Errors thrown here are ZodErrors, which the central error handler already
 * turns into a 400 with a per-field list.
 */
import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';

export interface ValidationSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

export function validate(schemas: ValidationSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.params) req.params = schemas.params.parse(req.params);
      if (schemas.query) {
        // Express 5 makes req.query a getter with no setter, so we cannot
        // assign to it. Stash the parsed value and read it via
        // `getValidatedQuery(req)` in controllers.
        (req as Request & { validatedQuery?: unknown }).validatedQuery = schemas.query.parse(req.query);
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Read the query object parsed by `validate({ query })`. */
export function getValidatedQuery<T>(req: Request): T {
  return (req as Request & { validatedQuery?: T }).validatedQuery as T;
}
