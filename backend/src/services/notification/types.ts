/**
 * services/notification/types.ts
 * ---------------------------------------------------------------------------
 * The notification contract (BRD 42-44, 51).
 *
 * BRD 51 leaves the email, SMS and WhatsApp providers to the client, so no
 * business code may know which one is in use. Modules call
 * `notificationsService.send(...)` with a template key and some data; this
 * interface is what a driver has to satisfy, and the driver is chosen once, in
 * index.ts, from NOTIFICATION_DRIVER.
 *
 * Note what a provider does NOT do:
 *
 *  - it does not decide whether to send (the service already did),
 *  - it does not choose the wording (the template did),
 *  - it does not write the log row (the service wrote it before calling).
 *
 * It transmits, and it either succeeds or throws. Keeping it that narrow is
 * what makes swapping SendGrid for SMTP a one-file change.
 */

export type NotificationChannel = 'EMAIL' | 'SMS' | 'WHATSAPP' | 'IN_APP';

export interface OutboundMessage {
  channel: NotificationChannel;
  /** Email address or phone number, already resolved from the recipient. */
  to: string;
  /** Unused for SMS and WhatsApp. */
  subject?: string;
  body: string;
}

export interface DeliveryResult {
  /** The provider's own id, so a message can be chased up with them later. */
  providerRef?: string;
}

export interface NotificationProvider {
  readonly name: string;

  /** Which channels this driver can actually transmit on. */
  supports(channel: NotificationChannel): boolean;

  /**
   * Transmit, or throw. Throwing is how a failure is reported - the service
   * catches it, records the message as FAILED with the error text, and moves
   * on. A provider must never swallow an error and report success.
   */
  send(message: OutboundMessage): Promise<DeliveryResult>;
}
