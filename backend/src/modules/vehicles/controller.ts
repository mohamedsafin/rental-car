/**
 * modules/vehicles/controller.ts
 * ---------------------------------------------------------------------------
 * The `isAdmin` flag threaded through every read is the important detail.
 *
 * The SAME endpoint serves the customer site and the admin dashboard. Rather
 * than duplicate every route, we derive one boolean from the token and pass it
 * down; the repository then decides what the caller may see - unpublished
 * vehicles, registration numbers, status filters.
 *
 * It is derived from `req.user`, which comes from a verified JWT. It is never
 * read from a query parameter or header a client controls.
 */
import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendCreated, sendPaginated, sendSuccess } from '../../utils/apiResponse';
import { getValidatedQuery } from '../../middleware/validate';
import { ApiError } from '../../utils/ApiError';
import { requestContext } from '../audit/service';
import { vehiclesService, type FleetActor } from './service';
import { vehicleImageService } from './imageService';
import type { ListVehiclesQuery, UploadImagesQuery } from './validation';
import type { VehicleImageType } from '@prisma/client';

/** Back-office roles see the full record; everyone else sees the public view. */
function isBackOffice(req: Request): boolean {
  return req.user?.role === 'ADMIN' || req.user?.role === 'STAFF';
}

function actorFrom(req: Request): FleetActor {
  return {
    id: req.user!.id,
    email: req.user!.email,
    role: req.user!.role,
    ...requestContext(req),
  };
}

export const vehiclesController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const query = getValidatedQuery<ListVehiclesQuery>(req);
    const { items, total } = await vehiclesService.list(query, isBackOffice(req));
    sendPaginated(res, items, query.page, query.limit, total, 'Vehicles retrieved');
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    const vehicle = await vehiclesService.getById(req.params.id as string, isBackOffice(req));
    sendSuccess(res, { vehicle }, 'Vehicle retrieved');
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const vehicle = await vehiclesService.create(req.body, actorFrom(req));
    sendCreated(res, { vehicle }, 'Vehicle created');
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const vehicle = await vehiclesService.update(req.params.id as string, req.body, actorFrom(req));
    sendSuccess(res, { vehicle }, 'Vehicle updated');
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await vehiclesService.remove(req.params.id as string, actorFrom(req));
    sendSuccess(res, null, 'Vehicle deleted');
  }),

  uploadImages: asyncHandler(async (req: Request, res: Response) => {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) throw ApiError.badRequest('No images were uploaded');

    const { type } = getValidatedQuery<UploadImagesQuery>(req);
    await vehicleImageService.upload(req.params.id as string, files, type as VehicleImageType);

    // Return the fresh vehicle so the admin UI can re-render the gallery from
    // the server's answer rather than guessing what changed.
    const vehicle = await vehiclesService.getById(req.params.id as string, true);
    sendCreated(res, { vehicle }, `${files.length} image(s) uploaded`);
  }),

  setPrimaryImage: asyncHandler(async (req: Request, res: Response) => {
    await vehicleImageService.setPrimary(req.params.id as string, req.params.imageId as string);
    const vehicle = await vehiclesService.getById(req.params.id as string, true);
    sendSuccess(res, { vehicle }, 'Primary image updated');
  }),

  removeImage: asyncHandler(async (req: Request, res: Response) => {
    await vehicleImageService.remove(req.params.id as string, req.params.imageId as string);
    const vehicle = await vehiclesService.getById(req.params.id as string, true);
    sendSuccess(res, { vehicle }, 'Image deleted');
  }),
};
