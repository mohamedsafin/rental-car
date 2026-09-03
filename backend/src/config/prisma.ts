/**
 * config/prisma.ts
 * ---------------------------------------------------------------------------
 * The single PrismaClient instance for the whole backend.
 *
 * Why a singleton: each PrismaClient opens its own connection pool. Creating
 * one per module (or per request) exhausts PostgreSQL connections fast. In dev,
 * `tsx watch` reloads modules on every save, so we cache the client on
 * `globalThis` to avoid leaking a new pool on each reload.
 */
import { PrismaClient } from '@prisma/client';
import { env, isProduction, isTest } from './env';
import { logger } from './logger';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Silent in tests: the health tests deliberately exercise the 'database
    // down' path, and Prisma's own error output would drown the results.
    log: isTest ? [] : isProduction ? ['error'] : ['warn', 'error'],
    datasources: { db: { url: env.DATABASE_URL } },
  });

if (!isProduction) globalForPrisma.prisma = prisma;

/** Verify the database is reachable. Used by the health check and at boot. */
export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    logger.error('Database connection check failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
