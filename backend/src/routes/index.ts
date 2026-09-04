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
import { pricingRoutes } from '../modules/pricing/routes';
import { pricingAdminRoutes } from '../modules/pricing/adminRoutes';

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/categories', categoryRoutes);
router.use('/features', featureRoutes);
router.use('/vehicles', vehicleRoutes);
router.use('/locations', locationRoutes);
router.use('/availability', availabilityRoutes);
router.use('/customers', customerRoutes);
router.use('/documents', documentRoutes);
router.use('/bookings', bookingRoutes);
router.use('/pricing', pricingRoutes);
// Admin-only pricing management. Mounted under its own prefix so the public
// /pricing routes stay unambiguously public.
router.use('/admin/pricing', pricingAdminRoutes);

// --- Mounted in later phases -------------------------------------------
// router.use('/payments', paymentRoutes);       // Phase 7
// router.use('/deposits', depositRoutes);       // Phase 7
// router.use('/rentals', rentalRoutes);         // Phase 8
// router.use('/inspections', inspectionRoutes); // Phase 8
// router.use('/damages', damageRoutes);         // Phase 9
// router.use('/fines', fineRoutes);             // Phase 9
// router.use('/tolls', tollRoutes);             // Phase 9
// router.use('/maintenance', maintenanceRoutes);// Phase 9
// router.use('/insurance', insuranceRoutes);    // Phase 9
// router.use('/coupons', couponRoutes);         // Phase 10
// router.use('/invoices', invoiceRoutes);       // Phase 10
// router.use('/notifications', notificationRoutes); // Phase 10
// router.use('/reports', reportRoutes);         // Phase 10

export const apiV1Router = router;
