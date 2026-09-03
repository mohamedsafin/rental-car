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

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/users', userRoutes);

// --- Mounted in later phases -------------------------------------------
// router.use('/vehicles', vehicleRoutes);       // Phase 3
// router.use('/categories', categoryRoutes);    // Phase 3
// router.use('/locations', locationRoutes);     // Phase 3
// router.use('/availability', availabilityRoutes); // Phase 4
// router.use('/pricing', pricingRoutes);        // Phase 4
// router.use('/customers', customerRoutes);     // Phase 5
// router.use('/documents', documentRoutes);     // Phase 5
// router.use('/bookings', bookingRoutes);       // Phase 6
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
