/**
 * services/notification/smtpProvider.ts
 * ---------------------------------------------------------------------------
 * The driver that actually sends email, over SMTP.
 *
 * WHY THIS ONE AND NOT A VENDOR SDK
 *
 * BRD 51 leaves the notification provider to the client, and this file does
 * not overrule that. SMTP is the protocol, not a supplier: Gmail, Microsoft
 * 365, Resend, Brevo, Amazon SES and the client's own mail server all speak
 * it. Choosing SMTP therefore commits the client to nothing - they fill in a
 * host and a password for whichever service they end up paying for, and no
 * code changes. A SendGrid or Twilio driver, by contrast, WOULD be choosing
 * for them, which is why those two remain unimplemented.
 *
 * It transmits EMAIL only. `supports()` returning false for SMS and WhatsApp
 * is not a limitation to apologise for - it is the honest answer, and the
 * notification service records those messages as SKIPPED with the reason
 * rather than pretending they went out.
 *
 * The transport is built once, at boot, and the configuration is checked
 * there too. A missing password should stop the server starting, not surface
 * three days later as a confirmation email that silently failed.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import type {
  DeliveryResult,
  NotificationChannel,
  NotificationProvider,
  OutboundMessage,
} from './types';

/**
 * The settings this driver needs, as a shape rather than a direct read of the
 * process environment.
 *
 * Passed in (defaulting to the real env) so the refusal below can be tested
 * for what it is - a rule about missing configuration - instead of being
 * tested against whatever happens to be in the developer's own `.env`. A test
 * that passes or fails depending on whether the machine running it has a mail
 * password is not testing this code.
 */
export interface SmtpSettings {
  SMTP_HOST?: string;
  SMTP_PORT: number;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
  NOTIFICATION_FROM_EMAIL?: string;
  NOTIFICATION_FROM_NAME?: string;
}

/**
 * Everything SMTP needs, checked in one place so the error names all of the
 * missing pieces at once rather than one per restart.
 */
function readConfig(settings: SmtpSettings) {
  const missing: string[] = [];
  if (!settings.SMTP_HOST) missing.push('SMTP_HOST');
  if (!settings.SMTP_USER) missing.push('SMTP_USER');
  if (!settings.SMTP_PASSWORD) missing.push('SMTP_PASSWORD');
  if (!settings.NOTIFICATION_FROM_EMAIL) missing.push('NOTIFICATION_FROM_EMAIL');

  if (missing.length > 0) {
    throw new Error(
      `NOTIFICATION_DRIVER=smtp needs ${missing.join(', ')}. Without them the server would boot ` +
        'and then fail on every email it tried to send, which is a worse failure than not booting.',
    );
  }

  return {
    host: settings.SMTP_HOST!,
    port: settings.SMTP_PORT,
    user: settings.SMTP_USER!,
    password: settings.SMTP_PASSWORD!,
    from: settings.NOTIFICATION_FROM_EMAIL!,
    fromName: settings.NOTIFICATION_FROM_NAME,
  };
}

export class SmtpNotificationProvider implements NotificationProvider {
  readonly name = 'smtp';

  private readonly transporter: Transporter;
  private readonly from: string;

  /** Defaults to the real environment; production calls it with no argument. */
  constructor(settings: SmtpSettings = env) {
    const config = readConfig(settings);

    this.from = config.fromName ? `"${config.fromName}" <${config.from}>` : config.from;

    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      /*
       * Port 465 is implicit TLS - the connection is encrypted from the first
       * byte. Every other port (587, 25, 2525) starts in the clear and is
       * upgraded by STARTTLS, which `secure: false` enables rather than
       * disables. Getting this backwards is the single most common SMTP
       * misconfiguration, so it is derived from the port instead of being
       * another switch to set wrongly.
       */
      secure: config.port === 465,
      auth: { user: config.user, pass: config.password },
      // A mail server that has stopped responding must not hold a request
      // open indefinitely. Sending is detached from the booking anyway, so
      // failing after 10 seconds costs nothing but the retry.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });

    logger.info('SMTP transport ready', {
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      from: this.from,
    });
  }

  supports(channel: NotificationChannel): boolean {
    return channel === 'EMAIL';
  }

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    if (message.channel !== 'EMAIL') {
      // Unreachable through the service, which checks supports() first, but a
      // provider that quietly did nothing here would report success for an
      // SMS that was never sent.
      throw new Error(`The smtp driver cannot transmit on ${message.channel}`);
    }

    const info = await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject ?? '(no subject)',
      // Templates are written as plain text. Sending them as text/plain is
      // deliberate: no HTML means nothing to sanitise, and a rendered blank
      // page in a strict mail client is impossible.
      text: message.body,
    });

    /*
     * Nodemailer resolves once the server has ACCEPTED the message. That is
     * not the same as delivery - a later bounce is invisible here - so the
     * `notifications` row means "handed to the mail server", and the message
     * id is what lets someone trace it in the provider's own logs.
     */
    if (info.rejected && info.rejected.length > 0) {
      throw new Error(`The mail server rejected: ${info.rejected.join(', ')}`);
    }

    return { providerRef: info.messageId };
  }

  /**
   * Proves the credentials work, without sending anything.
   *
   * Called from the health check rather than the constructor: a mail server
   * that is briefly unreachable at boot is not a reason to refuse to start,
   * but it IS something an operator should be able to ask about.
   */
  async verify(): Promise<boolean> {
    return this.transporter.verify();
  }
}
