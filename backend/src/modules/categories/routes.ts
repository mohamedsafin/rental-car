/**
 * modules/categories/routes.ts
 * ---------------------------------------------------------------------------
 * This is the first module with a PUBLIC read side and a PROTECTED write side,
 * and that split is the pattern for the whole fleet:
 *
 *   GET    - public. The customer site must list categories without a login.
 *   POST   - admin only.
 *   PATCH  - admin only.
 *   DELETE - admin only.
 *
 * Reading the route lines top to bottom tells you exactly who can do what.
 */
import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorizeAdmin } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { categoriesController } from './controller';
import {
  categoryIdParamSchema,
  createCategorySchema,
  listCategoriesQuerySchema,
  updateCategorySchema,
} from './validation';

const router = Router();

// --- Public ---------------------------------------------------------------
router.get('/', validate({ query: listCategoriesQuerySchema }), categoriesController.list);
router.get('/:id', validate({ params: categoryIdParamSchema }), categoriesController.getById);

// --- Admin ----------------------------------------------------------------
router.post('/', authenticate, authorizeAdmin, validate({ body: createCategorySchema }), categoriesController.create);
router.patch(
  '/:id',
  authenticate,
  authorizeAdmin,
  validate({ params: categoryIdParamSchema, body: updateCategorySchema }),
  categoriesController.update,
);
router.delete(
  '/:id',
  authenticate,
  authorizeAdmin,
  validate({ params: categoryIdParamSchema }),
  categoriesController.remove,
);

export const categoryRoutes = router;
