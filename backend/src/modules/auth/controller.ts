/**
 * modules/auth/controller.ts
 * ---------------------------------------------------------------------------
 * Thin HTTP layer over authService. The one piece of real logic it owns is
 * cookie handling, because that is an HTTP concern the service must not know
 * about.
 *
 * Why the refresh token goes in an httpOnly cookie and the access token does
 * not:
 *
 *   httpOnly means page JavaScript cannot read the cookie. An XSS bug can
 *   therefore not steal the long-lived credential. The access token IS held in
 *   JavaScript (it has to be, to set the Authorization header) - but it expires
 *   in 15 minutes, so the damage window is small.
 *
 *   The cookie is scoped with `path` to the refresh and logout endpoints, so it
 *   is not sent on every API call and cannot be used for CSRF elsewhere.
 */
import type { CookieOptions, Request, Response } from 'express';
import { env, isProduction } from '../../config/env';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendCreated, sendSuccess } from '../../utils/apiResponse';
import { ApiError } from '../../utils/ApiError';
import { requestContext } from '../audit/service';
import { authService } from './service';

const REFRESH_COOKIE_NAME = 'refreshToken';
/** Both endpoints that need the cookie live under this prefix. */
const REFRESH_COOKIE_PATH = `${env.API_PREFIX}/auth`;

function refreshCookieOptions(expiresAt: Date): CookieOptions {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
    path: REFRESH_COOKIE_PATH,
    expires: expiresAt,
  };
}

function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE_NAME, token, refreshCookieOptions(expiresAt));
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
    path: REFRESH_COOKIE_PATH,
  });
}

/**
 * Read the refresh token from the cookie, falling back to the request body.
 *
 * The body fallback exists for non-browser clients (a future mobile app, and
 * our own API tests) which have no cookie jar. Browsers always use the cookie.
 */
function readRefreshToken(req: Request): string | undefined {
  const fromCookie = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE_NAME];
  const fromBody = (req.body as { refreshToken?: string } | undefined)?.refreshToken;
  return fromCookie ?? fromBody;
}

export const authController = {
  register: asyncHandler(async (req: Request, res: Response) => {
    const result = await authService.register(req.body, requestContext(req));
    setRefreshCookie(res, result.refreshToken, result.refreshTokenExpiresAt);

    sendCreated(
      res,
      { user: result.user, accessToken: result.accessToken },
      'Account created successfully',
    );
  }),

  login: asyncHandler(async (req: Request, res: Response) => {
    const result = await authService.login(req.body, requestContext(req));
    setRefreshCookie(res, result.refreshToken, result.refreshTokenExpiresAt);

    sendSuccess(res, { user: result.user, accessToken: result.accessToken }, 'Logged in successfully');
  }),

  refresh: asyncHandler(async (req: Request, res: Response) => {
    const token = readRefreshToken(req);
    if (!token) throw ApiError.unauthorized('No refresh token provided');

    const result = await authService.refresh(token, requestContext(req));
    setRefreshCookie(res, result.refreshToken, result.refreshTokenExpiresAt);

    sendSuccess(res, { user: result.user, accessToken: result.accessToken }, 'Token refreshed');
  }),

  logout: asyncHandler(async (req: Request, res: Response) => {
    await authService.logout(readRefreshToken(req), requestContext(req));
    clearRefreshCookie(res);
    sendSuccess(res, null, 'Logged out successfully');
  }),

  logoutAll: asyncHandler(async (req: Request, res: Response) => {
    await authService.logoutAll(req.user!.id, requestContext(req));
    clearRefreshCookie(res);
    sendSuccess(res, null, 'Logged out from all devices');
  }),

  me: asyncHandler(async (req: Request, res: Response) => {
    const user = await authService.getCurrentUser(req.user!.id);
    sendSuccess(res, { user }, 'Current user');
  }),

  updateProfile: asyncHandler(async (req: Request, res: Response) => {
    const user = await authService.updateProfile(req.user!.id, req.body);
    sendSuccess(res, { user }, 'Profile updated');
  }),

  changePassword: asyncHandler(async (req: Request, res: Response) => {
    await authService.changePassword(req.user!.id, req.body, requestContext(req));
    // Every session was just revoked, including this browser's.
    clearRefreshCookie(res);
    sendSuccess(res, null, 'Password changed. Please log in again.');
  }),
};

// Exported for tests and for the isProduction-gated cookie assertions.
export const __cookieName = REFRESH_COOKIE_NAME;
export const __isProduction = isProduction;
