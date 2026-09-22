/**
 * modules/auth/roles.ts
 * ---------------------------------------------------------------------------
 * One answer to "is this person back office?".
 *
 * ===========================================================================
 * WHY THIS IS A FUNCTION AND NOT A COMPARISON
 * ===========================================================================
 * The test was written out by hand in a dozen places as
 * `role === 'ADMIN' || role === 'STAFF'`. That was correct while those were
 * the only two back-office roles - and silently wrong the moment MANAGER,
 * ACCOUNTANT and INSPECTOR were added, because each of those lines would have
 * treated a manager as a CUSTOMER: showing them only their own bookings,
 * hiding other people's invoices, refusing them a list they are entitled to.
 *
 * Nothing would have thrown. The screens would just have been quietly empty,
 * which is the worst kind of bug to find in an access-control rule.
 *
 * So the question is asked once, here, in the only form that cannot rot:
 * everybody who is not a customer is back office.
 */
import type { Role } from '@prisma/client';

/** True for every role that works for the company rather than rents from it. */
export function isBackOffice(role: Role | undefined | null): boolean {
  return role !== undefined && role !== null && role !== 'CUSTOMER';
}
