/**
 * modules/categories/controller.ts
 */
import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendCreated, sendSuccess } from '../../utils/apiResponse';
import { getValidatedQuery } from '../../middleware/validate';
import { categoriesService } from './service';
import type { ListCategoriesQuery } from './validation';

export const categoriesController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const categories = await categoriesService.list(getValidatedQuery<ListCategoriesQuery>(req));
    sendSuccess(res, { categories }, 'Categories retrieved');
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    const category = await categoriesService.getById(req.params.id as string);
    sendSuccess(res, { category }, 'Category retrieved');
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const category = await categoriesService.create(req.body);
    sendCreated(res, { category }, 'Category created');
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const category = await categoriesService.update(req.params.id as string, req.body);
    sendSuccess(res, { category }, 'Category updated');
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await categoriesService.remove(req.params.id as string);
    sendSuccess(res, null, 'Category deleted');
  }),
};
