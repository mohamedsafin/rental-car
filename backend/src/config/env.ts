/**
 * config/env.ts
 * ---------------------------------------------------------------------------
 * Loads `.env` and validates it with Zod BEFORE the rest of the app starts.
 *
 * Why this file exists:
 *  - `process.env` is `string | undefined` everywhere, which is unsafe.
 *  - A missing DATABASE_URL should crash at boot with a clear message, not
 *    halfway through a customer's booking.
 *  - Everywhere else in the codebase we import `env` and get typed, validated
 *    values. No other file should read `process.env` directly.
 */
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

/** Coerce a comma-separated env string into a trimmed string array. */
const csv = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );

const envSchema = z.object({
  // Runtime
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  API_PREFIX: z.string().startsWith('/').default('/api/v1'),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // CORS
  CORS_ORIGINS: csv,

  // Auth — validated now so Phase 2 cannot boot with placeholder-free config.
  JWT_ACCESS_SECRET: z.string().min(1).default('change-me-access-secret'),
  JWT_REFRESH_SECRET: z.string().min(1).default('change-me-refresh-secret'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

  // Brute-force protection on login.
  AUTH_MAX_FAILED_ATTEMPTS: z.coerce.number().int().positive().default(5),
  AUTH_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),

  // Refresh-token cookie.
  // SameSite is decided by SITE, not origin - the port is not part of a site -
  // so 'lax' correctly covers localhost:5173 -> localhost:4000 in dev, and
  // app.example.com -> api.example.com in production. Only a genuinely
  // cross-site deployment needs 'none', which also requires secure=true.
  COOKIE_SECURE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_DOMAIN: z.string().optional(),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),

  // File storage
  STORAGE_DRIVER: z.enum(['local', 's3', 'cloudinary']).default('local'),
  STORAGE_LOCAL_PATH: z.string().default('./uploads'),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().int().positive().default(10),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Print a readable list of problems and stop. Do not start a half-configured
  // server — a booking system that boots with bad config is worse than one
  // that refuses to boot.
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`\nInvalid environment configuration:\n${issues}\n`);
  process.exit(1);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
export const isDevelopment = env.NODE_ENV === 'development';

export type Env = typeof env;
