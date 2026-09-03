/**
 * middleware/authenticate.ts
 * ---------------------------------------------------------------------------
 * Answers ONE question: who is making this request?
 *
 * It does not decide what they may do - that is `authorize`. Keeping the two
 * separate means "logged out" (401) and "logged in but not allowed" (403) never
 * get confused, and the frontend can react differently to each: redirect to
 * login vs. show "you don't have access".
 *
 * On success it attaches `req.user`. Every downstream handler can then rely on
 * `req.user` existing without re-checking.
 */
import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { verifyAccessToken } from '../utils/jwt';
import { ApiError } from '../utils/ApiError';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

function extractBearerToken(req: Request): string | null {
  const header = req.header('authorization');
  if (!header) return null;

  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;

  return token;
}

/** Require a valid access token. Responds 401 if absent or invalid. */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const token = extractBearerToken(req);
  if (!token) {
    next(ApiError.unauthorized('Authentication required'));
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, email: payload.email, role: payload.role };
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Attach `req.user` if a valid token is present, but allow the request through
 * either way.
 *
 * Needed for endpoints that serve both audiences - vehicle search, for example,
 * is public, but a logged-in customer should see their loyalty pricing.
 */
export function optionalAuthenticate(req: Request, _res: Response, next: NextFunction): void {
  const token = extractBearerToken(req);
  if (!token) {
    next();
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, email: payload.email, role: payload.role };
  } catch {
    // A bad token on an optional route is simply treated as anonymous.
  }
  next();
}
