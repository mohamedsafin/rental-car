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
import { rateLimitingEnabled } from '../../config/rateLimiting';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { ApiError, ErrorCode } from '../../utils/ApiError';
import { authController } from './controller';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  updateProfileSchema,
  verifyEmailSchema,
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
  // Off during the main suite, which makes dozens of deliberate login attempts
  // from one address and would otherwise lock itself out. tests/security.test
  // switches it back on and proves this limiter actually fires.
  skip: () => !rateLimitingEnabled(),
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
  skip: () => !rateLimitingEnabled(),
  handler: (_req, _res, next) => {
    next(new ApiError(429, 'Too many accounts created. Please try again later.', ErrorCode.RATE_LIMITED));
  },
});

/*
 * Asking for a reset sends an EMAIL TO SOMEBODY ELSE, which makes an unlimited
 * form a way to bury a customer's inbox using our mail server's good name. 5
 * an hour per IP is far more than a forgetful person needs and far less than
 * that is worth.
 *
 * Successful requests count here, unlike the login limiter: with this form
 * every request "succeeds" by design, so skipping them would leave no limit
 * at all.
 */
const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => !rateLimitingEnabled(),
  handler: (_req, _res, next) => {
    next(
      new ApiError(
        429,
        'Too many reset requests. Please wait a while before trying again.',
        ErrorCode.RATE_LIMITED,
      ),
    );
  },
});

/** Following a link is cheap, but guessing tokens should not be. */
const tokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => !rateLimitingEnabled(),
  handler: (_req, _res, next) => {
    next(new ApiError(429, 'Too many attempts. Please try again later.', ErrorCode.RATE_LIMITED));
  },
});

const router = Router();

// --- Public --------------------------------------------------------------
router.post('/register', registerLimiter, validate({ body: registerSchema }), authController.register);
router.post('/login', loginLimiter, validate({ body: loginSchema }), authController.login);
router.post('/refresh', authController.refresh);

/*
 * Forgotten passwords and address confirmation.
 *
 * All four are public: somebody who cannot sign in is exactly who needs them.
 * Nothing here says whether an account exists - see verificationService.
 */
router.post(
  '/forgot-password',
  forgotPasswordLimiter,
  validate({ body: forgotPasswordSchema }),
  authController.forgotPassword,
);
router.post(
  '/reset-password',
  tokenLimiter,
  validate({ body: resetPasswordSchema }),
  authController.resetPassword,
);
router.post(
  '/verify-email',
  tokenLimiter,
  validate({ body: verifyEmailSchema }),
  authController.verifyEmail,
);
router.post('/logout', authController.logout);

// --- Authenticated -------------------------------------------------------
router.get('/me', authenticate, authController.me);
router.patch('/me', authenticate, validate({ body: updateProfileSchema }), authController.updateProfile);
router.post('/change-password', authenticate, validate({ body: changePasswordSchema }), authController.changePassword);
router.post('/logout-all', authenticate, authController.logoutAll);
/** Re-send the confirmation link. Signed in, because it needs no token. */
router.post(
  '/resend-verification',
  authenticate,
  forgotPasswordLimiter,
  authController.resendVerification,
);

export const authRoutes = router;
