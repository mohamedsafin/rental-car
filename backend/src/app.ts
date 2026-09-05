/**
 * app.ts
 * ---------------------------------------------------------------------------
 * Builds and configures the Express application — but does NOT start listening.
 *
 * Keeping `app` (configuration) separate from `server` (the listening process)
 * is what lets Supertest import the app and fire real HTTP requests at it in
 * tests without binding a port.
 *
 * ORDER MATTERS in this file. Middleware runs top to bottom:
 *   security headers -> CORS -> body parsing -> logging -> routes
 *   -> 404 handler -> error handler (always last)
 */
import express, { type Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { env, isProduction, isTest } from './config/env';
import { rateLimitingEnabled } from './config/rateLimiting';
import { logger } from './config/logger';
import { requestId } from './middleware/requestId';
import { notFound } from './middleware/notFound';
import { errorHandler } from './middleware/errorHandler';
import { apiV1Router } from './routes';
import { storage, LocalStorageProvider } from './services/storage';
import { ApiError, ErrorCode } from './utils/ApiError';

export function createApp(): Application {
  const app = express();

  // Behind a reverse proxy (nginx, Render, Railway) this makes req.ip and the
  // rate limiter see the real client IP instead of the proxy's.
  //
  // Configured, NOT hardcoded, and off by default. With it on and no proxy in
  // front, anyone can send `X-Forwarded-For: <random>` on every request and
  // walk straight through the rate limiter - each spoofed address gets its own
  // fresh quota. Trusting that header is only safe when something we control
  // is guaranteed to be setting it.
  if (env.TRUST_PROXY_HOPS > 0) {
    app.set('trust proxy', env.TRUST_PROXY_HOPS);
  }
  app.disable('x-powered-by');

  // 1. Request id — first, so every later log line can reference it.
  app.use(requestId);

  // 2. Secure HTTP headers (CSP, HSTS, no-sniff, frame options, ...).
  app.use(helmet());

  // 3. CORS — only our own frontends may call this API from a browser.
  app.use(
    cors({
      origin(origin, callback) {
        // No origin = server-to-server, curl, or same-origin. Allow it;
        // browsers are the only clients CORS protects.
        if (!origin) return callback(null, true);
        if (env.CORS_ORIGINS.includes(origin)) return callback(null, true);
        logger.warn('Blocked CORS origin', { origin });
        // A blocked origin is expected traffic, not a server fault. Returning a
        // plain Error here would surface as a 500 and log at ERROR level.
        return callback(ApiError.forbidden('Origin not allowed'));
      },
      credentials: true,
      exposedHeaders: ['X-Request-Id'],
    }),
  );

  // 4. Body parsing. The 1mb cap stops a trivial memory-exhaustion attack;
  //    real file uploads go through multipart handling, not here.
  //
  //    THE WEBHOOK PATH IS EXCLUDED, and that exclusion is load-bearing.
  //    A payment webhook's HMAC signature is computed over the EXACT bytes the
  //    provider sent. If express.json() parses the body here, the route's
  //    raw() middleware sees an already-parsed object, the signature check
  //    receives an object instead of a Buffer, and every webhook fails. We
  //    found this the hard way: it surfaced as a 500 rather than a 401, which
  //    would have looked like a provider outage rather than a broken
  //    verification path.
  const WEBHOOK_PATH = `${env.API_PREFIX}/payments/webhook`;

  app.use((req, res, next) => {
    if (req.path === WEBHOOK_PATH) return next();
    return express.json({ limit: '1mb' })(req, res, next);
  });
  app.use((req, res, next) => {
    if (req.path === WEBHOOK_PATH) return next();
    return express.urlencoded({ extended: true, limit: '1mb' })(req, res, next);
  });

  // 4b. Parse cookies. The refresh token arrives as an httpOnly cookie, which
  //     Express cannot read without this.
  app.use(cookieParser());

  // 5. gzip responses.
  app.use(compression());

  // 6. HTTP access logs (silent during tests to keep output readable).
  if (!isTest) {
    app.use(
      morgan(isProduction ? 'combined' : 'dev', {
        stream: { write: (message) => logger.info(message.trim()) },
      }),
    );
  }

  // 7. Rate limiting. Health checks are excluded so uptime monitors polling
  //    every 30s never consume a customer's quota.
  app.use(
    env.API_PREFIX,
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.RATE_LIMIT_MAX,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      // Health checks never count - an uptime monitor polling every 30s must
      // not consume a customer's quota. The limiter itself is off during the
      // main test suite and switched back on by tests/security.test.
      skip: (req) => !rateLimitingEnabled() || req.path.startsWith('/health'),
      handler: (_req, _res, next) => {
        next(new ApiError(429, 'Too many requests, please try again later', ErrorCode.RATE_LIMITED));
      },
    }),
  );

  // 8. Publicly served files (vehicle images only).
  //    Note the path: this serves the storage root's `public/` folder ONLY.
  //    Private uploads live in a sibling `private/` folder that is never
  //    mounted here - customer documents (Phase 5) go through an authorised
  //    route instead, per BRD 12.
  if (storage instanceof LocalStorageProvider) {
    app.use(
      '/uploads',
      // Helmet sets Cross-Origin-Resource-Policy: same-origin globally, which
      // is right for the API and WRONG here: the customer site runs on a
      // different origin, so the browser would refuse to render every vehicle
      // photo it serves. Relaxed for this mount only, and only because these
      // files are public marketing images by definition - private documents
      // are never served from this directory, they go through an authorised
      // streaming route.
      helmet.crossOriginResourcePolicy({ policy: 'cross-origin' }),
      express.static(storage.publicDirectory(), {
        maxAge: isProduction ? '7d' : 0,
        index: false,
        dotfiles: 'deny',
        // Do not fall through to the API router on a miss: a request for a
        // file that does not exist should 404 here, not be re-matched.
        fallthrough: true,
      }),
    );
  }

  // 9. API routes.
  app.use(env.API_PREFIX, apiV1Router);

  // 9. Nothing matched.
  app.use(notFound);

  // 10. Central error handler — MUST be registered last.
  app.use(errorHandler);

  return app;
}
