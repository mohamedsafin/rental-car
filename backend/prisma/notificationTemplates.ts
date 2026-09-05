/**
 * prisma/notificationTemplates.ts
 * ---------------------------------------------------------------------------
 * The default wording for every message the system sends (BRD 44).
 *
 * Unlike prices, blank templates would be actively harmful: a system that
 * sends nothing looks like it works, and nobody finds out the confirmations
 * never went until a customer complains. So these ship with plain, functional
 * English.
 *
 * They are seeded into the DATABASE, not hardcoded, because the wording, tone
 * and language are the client's. Changing "Dear {{customerName}}" is an edit
 * in the admin dashboard, not a deployment. Seeding uses `create`-if-missing,
 * so re-running the seed never overwrites text the client has since edited.
 *
 * Placeholders are {{camelCase}} and are filled by modules/notifications/
 * triggers.ts. An unknown placeholder is left visible rather than blanked -
 * "Dear {{name}}" is obviously a bug; "Dear " looks like a broken account.
 */
import type { PrismaClient } from '@prisma/client';

interface TemplateSeed {
  key: string;
  channel: 'EMAIL' | 'SMS' | 'WHATSAPP' | 'IN_APP';
  subject?: string;
  body: string;
  description: string;
}

export const NOTIFICATION_TEMPLATES: TemplateSeed[] = [
  {
    key: 'booking.created',
    channel: 'EMAIL',
    subject: 'Booking {{bookingNumber}} received',
    description: 'Sent the moment a booking is created, before payment.',
    body: `Dear {{customerName}},

We have your booking request for the {{vehicle}}.

  Booking:  {{bookingNumber}}
  Pick up:  {{pickupAt}} at {{pickupLocation}}
  Return:   {{returnAt}}
  Duration: {{rentalDays}} day(s)
  Total:    {{total}}
  Deposit:  {{deposit}} (refundable)

{{nextStep}}

You can review it here: {{bookingUrl}}`,
  },
  {
    key: 'booking.confirmed',
    channel: 'EMAIL',
    subject: 'Booking {{bookingNumber}} is confirmed',
    description: 'Sent when payment succeeds and the vehicle is reserved (BRD 42).',
    body: `Dear {{customerName}},

Your payment has gone through and {{vehicle}} is reserved for you.

  Booking: {{bookingNumber}}
  Pick up: {{pickupAt}} at {{pickupLocation}}
  Return:  {{returnAt}}

Please bring the documents you uploaded with you.

Manage your booking: {{bookingUrl}}`,
  },
  {
    key: 'booking.cancelled',
    channel: 'EMAIL',
    subject: 'Booking {{bookingNumber}} cancelled',
    description: 'Sent on cancellation, stating the fee and what is refundable.',
    body: `Dear {{customerName}},

Booking {{bookingNumber}} for the {{vehicle}} has been cancelled.

  Cancellation fee: {{cancellationFee}}
  Refund due:       {{refundDue}}

Any refund is returned to the card you paid with.

{{bookingUrl}}`,
  },
  {
    key: 'payment.received',
    channel: 'EMAIL',
    subject: 'Payment received for {{bookingNumber}}',
    description: 'Receipt for any successful payment, including the deposit.',
    body: `We have received your {{paymentType}} of {{amount}} for booking {{bookingNumber}}.

{{bookingUrl}}`,
  },
  {
    key: 'booking.pickup_reminder',
    channel: 'EMAIL',
    subject: 'Your rental starts tomorrow - {{bookingNumber}}',
    description: 'Sent ~24h before pickup (BRD 43).',
    body: `Dear {{customerName}},

A reminder that your {{vehicle}} is ready for collection.

  Pick up: {{pickupAt}}
  From:    {{pickupLocation}}

Please bring your driving licence and the ID you registered with.

{{bookingUrl}}`,
  },
  {
    key: 'booking.return_reminder',
    channel: 'EMAIL',
    subject: 'Return due tomorrow - {{bookingNumber}}',
    description: 'Sent ~24h before the return time (BRD 43).',
    body: `Dear {{customerName}},

Your rental of the {{vehicle}} is due back at {{returnAt}}.

Returning late may incur a charge. If you need longer, you can request an
extension from your booking page: {{bookingUrl}}`,
  },
  {
    key: 'document.reviewed',
    channel: 'EMAIL',
    subject: 'Your {{documentType}} has been reviewed',
    description: 'Sent when staff approve or reject an identity document (BRD 13).',
    body: `Your {{documentType}} has been {{outcome}}.

{{reason}}

{{nextStep}}

You can review your documents here: {{documentsUrl}}`,
  },
  {
    key: 'invoice.issued',
    channel: 'EMAIL',
    subject: 'Invoice {{invoiceNumber}}',
    description: 'Sent when an invoice is issued for a booking (BRD 28).',
    body: `Dear {{customerName}},

Invoice {{invoiceNumber}} for booking {{bookingNumber}} is ready.

  Total: {{total}}

You can view and download it here: {{invoiceUrl}}`,
  },
  {
    key: 'deposit.released',
    channel: 'EMAIL',
    subject: 'Your deposit has been released - {{bookingNumber}}',
    description: 'Sent when a security deposit is returned (BRD 20).',
    body: `Dear {{customerName}},

We have released {{amount}} of your security deposit for booking
{{bookingNumber}}. It should reach your account within a few working days,
depending on your bank.

{{bookingUrl}}`,
  },

  // An SMS alternative for the two time-critical messages. The client decides
  // whether to switch these on; both channels can be active at once.
  {
    key: 'booking.confirmed',
    channel: 'SMS',
    description: 'Short confirmation. Off until the client enables SMS.',
    body: 'Booking {{bookingNumber}} confirmed. {{vehicle}}, pick up {{pickupAt}} at {{pickupLocation}}.',
  },
  {
    key: 'booking.pickup_reminder',
    channel: 'SMS',
    description: 'Short pickup reminder. Off until the client enables SMS.',
    body: 'Reminder: collect your {{vehicle}} at {{pickupAt}} from {{pickupLocation}}. Ref {{bookingNumber}}.',
  },
];

export async function seedNotificationTemplates(prisma: PrismaClient): Promise<number> {
  let created = 0;

  for (const template of NOTIFICATION_TEMPLATES) {
    const existing = await prisma.notificationTemplate.findUnique({
      where: { key_channel: { key: template.key, channel: template.channel } },
    });

    // Never overwrite. Once the client has reworded a message, re-running the
    // seed must not quietly put our English back.
    if (existing) continue;

    await prisma.notificationTemplate.create({
      data: {
        key: template.key,
        channel: template.channel,
        subject: template.subject ?? null,
        body: template.body,
        description: template.description,
        // SMS costs money per message and needs a provider the client has not
        // chosen. Seeded off; email is seeded on.
        isActive: template.channel === 'EMAIL',
      },
    });
    created += 1;
  }

  return created;
}
