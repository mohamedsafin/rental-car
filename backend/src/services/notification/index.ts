/**
 * services/notification/index.ts
 * ---------------------------------------------------------------------------
 * Chooses the notification driver once, at boot, from NOTIFICATION_DRIVER.
 *
 * The only file that knows how messages actually leave the building. When the
 * client picks a provider (BRD 51), this gains a `case` and the project gains
 * one new file - nothing in bookings, payments or the expiry scan changes.
 */
import { env, isProduction } from '../../config/env';
import { logger } from '../../config/logger';
import { LogNotificationProvider } from './logProvider';
import { SmtpNotificationProvider } from './smtpProvider';
import type { NotificationProvider } from './types';

function createProvider(): NotificationProvider {
  switch (env.NOTIFICATION_DRIVER) {
    case 'log':
      if (isProduction) {
        // In production this would mean every booking confirmation, payment
        // receipt and expiry warning is composed, logged and thrown away -
        // while the system reports them as sent. Refusing to boot is the only
        // honest response.
        throw new Error(
          'NOTIFICATION_DRIVER=log cannot be used in production: no message would actually be delivered. Configure the provider chosen by the client (BRD 51).',
        );
      }
      return new LogNotificationProvider();

    case 'smtp':
      // SMTP is the protocol, not a supplier. Gmail, Microsoft 365, Resend,
      // Brevo, SES and the client's own mail server all speak it, so this
      // driver does not pre-empt the choice BRD 51 leaves to the client - it
      // just means the choice is made with a hostname instead of a code
      // change.
      return new SmtpNotificationProvider();

    case 'sendgrid':
    case 'twilio':
      throw new Error(
        `NOTIFICATION_DRIVER="${env.NOTIFICATION_DRIVER}" is not implemented yet. The provider is the client's choice (BRD 51); its driver is written once they confirm it. Use NOTIFICATION_DRIVER=smtp with their mail server's details, or =log for development.`,
      );

    default:
      throw new Error(`Unknown NOTIFICATION_DRIVER: ${String(env.NOTIFICATION_DRIVER)}`);
  }
}

export const notificationProvider: NotificationProvider = createProvider();

logger.info('Notification provider initialised', { driver: notificationProvider.name });

export * from './types';
export { LogNotificationProvider, SmtpNotificationProvider };
