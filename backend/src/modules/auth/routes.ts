/**
 * modules/auth/routes.ts
 * ---------------------------------------------------------------------------
 * Wiring only. Read each line left to right and you can see exactly what
 * protects that endpoint.
 *
 * Note the two rate limiters. The global limiter in app.ts allows 300 requests
 * per 15 minutes, which is generous for browsing cars and useless as protection
 * for a login form. Auth endpoints get a much tighter budget, because these are
 * the ones worth attacking.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { isTest } from '../../config/env';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { ApiError, ErrorCode } from '../../utils/ApiError';
import { authController } from './controller';
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
} from './validation';

/** 10 attempts per 15 minutes per IP, counting only failures. */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // A successful login should not consume the budget - otherwise a busy office
  // behind one NAT IP locks itself out.
  skipSuccessfulRequests: true,
  // Off during tests: the suite makes dozens of deliberate login attempts from
  // one address and would otherwise rate-limit itself. The limiter's real
  // behaviour is exercised by the manual smoke tests and again in Phase 11.
  skip: () => isTest,
  handler: (_req, _res, next) => {
    next(new ApiError(429, 'Too many login attempts. Please try again later.', ErrorCode.RATE_LIMITED));
  },
});

/** Registration is tighter still: 5 accounts per hour per IP. */
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => isTest,
  handler: (_req, _res, next) => {
    next(new ApiError(429, 'Too many accounts created. Please try again later.', ErrorCode.RATE_LIMITED));
  },
});

const router = Router();

// --- Public --------------------------------------------------------------
router.post('/register', registerLimiter, validate({ body: registerSchema }), authController.register);
router.post('/login', loginLimiter, validate({ body: loginSchema }), authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);

// --- Authenticated -------------------------------------------------------
router.get('/me', authenticate, authController.me);
router.patch('/me', authenticate, validate({ body: updateProfileSchema }), authController.updateProfile);
router.post('/change-password', authenticate, validate({ body: changePasswordSchema }), authController.changePassword);
router.post('/logout-all', authenticate, authController.logoutAll);

export const authRoutes = router;
