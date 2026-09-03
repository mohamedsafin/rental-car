/**
 * modules/locations/routes.ts
 * ---------------------------------------------------------------------------
 * Public reads (the search form needs the pickup dropdown), admin writes.
 */
import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorizeAdmin } from '../../middleware/authorize';
import { validate, getValidatedQuery } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendCreated, sendSuccess } from '../../utils/apiResponse';
import { locationsService } from './service';
import {
  createLocationSchema,
  listLocationsQuerySchema,
  locationIdParamSchema,
  updateLocationSchema,
  type ListLocationsQuery,
} from './validation';

const router = Router();

router.get(
  '/',
  validate({ query: listLocationsQuerySchema }),
  asyncHandler(async (req, res) => {
    const locations = await locationsService.list(getValidatedQuery<ListLocationsQuery>(req));
    sendSuccess(res, { locations }, 'Locations retrieved');
  }),
);

router.get(
  '/:id',
  validate({ params: locationIdParamSchema }),
  asyncHandler(async (req, res) => {
    const location = await locationsService.getById(req.params.id as string);
    sendSuccess(res, { location }, 'Location retrieved');
  }),
);

router.post(
  '/',
  authenticate,
  authorizeAdmin,
  validate({ body: createLocationSchema }),
  asyncHandler(async (req, res) => {
    const location = await locationsService.create(req.body);
    sendCreated(res, { location }, 'Location created');
  }),
);

router.patch(
  '/:id',
  authenticate,
  authorizeAdmin,
  validate({ params: locationIdParamSchema, body: updateLocationSchema }),
  asyncHandler(async (req, res) => {
    const location = await locationsService.update(req.params.id as string, req.body);
    sendSuccess(res, { location }, 'Location updated');
  }),
);

router.delete(
  '/:id',
  authenticate,
  authorizeAdmin,
  validate({ params: locationIdParamSchema }),
  asyncHandler(async (req, res) => {
    await locationsService.remove(req.params.id as string);
    sendSuccess(res, null, 'Location deleted');
  }),
);

export const locationRoutes = router;
