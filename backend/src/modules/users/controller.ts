/**
 * modules/users/controller.ts
 * ---------------------------------------------------------------------------
 * Thin as always. `req.user!` is safe here because every route in this module
 * runs `authenticate` first - a missing user would be a wiring bug, not a
 * runtime possibility.
 */
import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendCreated, sendPaginated, sendSuccess } from '../../utils/apiResponse';
import { getValidatedQuery } from '../../middleware/validate';
import { requestContext } from '../audit/service';
import { usersService, type Actor } from './service';
import type { ListUsersQuery } from './validation';

function actorFrom(req: Request): Actor {
  return {
    id: req.user!.id,
    email: req.user!.email,
    role: req.user!.role,
    ...requestContext(req),
  };
}

export const usersController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const query = getValidatedQuery<ListUsersQuery>(req);
    const { items, total } = await usersService.list(query);
    sendPaginated(res, items, query.page, query.limit, total, 'Users retrieved');
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    const user = await usersService.getById(req.params.id as string);
    sendSuccess(res, { user }, 'User retrieved');
  }),

  createStaff: asyncHandler(async (req: Request, res: Response) => {
    const user = await usersService.createStaff(req.body, actorFrom(req));
    sendCreated(res, { user }, 'User created');
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const user = await usersService.update(req.params.id as string, req.body, actorFrom(req));
    sendSuccess(res, { user }, 'User updated');
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await usersService.remove(req.params.id as string, actorFrom(req));
    sendSuccess(res, null, 'User deactivated');
  }),
};
