/**
 * middleware/authorize.ts
 * ---------------------------------------------------------------------------
 * Answers the second question: may this user do this?
 *
 * THIS IS THE REAL SECURITY BOUNDARY. The admin React app also hides routes by
 * role, but that is only a convenience for honest users - anyone can edit
 * JavaScript in their own browser, or skip the browser entirely and use curl.
 * If a rule is not enforced here, it is not enforced.
 *
 * Usage:
 *   router.get('/', authenticate, authorize('ADMIN'), controller.list);
 *   router.post('/:id/return', authenticate, authorize('ADMIN', 'STAFF'), ...);
 */
import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { ApiError } from '../utils/ApiError';

/** Allow only the listed roles. Must run after `authenticate`. */
export function authorize(...allowedRoles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      // A programming error: authorize was mounted without authenticate.
      next(ApiError.unauthorized('Authentication required'));
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      // The message deliberately does not say which role is needed - that is
      // information about the system an attacker does not need.
      next(ApiError.forbidden('You do not have permission to perform this action'));
      return;
    }

    next();
  };
}

/**
 * Allow admins and staff through; anyone else is refused.
 * Shorthand for the many back-office endpoints in later phases.
 */
export const authorizeStaff = authorize('ADMIN', 'STAFF');

/** Allow only admins. */
export const authorizeAdmin = authorize('ADMIN');

/**
 * Allow a user to act on their OWN resource, or an admin to act on anyone's.
 *
 * This is the rule that stops customer A fetching customer B's booking by
 * changing the id in the URL - the single most common access-control bug in
 * applications like this one. Ownership is checked against the token, never
 * against a parameter the client supplies.
 */
export function authorizeSelfOrAdmin(getOwnerId: (req: Request) => string | undefined) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(ApiError.unauthorized('Authentication required'));
      return;
    }

    if (req.user.role === 'ADMIN') {
      next();
      return;
    }

    const ownerId = getOwnerId(req);
    if (ownerId && ownerId === req.user.id) {
      next();
      return;
    }

    next(ApiError.forbidden('You do not have permission to perform this action'));
  };
}
