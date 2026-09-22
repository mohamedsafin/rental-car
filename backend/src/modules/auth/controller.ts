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
 *
 * ===========================================================================
 * WHY THE COOKIE IS NAMED PER APP
 * ===========================================================================
 * Browsers file cookies by HOST AND IGNORE THE PORT. The customer site and the
 * admin are different origins to everything else in the platform - different
 * ports, separate localStorage, separate CORS entries - but to the cookie jar
 * they are one and the same "localhost", and in production they are commonly
 * two subdomains of one registrable domain, which collides the same way.
 *
 * With a single cookie name, the last person to sign in anywhere owned the
 * session. Signing into the customer site overwrote the admin's refresh token;
 * minutes later the admin's access token expired, it renewed itself with the
 * only cookie there was, and came back holding a CUSTOMER's token. Every
 * staff-only screen then answered "you do not have permission" - correctly,
 * because it was being asked by a customer - while the header still showed the
 * admin's name, because nothing had told it otherwise.
 *
 * So the app says who it is, and gets its own cookie. An admin and a customer
 * can now be signed in side by side in one browser without evicting each
 * other. A client that says nothing gets the original name, which keeps the
 * customer site, the API tests and any future mobile client working unchanged.
 */
import type { CookieOptions, Request, Response } from 'express';
import { env, isProduction } from '../../config/env';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendCreated, sendSuccess } from '../../utils/apiResponse';
import { ApiError } from '../../utils/ApiError';
import { requestContext } from '../audit/service';
import { authService } from './service';
import { verificationService, type ClientApp } from './verificationService';

const REFRESH_COOKIE_NAME = 'refreshToken';
const ADMIN_REFRESH_COOKIE_NAME = 'adminRefreshToken';

/**
 * How a client declares which app it is. Not a security boundary - anyone can
 * send any header - and it does not need to be: it only chooses which of the
 * caller's OWN cookies to read and write. The token inside still has to be a
 * valid, unrevoked refresh token, and the role still comes from the token.
 */
const CLIENT_APP_HEADER = 'x-client-app';

function cookieNameFor(req: Request): string {
  return req.get(CLIENT_APP_HEADER)?.trim().toLowerCase() === 'admin'
    ? ADMIN_REFRESH_COOKIE_NAME
    : REFRESH_COOKIE_NAME;
}

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

function setRefreshCookie(req: Request, res: Response, token: string, expiresAt: Date): void {
  res.cookie(cookieNameFor(req), token, refreshCookieOptions(expiresAt));
}

/*
 * Clears only THIS app's cookie.
 *
 * Deliberately not both: signing out of the admin must not sign the same
 * person out of the customer site they have open in the next tab, which is the
 * behaviour this whole split exists to end.
 */
function clearRefreshCookie(req: Request, res: Response): void {
  res.clearCookie(cookieNameFor(req), {
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
  const fromCookie = (req.cookies as Record<string, string> | undefined)?.[cookieNameFor(req)];
  const fromBody = (req.body as { refreshToken?: string } | undefined)?.refreshToken;
  return fromCookie ?? fromBody;
}

/** Which app the caller is, reusing the header the cookie split already sets. */
function clientAppOf(req: Request): ClientApp {
  return req.get(CLIENT_APP_HEADER)?.trim().toLowerCase() === 'admin' ? 'admin' : 'web';
}

export const authController = {
  register: asyncHandler(async (req: Request, res: Response) => {
    const result = await authService.register(req.body, requestContext(req));
    setRefreshCookie(req, res, result.refreshToken, result.refreshTokenExpiresAt);

    /*
     * Confirm the address, without making registration wait on it.
     *
     * Detached on purpose: a mail server being slow or down must not fail a
     * registration that has already succeeded, and the customer can re-send
     * the link from their account page whenever they like.
     */
    void verificationService
      .requestEmailVerification(result.user.id, clientAppOf(req), requestContext(req))
      .catch(() => {
        // Already logged by the notification layer. Swallowed here so an
        // unhandled rejection cannot take the process down.
      });

    sendCreated(
      res,
      { user: result.user, accessToken: result.accessToken },
      'Account created successfully',
    );
  }),

  login: asyncHandler(async (req: Request, res: Response) => {
    const result = await authService.login(req.body, requestContext(req));
    setRefreshCookie(req, res, result.refreshToken, result.refreshTokenExpiresAt);

    sendSuccess(res, { user: result.user, accessToken: result.accessToken }, 'Logged in successfully');
  }),

  refresh: asyncHandler(async (req: Request, res: Response) => {
    const token = readRefreshToken(req);
    if (!token) throw ApiError.unauthorized('No refresh token provided');

    const result = await authService.refresh(token, requestContext(req));
    setRefreshCookie(req, res, result.refreshToken, result.refreshTokenExpiresAt);

    sendSuccess(res, { user: result.user, accessToken: result.accessToken }, 'Token refreshed');
  }),

  logout: asyncHandler(async (req: Request, res: Response) => {
    await authService.logout(readRefreshToken(req), requestContext(req));
    clearRefreshCookie(req, res);
    sendSuccess(res, null, 'Logged out successfully');
  }),

  logoutAll: asyncHandler(async (req: Request, res: Response) => {
    await authService.logoutAll(req.user!.id, requestContext(req));
    clearRefreshCookie(req, res);
    sendSuccess(res, null, 'Logged out from all devices');
  }),

  /*
   * The reply is the same whether or not the address is known.
   *
   * Anything else - a different message, a different status, even a
   * measurably different response time - turns this form into a way to test
   * which addresses from a leaked list are customers here.
   */
  forgotPassword: asyncHandler(async (req: Request, res: Response) => {
    const { email } = req.body as { email: string };
    await verificationService.requestPasswordReset(email, clientAppOf(req), requestContext(req));

    sendSuccess(
      res,
      null,
      'If that email address has an account, a reset link is on its way. Check your inbox, and your spam folder.',
    );
  }),

  resetPassword: asyncHandler(async (req: Request, res: Response) => {
    const { token, password } = req.body as { token: string; password: string };
    await verificationService.resetPassword(token, password, requestContext(req));

    // Any session this browser still held belonged to the old password.
    clearRefreshCookie(req, res);
    sendSuccess(res, null, 'Your password has been changed. Please sign in with it.');
  }),

  verifyEmail: asyncHandler(async (req: Request, res: Response) => {
    const { token } = req.body as { token: string };
    const result = await verificationService.verifyEmail(token, requestContext(req));
    sendSuccess(res, result, 'Email address confirmed');
  }),

  resendVerification: asyncHandler(async (req: Request, res: Response) => {
    const result = await verificationService.requestEmailVerification(
      req.user!.id,
      clientAppOf(req),
      requestContext(req),
    );

    sendSuccess(
      res,
      result,
      result.alreadyVerified
        ? 'This address is already confirmed.'
        : 'Confirmation link sent. Check your inbox.',
    );
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
    clearRefreshCookie(req, res);
    sendSuccess(res, null, 'Password changed. Please log in again.');
  }),
};

// Exported for tests and for the isProduction-gated cookie assertions.
export const __cookieName = REFRESH_COOKIE_NAME;
export const __adminCookieName = ADMIN_REFRESH_COOKIE_NAME;
export const __clientAppHeader = CLIENT_APP_HEADER;
export const __isProduction = isProduction;
