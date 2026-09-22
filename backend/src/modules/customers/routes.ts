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
import { authorizeAdmin, authorizeStaff } from '../../middleware/authorize';
import { getValidatedQuery, validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendCreated, sendPaginated, sendSuccess } from '../../utils/apiResponse';
import { documentService } from '../documents/service';
import { requestContext } from '../audit/service';
import { customersService } from './service';
import {
  createWalkInCustomerSchema,
  customerIdParamSchema,
  listCustomersQuerySchema,
  staffUpdateCustomerSchema,
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

/**
 * POST /customers - open an account for a walk-in.
 *
 * Staff only. The customer sets their own password from an emailed link; this
 * endpoint never accepts one, so there is no way for it to create an account
 * whose credentials a member of staff knows.
 */
router.post(
  '/',
  authorizeStaff,
  validate({ body: createWalkInCustomerSchema }),
  asyncHandler(async (req, res) => {
    const customer = await customersService.createWalkIn(req.body, {
      id: req.user!.id,
      email: req.user!.email,
      role: req.user!.role,
      ...requestContext(req),
    });
    sendCreated(res, { customer }, 'Customer created');
  }),
);

/**
 * GET /customers/:id/profile - everything about one customer, on one screen.
 *
 * Separate from GET /customers/:id, which is the record itself. This is the
 * record PLUS the history that decides whether to hand over another set of
 * keys: how many rentals, what they have spent, what is still owed.
 */
router.get(
  '/:id/profile',
  authorizeStaff,
  validate({ params: customerIdParamSchema }),
  asyncHandler(async (req, res) => {
    const profile = await customersService.profileForStaff(req.params.id as string, {
      id: req.user!.id,
      email: req.user!.email,
      role: req.user!.role,
      ...requestContext(req),
    });
    sendSuccess(res, profile, 'Customer profile retrieved');
  }),
);

/**
 * PATCH /customers/:id - correct somebody's file from the counter.
 *
 * Audited by name: staff writing another person's date of birth and licence
 * details should leave a trail, which the customer's own edit does not need.
 */
router.patch(
  '/:id',
  authorizeStaff,
  validate({ params: customerIdParamSchema, body: staffUpdateCustomerSchema }),
  asyncHandler(async (req, res) => {
    const customer = await customersService.updateForStaff(req.params.id as string, req.body, {
      id: req.user!.id,
      email: req.user!.email,
      role: req.user!.role,
      ...requestContext(req),
    });
    sendSuccess(res, { customer }, 'Customer updated');
  }),
);

/**
 * POST /customers/:id/erase - honour a right-to-be-forgotten request.
 *
 * ADMIN only and irreversible. It anonymises rather than deletes: UAE tax law
 * requires the transactions to survive for five years, so what goes is
 * everything that identifies the person, and what stays is a nameless record
 * of what was bought.
 */
router.post(
  '/:id/erase',
  authorizeAdmin,
  validate({ params: customerIdParamSchema }),
  asyncHandler(async (req, res) => {
    const result = await customersService.erase(req.params.id as string, {
      id: req.user!.id,
      email: req.user!.email,
      role: req.user!.role,
      ...requestContext(req),
    });
    sendSuccess(res, result, 'Customer details erased');
  }),
);

export const customerRoutes = router;
