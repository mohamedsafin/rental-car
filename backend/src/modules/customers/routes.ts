/**
 * modules/customers/routes.ts
 * ---------------------------------------------------------------------------
 * Two audiences, cleanly separated:
 *
 *   /customers/me/*   the signed-in customer, acting on their OWN record.
 *                     There is no id in the URL - the record is identified by
 *                     the token, so there is nothing to tamper with.
 *
 *   /customers/:id/*  staff and admin, acting on anyone's record.
 *
 * That split is why this module needs no `authorizeSelfOrAdmin`: the "self"
 * routes cannot address another customer even in principle.
 */
import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorizeStaff } from '../../middleware/authorize';
import { getValidatedQuery, validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendPaginated, sendSuccess } from '../../utils/apiResponse';
import { requestContext } from '../audit/service';
import { documentService } from '../documents/service';
import { customersService } from './service';
import {
  customerIdParamSchema,
  listCustomersQuerySchema,
  updateCustomerProfileSchema,
  type ListCustomersQuery,
} from './validation';

const router = Router();

// Everything here needs a signed-in user of some kind.
router.use(authenticate);

// --- The caller's own profile ---------------------------------------------

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const customer = await customersService.getOrCreateForUser(req.user!.id);
    const verification = await customersService.getVerificationSummary(customer.id);
    sendSuccess(res, { customer, verification }, 'Profile retrieved');
  }),
);

router.patch(
  '/me',
  validate({ body: updateCustomerProfileSchema }),
  asyncHandler(async (req, res) => {
    const customer = await customersService.updateProfile(req.user!.id, req.body);
    const verification = await customersService.getVerificationSummary(customer.id);
    sendSuccess(res, { customer, verification }, 'Profile updated');
  }),
);

router.get(
  '/me/documents',
  asyncHandler(async (req, res) => {
    const customer = await customersService.getOrCreateForUser(req.user!.id);
    // Customers see only live documents; superseded ones would just be
    // confusing clutter of their own old uploads.
    const documents = await documentService.listForCustomer(customer.id, false);
    sendSuccess(res, { documents }, 'Documents retrieved');
  }),
);

// --- Staff and admin -------------------------------------------------------

router.get(
  '/',
  authorizeStaff,
  validate({ query: listCustomersQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = getValidatedQuery<ListCustomersQuery>(req);
    const { items, total } = await customersService.list(query);
    sendPaginated(res, items, query.page, query.limit, total, 'Customers retrieved');
  }),
);

router.get(
  '/:id',
  authorizeStaff,
  validate({ params: customerIdParamSchema }),
  asyncHandler(async (req, res) => {
    const customerId = req.params.id as string;
    const customer = await customersService.getByIdForStaff(customerId, {
      id: req.user!.id,
      email: req.user!.email,
      role: req.user!.role,
    });
    const verification = await customersService.getVerificationSummary(customerId);
    // Staff DO see superseded documents - a rejected passport and its
    // replacement together are the record of what was checked.
    const documents = await documentService.listForCustomer(customerId, true);

    sendSuccess(res, { customer, verification, documents }, 'Customer retrieved');
  }),
);

export const customerRoutes = router;
