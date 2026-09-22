/**
 * tests/setup.ts
 * ---------------------------------------------------------------------------
 * Runs before every test file, and settles one thing: how messages leave the
 * building during a test run.
 *
 * They do not. NOTIFICATION_DRIVER is pinned to `log` here for two reasons:
 *
 *   1. SAFETY. A developer whose `.env` points at a real mailbox - which is a
 *      perfectly normal way to work on the email templates - would otherwise
 *      have `npm test` send live booking confirmations to every throwaway
 *      address the suite invents. Nothing in a test run should reach a real
 *      inbox.
 *
 *   2. DETERMINISM. Several tests assert on what was composed and that the row
 *      reads SENT. Against a real SMTP server those rows sit at PENDING for as
 *      long as the handshake takes, so the same code passed or failed
 *      depending on whose machine ran it and how fast their mail host was.
 *
 * `dotenv` does not override variables that are already set, so this wins over
 * whatever `.env` says without editing anyone's file.
 *
 * Tests that need to prove the smtp driver's own behaviour construct it
 * directly with explicit settings - see notifications.test.ts - so pinning the
 * driver here costs no coverage.
 */
process.env.NOTIFICATION_DRIVER = 'log';
