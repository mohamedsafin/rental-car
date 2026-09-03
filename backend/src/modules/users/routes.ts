/**
 * modules/users/routes.ts
 * ---------------------------------------------------------------------------
 * Every route here is admin-only. `router.use(...)` applies both middleware to
 * the whole module, so a new endpoint added later cannot accidentally ship
 * unprotected - the safe default is the automatic one.
 */
import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorizeAdmin } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { usersController } from './controller';
import {
  createStaffSchema,
  listUsersQuerySchema,
  updateUserSchema,
  userIdParamSchema,
} from './validation';

const router = Router();

// Applies to every route below. Order matters: authenticate populates req.user,
// authorizeAdmin then reads its role.
router.use(authenticate, authorizeAdmin);

router.get('/', validate({ query: listUsersQuerySchema }), usersController.list);
router.post('/', validate({ body: createStaffSchema }), usersController.createStaff);
router.get('/:id', validate({ params: userIdParamSchema }), usersController.getById);
router.patch('/:id', validate({ params: userIdParamSchema, body: updateUserSchema }), usersController.update);
router.delete('/:id', validate({ params: userIdParamSchema }), usersController.remove);

export const userRoutes = router;
