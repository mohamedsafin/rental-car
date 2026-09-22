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
 *   router.post('/:id/return', authenticate, authorizeOperations, ...);
 */
import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { ApiError } from '../utils/ApiError';

/** Allow only the listed roles. Must run after `authenticate`. */
export function authorize(...allowedRoles: Role[]) {
  const guard = (req: Request, _res: Response, next: NextFunction): void => {
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

  // Tagged so `routeInventory` can see which roles a route demands, and the
  // security test can assert it rather than trusting a code review.
  Object.defineProperty(guard, 'guardKind', { value: 'authorize' });
  Object.defineProperty(guard, 'allowedRoles', { value: allowedRoles });

  return guard;
}

/**
 * ===========================================================================
 * THE FOUR BACK-OFFICE DOORS
 * ===========================================================================
 * There used to be one: "staff", meaning everybody who was not a customer. A
 * counter clerk could therefore read the whole payments and deposits ledger,
 * and a workshop inspector could too - not because anyone decided that, but
 * because there was nowhere else to put them.
 *
 * So the guards below describe AREAS OF WORK rather than job titles, and each
 * role is admitted to the areas its job actually covers:
 *
 *   authorizeStaff      general back office - bookings, customers, fleet
 *   authorizeFinance    money - payments, deposits, invoices
 *   authorizeOperations cars and keys - handovers, returns, inspections, damage
 *   authorizeReports    figures - the reports a manager or accountant reads
 *   authorizeAdmin      the whole thing - users, settings, legal, audit
 *
 * STAFF deliberately keeps everything it had. Narrowing an existing role is a
 * decision for the business, not a side effect of adding new ones - somebody
 * who could take a cash payment yesterday should not be locked out today
 * because a new job title appeared in an enum. ACCOUNTANT and INSPECTOR are
 * the narrow ones, and they are narrow from the start.
 */

/** General back-office work. Not the two specialist roles. */
export const authorizeStaff = authorize('ADMIN', 'MANAGER', 'STAFF');

/**
 * Money. An accountant belongs here and nowhere near a set of car keys.
 */
export const authorizeFinance = authorize('ADMIN', 'MANAGER', 'STAFF', 'ACCOUNTANT');

/**
 * Cars, keys and condition. An inspector belongs here and nowhere near the
 * payments ledger.
 */
export const authorizeOperations = authorize('ADMIN', 'MANAGER', 'STAFF', 'INSPECTOR');

/**
 * The figures.
 *
 * A counter clerk keeps their access, for the reason given above; the point of
 * naming it separately is that an INSPECTOR never had it and never gets it.
 */
export const authorizeReports = authorize('ADMIN', 'MANAGER', 'STAFF', 'ACCOUNTANT');

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
