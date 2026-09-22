/**
 * config/scheduler.ts
 * ---------------------------------------------------------------------------
 * The thing that makes the background jobs actually happen.
 *
 * Three jobs were written, correct, and never ran: nothing in the system had
 * a clock. Reminders were composed by code no caller reached, expiry warnings
 * waited for an admin to open a page, and abandoned bookings held cars off
 * sale until somebody noticed. A job with no scheduler is a comment.
 *
 * ===========================================================================
 * WHY setInterval AND NOT A CRON LIBRARY
 * ===========================================================================
 * Every job here is idempotent by QUERY - each asks the database what still
 * needs doing and skips what is already done. That is what makes "roughly
 * every hour" sufficient and a precise "02:00 daily" unnecessary: running
 * twice costs nothing, and running late still catches everything. A cron
 * dependency would buy precision none of these jobs need.
 *
 * ===========================================================================
 * WHAT THIS IS NOT
 * ===========================================================================
 * It is in-process, so it runs once per API instance. Two instances means two
 * schedulers, and the jobs' own idempotency is what stops that double-sending
 * rather than any coordination here. That holds for the single container this
 * project deploys as; a multi-instance deployment should move these to an
 * external trigger (a container cron, or a cloud scheduler hitting protected
 * endpoints) rather than trusting every replica to behave.
 */
import { env } from './env';
import { logger } from './logger';

interface Job {
  name: string;
  /** How often to run it. */
  everyMs: number;
  run: () => Promise<unknown>;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Run one job, and never let it take the process down.
 *
 * A job that throws must not stop the others, and must not become an
 * unhandled rejection - these run detached from any request, so there is no
 * error handler above them.
 */
async function runSafely(job: Job): Promise<void> {
  const startedAt = Date.now();
  try {
    const result = await job.run();
    logger.info('Scheduled job finished', {
      job: job.name,
      ms: Date.now() - startedAt,
      result,
    });
  } catch (error) {
    logger.error('Scheduled job failed', {
      job: job.name,
      ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

let timers: NodeJS.Timeout[] = [];

export function startScheduler(): void {
  if (!env.SCHEDULER_ENABLED) {
    logger.info('Scheduler disabled', { reason: 'SCHEDULER_ENABLED=false' });
    return;
  }

  const jobs: Job[] = [
    {
      /*
       * Abandoned checkouts. The hold is 30 minutes by default, so five
       * minutes is fine enough to free a car promptly without hammering the
       * database for rows that are almost never there.
       */
      name: 'release-expired-holds',
      everyMs: 5 * MINUTE,
      run: async () => {
        const { bookingsService } = await import('../modules/bookings/service');
        return { released: await bookingsService.releaseExpiredHolds() };
      },
    },
    {
      /*
       * Pickup and return reminders. The sweep looks 24 hours ahead and skips
       * anything already told, so hourly gives every booking its reminder
       * without a second one.
       */
      name: 'booking-reminders',
      everyMs: HOUR,
      run: async () => {
        const { notify } = await import('../modules/notifications/triggers');
        return notify.runDueReminders();
      },
    },
    {
      /*
       * Monthly rental payments falling due. Hourly rather than daily so a
       * customer paying on the morning of the 1st is not told at midnight and
       * then chased again, and a restart cannot skip a due date.
       */
      name: 'due-instalments',
      everyMs: HOUR,
      run: async () => {
        const { notify } = await import('../modules/notifications/triggers');
        return notify.runDueInstalments();
      },
    },
    {
      /*
       * Registration and insurance expiries. These are counted in whole days,
       * so anything under a day is wasted work - but six-hourly rather than
       * daily means a restart cannot skip a day entirely.
       */
      name: 'expiry-reminders',
      everyMs: 6 * HOUR,
      run: async () => {
        const { notify } = await import('../modules/notifications/triggers');
        return notify.runExpiryReminders();
      },
    },
    {
      /*
       * Spent and expired password-reset and email-confirmation links.
       *
       * Nothing depends on this: every check already refuses a stale token.
       * It only stops the table growing forever, so once a day is plenty.
       */
      name: 'purge-verification-tokens',
      everyMs: 24 * HOUR,
      run: async () => {
        const { verificationService } = await import('../modules/auth/verificationService');
        return verificationService.purgeExpired();
      },
    },
  ];

  for (const job of jobs) {
    /*
     * Staggered, not all at once on boot.
     *
     * Starting every job in the same tick means every restart fires a burst of
     * queries and a burst of email. The offset is per-job and small.
     */
    const firstRunIn = 30_000 + jobs.indexOf(job) * 15_000;

    const timer = setTimeout(() => {
      void runSafely(job);
      const interval = setInterval(() => void runSafely(job), job.everyMs);
      // Do not hold the event loop open: a process that has been asked to stop
      // should stop, not wait for the next sweep.
      interval.unref();
      timers.push(interval);
    }, firstRunIn);

    timer.unref();
    timers.push(timer);
  }

  logger.info('Scheduler started', {
    jobs: jobs.map((job) => `${job.name} every ${Math.round(job.everyMs / MINUTE)}m`),
  });
}

/** Stop every timer. Used by tests and by a graceful shutdown. */
export function stopScheduler(): void {
  timers.forEach((timer) => clearInterval(timer));
  timers = [];
}
