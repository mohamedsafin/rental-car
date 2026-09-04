/**
 * modules/notifications/service.ts
 * ---------------------------------------------------------------------------
 * Composes, records and dispatches outbound messages (BRD 42-44).
 *
 * The ordering is the design:
 *
 *   1. resolve the template
 *   2. fill in the placeholders
 *   3. WRITE THE ROW
 *   4. hand it to the provider
 *   5. update the row with what happened
 *
 * Writing the row before attempting delivery is what makes "did the customer
 * get the confirmation?" a query instead of a guess. If the provider throws,
 * times out, or the process dies mid-call, there is still a record saying what
 * we meant to send, to whom, and that it did not go.
 *
 * `send()` NEVER throws. A notification is a side effect of something that has
 * already happened - a booking is confirmed whether or not the email left the
 * building - and letting a mail server outage roll back a paid booking would
 * be a far worse failure than a missing email. Failures are recorded and
 * surfaced in the admin dashboard instead.
 */
import type { NotificationChannel, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { logger } from '../../config/logger';
import { env } from '../../config/env';
import { ApiError } from '../../utils/ApiError';
import { notificationProvider } from '../../services/notification';

export interface SendInput {
  templateKey: string;
  channel?: NotificationChannel;
  /** Who it is for. Their address is read from their account. */
  recipientId?: string;
  /** Overrides the recipient's stored address - used for one-off sends. */
  to?: string;
  /** Values for the template's {{placeholders}}. */
  data?: Record<string, string | number | null | undefined>;
  related?: { type: string; id: string };
}

export const notificationsService = {
  /**
   * Compose, record and attempt one message.
   *
   * Returns the row rather than a boolean, so a caller that wants to know the
   * outcome can look - but almost none do, and none should block on it.
   */
  async send(input: SendInput) {
    const channel = input.channel ?? 'EMAIL';

    try {
      const template = await prisma.notificationTemplate.findUnique({
        where: { key_channel: { key: input.templateKey, channel } },
      });

      if (!template || !template.isActive) {
        // Not an error. A client who has switched a message off has switched
        // it off; the log row records that we chose not to send.
        return this.record({
          channel,
          templateKey: input.templateKey,
          recipientId: input.recipientId,
          to: input.to ?? 'unknown',
          subject: null,
          body: '',
          status: 'SKIPPED',
          lastError: template ? 'Template is switched off' : 'No template configured for this event',
          related: input.related,
        });
      }

      const to = input.to ?? (await addressFor(input.recipientId, channel));

      if (!to) {
        return this.record({
          channel,
          templateKey: input.templateKey,
          recipientId: input.recipientId,
          to: 'unknown',
          subject: template.subject,
          body: '',
          status: 'SKIPPED',
          lastError: `No ${channel.toLowerCase()} address on file for this recipient`,
          related: input.related,
        });
      }

      const data = { ...defaultData(), ...(input.data ?? {}) };
      const subject = template.subject ? fill(template.subject, data) : null;
      const body = fill(template.body, data);

      // The row exists BEFORE the provider is called.
      const notification = await this.record({
        channel,
        templateKey: input.templateKey,
        recipientId: input.recipientId,
        to,
        subject,
        body,
        status: 'PENDING',
        related: input.related,
      });

      if (!notificationProvider.supports(channel)) {
        return prisma.notification.update({
          where: { id: notification.id },
          data: {
            status: 'SKIPPED',
            provider: notificationProvider.name,
            lastError: `The ${notificationProvider.name} driver cannot send on ${channel}`,
          },
        });
      }

      try {
        const result = await notificationProvider.send({ channel, to, subject: subject ?? undefined, body });

        return await prisma.notification.update({
          where: { id: notification.id },
          data: {
            status: 'SENT',
            attempts: { increment: 1 },
            provider: notificationProvider.name,
            providerRef: result.providerRef ?? null,
            sentAt: new Date(),
          },
        });
      } catch (error) {
        return await prisma.notification.update({
          where: { id: notification.id },
          data: {
            status: 'FAILED',
            attempts: { increment: 1 },
            provider: notificationProvider.name,
            lastError: error instanceof Error ? error.message : String(error),
          },
        });
      }
    } catch (error) {
      // Composing failed - a missing user, a database blip. Still must not
      // propagate: the thing this message is about already happened.
      logger.error('Notification could not be composed', {
        templateKey: input.templateKey,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  },

  /** Write the log row. Exposed so a SKIPPED outcome is recorded the same way. */
  async record(input: {
    channel: NotificationChannel;
    templateKey: string;
    recipientId?: string;
    to: string;
    subject: string | null;
    body: string;
    status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';
    lastError?: string;
    related?: { type: string; id: string };
  }) {
    return prisma.notification.create({
      data: {
        channel: input.channel,
        templateKey: input.templateKey,
        recipientId: input.recipientId ?? null,
        toAddress: input.to,
        subject: input.subject,
        body: input.body,
        status: input.status,
        lastError: input.lastError ?? null,
        relatedType: input.related?.type ?? null,
        relatedId: input.related?.id ?? null,
      },
    });
  },

  /**
   * Try a failed message again.
   *
   * Re-sends the body EXACTLY as it was composed. Recomposing from the
   * template would quietly send different text from the one the log says
   * failed - and if a price changed in between, a different price.
   */
  async retry(id: string) {
    const notification = await prisma.notification.findUnique({ where: { id } });
    if (!notification) throw ApiError.notFound('Notification not found');

    if (notification.status === 'SENT') {
      throw ApiError.conflict('This message was already delivered');
    }

    try {
      const result = await notificationProvider.send({
        channel: notification.channel,
        to: notification.toAddress,
        subject: notification.subject ?? undefined,
        body: notification.body,
      });

      return prisma.notification.update({
        where: { id },
        data: {
          status: 'SENT',
          attempts: { increment: 1 },
          provider: notificationProvider.name,
          providerRef: result.providerRef ?? null,
          sentAt: new Date(),
        },
      });
    } catch (error) {
      return prisma.notification.update({
        where: { id },
        data: {
          status: 'FAILED',
          attempts: { increment: 1 },
          provider: notificationProvider.name,
          lastError: error instanceof Error ? error.message : String(error),
        },
      });
    }
  },

  async list(query: {
    page: number;
    limit: number;
    status?: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';
    channel?: NotificationChannel;
    relatedId?: string;
  }) {
    const where: Prisma.NotificationWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.channel ? { channel: query.channel } : {}),
      ...(query.relatedId ? { relatedId: query.relatedId } : {}),
    };

    const [items, total] = await prisma.$transaction([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.notification.count({ where }),
    ]);

    return {
      items: items.map((notification) => ({
        id: notification.id,
        channel: notification.channel,
        templateKey: notification.templateKey,
        to: notification.toAddress,
        subject: notification.subject,
        // Enough to identify the message in a list without dumping a full
        // email body into a table cell.
        preview: notification.body.slice(0, 160),
        status: notification.status,
        attempts: notification.attempts,
        provider: notification.provider,
        lastError: notification.lastError,
        sentAt: notification.sentAt?.toISOString() ?? null,
        createdAt: notification.createdAt.toISOString(),
      })),
      total,
    };
  },

  // --- Templates (admin) ---------------------------------------------------

  async listTemplates() {
    const templates = await prisma.notificationTemplate.findMany({
      orderBy: [{ key: 'asc' }, { channel: 'asc' }],
    });

    return templates.map((template) => ({
      id: template.id,
      key: template.key,
      channel: template.channel,
      subject: template.subject,
      body: template.body,
      description: template.description,
      isActive: template.isActive,
    }));
  },

  async updateTemplate(
    id: string,
    input: { subject?: string; body?: string; isActive?: boolean },
  ) {
    const template = await prisma.notificationTemplate.findUnique({ where: { id } });
    if (!template) throw ApiError.notFound('Template not found');

    const updated = await prisma.notificationTemplate.update({
      where: { id },
      data: {
        ...(input.subject !== undefined ? { subject: input.subject } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });

    return {
      id: updated.id,
      key: updated.key,
      channel: updated.channel,
      subject: updated.subject,
      body: updated.body,
      isActive: updated.isActive,
    };
  },
};

/**
 * Substitute {{placeholders}}.
 *
 * An unknown placeholder is left as-is rather than blanked. "Dear {{name}}"
 * reaching a customer is embarrassing but obvious; "Dear " is embarrassing and
 * looks like a bug in their account.
 */
function fill(text: string, data: Record<string, string | number | null | undefined>): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key: string) => {
    const value = data[key];
    return value === undefined || value === null ? match : String(value);
  });
}

/** Values every template can use without the caller passing them. */
function defaultData(): Record<string, string> {
  return {
    siteUrl: env.PUBLIC_SITE_URL,
    year: String(new Date().getUTCFullYear()),
  };
}

/** The recipient's address for this channel, or null if we do not have one. */
async function addressFor(
  recipientId: string | undefined,
  channel: NotificationChannel,
): Promise<string | null> {
  if (!recipientId) return null;

  const user = await prisma.user.findUnique({
    where: { id: recipientId },
    select: { email: true, phone: true },
  });
  if (!user) return null;

  return channel === 'EMAIL' || channel === 'IN_APP' ? user.email : user.phone;
}
