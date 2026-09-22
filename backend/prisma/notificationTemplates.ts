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
  /**
   * Bodies from earlier versions of THIS file that this one replaces.
   *
   * The seeder never overwrites the client's wording - but a database still
   * holding our own superseded default is not the client's wording, it is
   * ours, and leaving it there means a template that no longer matches the
   * placeholders the trigger now supplies. Matching on the exact previous
   * text is what separates the two cases: any edit at all, however small,
   * and the row is left alone.
   */
  supersedes?: string[];
}

export const NOTIFICATION_TEMPLATES: TemplateSeed[] = [
  {
    /*
     * One month of a long-term rental has fallen due.
     *
     * Sent on the day it becomes payable, not after it is late: a customer who
     * hears from you only once they are overdue is a customer you have already
     * annoyed, and chasing is more expensive than reminding.
     */
    key: 'instalment.due',
    channel: 'EMAIL',
    subject: 'Month {{sequence}} of {{termMonths}} is due - {{bookingNumber}}',
    body: [
      'Dear {{customerName}},',
      '',
      'Your next monthly payment for booking {{bookingNumber}} is now due.',
      '',
      '  Month:   {{sequence}} of {{termMonths}}',
      '  Covers:  {{periodStart}} to {{periodEnd}}',
      '  Amount:  {{amount}}',
      '',
      'You can pay it here:',
      '{{bookingUrl}}',
      '',
      '{{companyName}}',
    ].join('\n'),
    description: 'Sent when a month of a long-term rental becomes payable (BRD 16).',
  },
  {
    /*
     * Internal, not customer-facing (BRD 41: "the admin should receive
     * reminders"). It names the vehicle and the date rather than just saying
     * something expires soon, because a reminder you have to go and look up is
     * a reminder that gets postponed.
     */
    key: 'fleet.expiry_reminder',
    channel: 'EMAIL',
    subject: '{{label}} expires in {{daysRemaining}} days - {{vehicle}}',
    body: [
      'Hello {{recipientName}},',
      '',
      '{{kindLabel}} for {{vehicle}} expires on {{expiryDate}} ({{daysRemaining}} days).',
      '',
      '  {{label}}',
      '',
      'Renew it before a rental is refused or a claim is declined.',
      '',
      '{{companyName}}',
    ].join('\n'),
    description: 'Sent to administrators when a vehicle registration or insurance policy reaches a configured reminder day.',
  },
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
    description:
      'Sent when a booking becomes confirmed - by payment, or by staff confirming a cash booking (BRD 42).',
    // {{confirmationLine}} and {{paymentNote}} are filled by the trigger, not
    // written here, because a booking can be confirmed with or without money
    // having arrived and one fixed sentence cannot be true of both.
    supersedes: [
      `Dear {{customerName}},

Your payment has gone through and {{vehicle}} is reserved for you.

  Booking: {{bookingNumber}}
  Pick up: {{pickupAt}} at {{pickupLocation}}
  Return:  {{returnAt}}

Please bring the documents you uploaded with you.

Manage your booking: {{bookingUrl}}`,
    ],
    body: `Dear {{customerName}},

{{confirmationLine}}

  Booking:  {{bookingNumber}}
  Vehicle:  {{vehicle}}
  Pick up:  {{pickupAt}} at {{pickupLocation}}
  Return:   {{returnAt}}
  Total:    {{total}}
  Deposit:  {{deposit}} (refundable)

{{paymentNote}}

Please bring the documents you uploaded with you when you collect the vehicle.

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
    /*
     * The one email that has to arrive, and the one that is most often
     * mistaken for phishing - so it says plainly what was asked for, by whom,
     * and what to do if it was not them.
     */
    key: 'auth.password_reset',
    channel: 'EMAIL',
    subject: 'Reset your password',
    description: 'Sent when somebody asks to reset a forgotten password.',
    body: `Hello {{customerName}},

Somebody asked to reset the password for this account. If that was you, use
the link below within {{expiresInMinutes}} minutes:

{{resetUrl}}

Setting a new password signs you out everywhere, on every device.

If you did not ask for this, you can ignore this email - your password has not
changed and nobody can change it without this link.`,
  },
  {
    key: 'auth.email_verification',
    channel: 'EMAIL',
    subject: 'Confirm your email address',
    description: 'Sent to confirm a newly registered address belongs to the person who typed it.',
    body: `Welcome {{customerName}},

Please confirm this is your email address by following the link below within
{{expiresInHours}} hours:

{{verifyUrl}}

We use it to send booking confirmations, pickup reminders and invoices, so it
is worth getting right.`,
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
    /*
     * Sent the moment money leaves a deposit.
     *
     * Nothing told the customer about a deduction at all: they found out when
     * a refund arrived short, which is how a correct recovery becomes an
     * argument. It arrives while they still remember the gate or the day of
     * the offence, and it names the reason rather than just the amount.
     */
    key: 'deposit.deducted',
    channel: 'EMAIL',
    subject: '{{amount}} deducted from your deposit - {{bookingNumber}}',
    description: 'Sent when a charge is taken out of a security deposit (BRD 20).',
    body: `Dear {{customerName}},

We have deducted {{amount}} from your security deposit for booking
{{bookingNumber}}.

  What for:  {{categoryLabel}}
  Details:   {{reason}}

Your deposit balance is now {{balance}}. The rest is returned when the
rental is settled.

If you think this is wrong, reply to this email and we will look into it.

{{bookingUrl}}`,
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
  let upgraded = 0;

  for (const template of NOTIFICATION_TEMPLATES) {
    const existing = await prisma.notificationTemplate.findUnique({
      where: { key_channel: { key: template.key, channel: template.channel } },
    });

    if (existing) {
      // Never overwrite the CLIENT's wording. But if the row still holds a
      // superseded default of ours, word for word, nobody has edited it and
      // leaving it is not respect for their text - it is shipping a stale
      // message whose placeholders the trigger no longer fills.
      if (template.supersedes?.includes(existing.body)) {
        await prisma.notificationTemplate.update({
          where: { id: existing.id },
          data: {
            body: template.body,
            subject: template.subject ?? null,
            description: template.description,
          },
        });
        upgraded += 1;
      }
      continue;
    }

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

  if (upgraded > 0) {
    console.log(`  ${upgraded} unedited template(s) brought up to date.`);
  }

  return created;
}
