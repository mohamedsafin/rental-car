/**
 * middleware/requestId.ts
 * ---------------------------------------------------------------------------
 * Attaches a unique id to every request and echoes it back as `X-Request-Id`.
 *
 * Why: when a customer says "my payment failed at 14:32", this id is how we
 * find that exact request in the logs. It is also the only internal detail we
 * expose on a 500 response — safe to share, useless to an attacker.
 */
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  req.requestId = incoming && incoming.length <= 64 ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}
