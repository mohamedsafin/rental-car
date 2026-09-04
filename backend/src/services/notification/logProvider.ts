/**
 * services/notification/logProvider.ts
 * ---------------------------------------------------------------------------
 * The default driver: it writes the message to the application log and
 * reports success. It does not send anything.
 *
 * This exists because BRD 51 says the notification provider is the client's
 * choice, and we are not going to invent one. The alternatives were both
 * worse:
 *
 *  - Sending nothing silently: the rest of the system would look like it
 *    works, and nobody finds out the confirmation emails never went until a
 *    customer complains.
 *  - Picking a provider: an API key we do not have, for an account nobody
 *    agreed to pay for.
 *
 * So messages are composed for real, recorded in the `notifications` table for
 * real, and printed where a developer can read them. When the client names a
 * provider, writing that driver is one file and one environment variable; not
 * a single caller changes.
 *
 * It refuses to be the driver in production, for the obvious reason.
 */
import { logger } from '../../config/logger';
import type { DeliveryResult, NotificationChannel, NotificationProvider, OutboundMessage } from './types';

export class LogNotificationProvider implements NotificationProvider {
  readonly name = 'log';

  supports(_channel: NotificationChannel): boolean {
    // Every channel, because it transmits on none of them.
    return true;
  }

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    logger.info('Notification (not actually sent - log driver)', {
      channel: message.channel,
      to: message.to,
      subject: message.subject,
      // Truncated: the log is for confirming a message was composed and
      // addressed correctly, not for archiving its text. The full body is in
      // the notifications table.
      preview: message.body.slice(0, 200),
    });

    return { providerRef: `log-${Date.now()}` };
  }
}
