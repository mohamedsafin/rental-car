/**
 * routes/index.ts
 * ---------------------------------------------------------------------------
 * The API v1 router. Every module's routes are mounted here, and this is the
 * only file that changes when a new module goes live.
 *
 * Versioning under `/api/v1` means we can ship a `/api/v2` later without
 * breaking the customer website or a partner integration mid-rental.
 */
import { Router } from 'express';
import { healthRoutes } from '../modules/health/routes';
import { authRoutes } from '../modules/auth/routes';
import { userRoutes } from '../modules/users/routes';
import { categoryRoutes } from '../modules/categories/routes';
import { featureRoutes } from '../modules/features/routes';
import { vehicleRoutes } from '../modules/vehicles/routes';
import { locationRoutes } from '../modules/locations/routes';
import { availabilityRoutes } from '../modules/availability/routes';
import { customerRoutes } from '../modules/customers/routes';
import { documentRoutes } from '../modules/documents/routes';
import { bookingRoutes } from '../modules/bookings/routes';
import { paymentRoutes } from '../modules/payments/routes';
import { mountMockCheckout } from '../modules/payments/mockCheckout';
import { depositRoutes } from '../modules/deposits/routes';
import { rentalRoutes } from '../modules/rentals/routes';
import { pricingRoutes } from '../modules/pricing/routes';
import { pricingAdminRoutes } from '../modules/pricing/adminRoutes';
import { damageRoutes } from '../modules/damages/routes';
import { fleetRoutes } from '../modules/fleet/routes';
import { couponRoutes } from '../modules/coupons/routes';
import { invoiceRoutes } from '../modules/invoices/routes';
import { notificationRoutes } from '../modules/notifications/routes';
import { reportRoutes } from '../modules/reports/routes';
import { legalRoutes } from '../modules/legal/routes';
import { docsRoutes } from '../modules/docs/routes';
import { settingsRoutes } from '../modules/settings/routes';
import { auditRoutes } from '../modules/audit/routes';

/**
 * The mount table.
 *
 * Declared as data rather than as a sequence of `router.use` calls, because
 * `utils/routeInventory` needs the prefixes to report full paths - and Express
 * 5 compiles a mounted router's path into a closure that cannot be read back.
 * Driving the mounting FROM this table means the two can never disagree.
 */
export const API_MOUNTS = {
  '/health': healthRoutes,
  // The OpenAPI document, built from this very table. Public: an API
  // description is not a secret, and every path in it is already enforced by
  // the guards it documents.
  '/docs': docsRoutes,
  '/auth': authRoutes,
  '/users': userRoutes,
  '/categories': categoryRoutes,
  '/features': featureRoutes,
  '/vehicles': vehicleRoutes,
  '/locations': locationRoutes,
  '/availability': availabilityRoutes,
  '/customers': customerRoutes,
  '/documents': documentRoutes,
  '/bookings': bookingRoutes,
  '/payments': paymentRoutes,
  '/deposits': depositRoutes,
  '/rentals': rentalRoutes,
  '/pricing': pricingRoutes,
  // Admin-only pricing management, under its own prefix so the public
  // /pricing routes stay unambiguously public.
  '/admin/pricing': pricingAdminRoutes,
  '/damages': damageRoutes,
  '/fleet': fleetRoutes,
  '/coupons': couponRoutes,
  '/invoices': invoiceRoutes,
  '/notifications': notificationRoutes,
  '/reports': reportRoutes,
  // Partly public: terms a customer must sign in to read are terms they
  // cannot read before deciding whether to sign up.
  '/legal': legalRoutes,
  // Client-owned configuration. The pricing module also exposes a filtered
  // view of these; this is the full set, including COMPANY - which holds the
  // TRN every invoice warns about.
  '/settings': settingsRoutes,
  // Read-only, admin-only. The trail records who viewed which identity
  // documents, so it is not staff-wide.
  '/audit': auditRoutes,
} as const;

const router = Router();

for (const [prefix, moduleRouter] of Object.entries(API_MOUNTS)) {
  router.use(prefix, moduleRouter);
}

// Development-only checkout simulator. No-op unless PAYMENT_PROVIDER=mock.
// Deliberately outside the table: it is not part of the API surface and must
// not appear in the OpenAPI spec.
mountMockCheckout(router);

export const apiV1Router = router;
