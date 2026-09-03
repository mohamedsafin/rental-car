/**
 * server.ts
 * ---------------------------------------------------------------------------
 * The entry point. Its only jobs: verify the database, start listening, and
 * shut down cleanly.
 *
 * Graceful shutdown matters in production: when a deploy sends SIGTERM we stop
 * accepting new requests, let in-flight ones finish, then close the Prisma
 * pool. Without it, a booking could be cut off mid-transaction.
 */
import type { Server } from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { checkDatabaseConnection, disconnectPrisma } from './config/prisma';

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function bootstrap(): Promise<void> {
  const databaseUp = await checkDatabaseConnection();
  if (!databaseUp) {
    // We start anyway so /health can report the problem, but we shout about it.
    logger.warn('Starting without a database connection. Check DATABASE_URL and that PostgreSQL is running.');
  } else {
    logger.info('Database connection established');
  }

  const app = createApp();
  const server: Server = app.listen(env.PORT, () => {
    logger.info('Server started', {
      port: env.PORT,
      environment: env.NODE_ENV,
      healthCheck: `http://localhost:${env.PORT}${env.API_PREFIX}/health`,
    });
  });

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down gracefully`);

    const forceExit = setTimeout(() => {
      logger.error('Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    server.close(async () => {
      await disconnectPrisma();
      logger.info('Shutdown complete');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { reason: String(reason) });
  });

  process.on('uncaughtException', (error) => {
    // An uncaught exception leaves the process in an unknown state. Log and die;
    // the process manager restarts us clean.
    logger.error('Uncaught exception, exiting', { error: error.message, stack: error.stack });
    process.exit(1);
  });
}

void bootstrap();
