/**
 * modules/vehicles/routes.ts
 * ---------------------------------------------------------------------------
 * Public reads, admin writes.
 *
 * The read routes use `optionalAuthenticate`, not `authenticate`: an anonymous
 * visitor must be able to browse cars, but if a valid admin token IS present we
 * want req.user populated so the controller can widen what they see. No token
 * simply means the public view.
 */
import { Router } from 'express';
import { authenticate, optionalAuthenticate } from '../../middleware/authenticate';
import { authorizeAdmin } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { uploadVehicleImages } from '../../middleware/upload';
import { vehiclesController } from './controller';
import {
  createVehicleSchema,
  imageIdParamSchema,
  listVehiclesQuerySchema,
  updateVehicleSchema,
  uploadImagesQuerySchema,
  vehicleIdParamSchema,
} from './validation';

const router = Router();

// --- Public reads (admins see more through the same endpoints) -------------
router.get(
  '/',
  optionalAuthenticate,
  validate({ query: listVehiclesQuerySchema }),
  vehiclesController.list,
);
router.get(
  '/:id',
  optionalAuthenticate,
  validate({ params: vehicleIdParamSchema }),
  vehiclesController.getById,
);

// --- Admin writes ---------------------------------------------------------
router.post(
  '/',
  authenticate,
  authorizeAdmin,
  validate({ body: createVehicleSchema }),
  vehiclesController.create,
);
router.patch(
  '/:id',
  authenticate,
  authorizeAdmin,
  validate({ params: vehicleIdParamSchema, body: updateVehicleSchema }),
  vehiclesController.update,
);
router.delete(
  '/:id',
  authenticate,
  authorizeAdmin,
  validate({ params: vehicleIdParamSchema }),
  vehiclesController.remove,
);

// --- Images ---------------------------------------------------------------
// Order matters: authenticate/authorize run BEFORE multer, so an anonymous
// request is rejected without us first buffering 10 files into memory.
router.post(
  '/:id/images',
  authenticate,
  authorizeAdmin,
  validate({ params: vehicleIdParamSchema }),
  uploadVehicleImages,
  validate({ query: uploadImagesQuerySchema }),
  vehiclesController.uploadImages,
);
router.patch(
  '/:id/images/:imageId/primary',
  authenticate,
  authorizeAdmin,
  validate({ params: imageIdParamSchema }),
  vehiclesController.setPrimaryImage,
);
router.delete(
  '/:id/images/:imageId',
  authenticate,
  authorizeAdmin,
  validate({ params: imageIdParamSchema }),
  vehiclesController.removeImage,
);

export const vehicleRoutes = router;
