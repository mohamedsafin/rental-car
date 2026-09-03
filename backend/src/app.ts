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
import { logger } from './config/logger';
import { requestId } from './middleware/requestId';
import { notFound } from './middleware/notFound';
import { errorHandler } from './middleware/errorHandler';
import { apiV1Router } from './routes';
import { ApiError, ErrorCode } from './utils/ApiError';

export function createApp(): Application {
  const app = express();

  // Behind a reverse proxy (nginx, Render, Railway) this makes req.ip and the
  // rate limiter see the real client IP instead of the proxy's.
  app.set('trust proxy', 1);
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
  //    real file uploads go through multipart handling in Phase 5, not here.
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

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
      // Health checks never count; the whole limiter is off in tests.
      skip: (req) => isTest || req.path.startsWith('/health'),
      handler: (_req, _res, next) => {
        next(new ApiError(429, 'Too many requests, please try again later', ErrorCode.RATE_LIMITED));
      },
    }),
  );

  // 8. API routes.
  app.use(env.API_PREFIX, apiV1Router);

  // 9. Nothing matched.
  app.use(notFound);

  // 10. Central error handler — MUST be registered last.
  app.use(errorHandler);

  return app;
}
