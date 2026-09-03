/**
 * config/logger.ts
 * ---------------------------------------------------------------------------
 * A tiny structured logger. Deliberately dependency-free for now.
 *
 * Everything logs through here (never bare `console.log`) so that in Phase 11
 * we can swap the implementation for pino/winston + a log shipper by editing
 * ONE file instead of hundreds of call sites.
 */
import { env, isProduction } from './env';

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL: Level = env.NODE_ENV === 'test' ? 'warn' : isProduction ? 'info' : 'debug';

function write(level: Level, message: string, meta?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[MIN_LEVEL]) return;

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(meta ?? {}),
  };

  const line = isProduction ? JSON.stringify(entry) : `[${entry.timestamp}] ${level.toUpperCase()} ${message}${meta ? ` ${JSON.stringify(meta)}` : ''}`;

  if (level === 'error') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => write('debug', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => write('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => write('error', message, meta),
};
