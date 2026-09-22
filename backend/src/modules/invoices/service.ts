/**
 * modules/invoices/service.ts
 * ---------------------------------------------------------------------------
 * Tax invoices and credit notes (BRD 28).
 *
 * THE RULE: an invoice is a SNAPSHOT, and once issued it never changes.
 *
 * Every figure, every line, the company's address, the customer's name, the
 * VAT rate - all copied at the moment of issue. Nothing is read live when the
 * invoice is later viewed or downloaded. That is not defensive coding; it is
 * the difference between a document and a report. If invoices were rendered
 * from the live booking, then raising a daily rate next month would silently
 * rewrite last month's invoice, and a tax document that changes after issue is
 * not an error - it is a falsification.
 *
 * A mistake is corrected by issuing a CREDIT NOTE that references the original
 * and reverses it. Never by editing, never by deleting.
 */
import { Prisma } from '@prisma/client';
import type { Invoice, InvoiceLineItem, Role } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { ApiError } from '../../utils/ApiError';
import { auditService } from '../audit/service';
import { SettingKey, settingsService } from '../settings/service';
import { fireAndForget, notify } from '../notifications/triggers';
import { nextDocumentNumber } from './numbering';
import { isBackOffice } from '../../modules/auth/roles';

export interface InvoiceActor {
  /**
   * Null when the system issued it rather than a person.
   *
   * A month's invoice is raised by the payment clearing, not by anybody
   * clicking - and recording a staff member who was not there would be a
   * worse audit trail than recording nobody.
   */
  id: string | null;
  email: string;
  role: Role;
  ipAddress?: string;
  userAgent?: string;
}

const ZERO = new Prisma.Decimal(0);

/**
 * Bookings you may invoice.
 *
 * Not PENDING or DOCUMENT_VERIFICATION: nothing is agreed yet. Not CANCELLED:
 * a cancellation fee is billed through its own route, not as a rental invoice.
 */
const INVOICEABLE_STATUSES = [
  'CONFIRMED',
  'READY_FOR_PICKUP',
  'ACTIVE',
  'EXTENSION_REQUESTED',
  'RETURN_PENDING',
  'RETURNED',
  'COMPLETED',
] as const;

interface DraftLine {
  description: string;
  detail?: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  isTaxable: boolean;
}

export const invoicesService = {
  /**
   * Issue the tax invoice for ONE MONTH of a long-term rental.
   *
   * =========================================================================
   * WHY A MONTHLY RENTAL IS NOT ONE INVOICE
   * =========================================================================
   * A six-month rental is not one supply that happens to be paid in pieces -
   * it is six supplies, one a month, each with its own tax point. Issuing a
   * single document at the end would put six months of VAT into one period
   * and leave the customer nothing to reclaim against for five of them.
   *
   * So each month gets its own invoice, carrying that month's rent plus
   * whatever rode along on it - a Salik crossing, a fine - and nothing else.
   * The rent line names the period, because "Rental" repeated six times on a
   * customer's statement is not an accounting record.
   */
  async issueForInstalment(instalmentId: string, actor: InvoiceActor) {
    const instalment = await prisma.rentalInstalment.findUnique({
      where: { id: instalmentId },
      include: {
        charges: true,
        booking: {
          include: {
            vehicle: { select: { brand: true, model: true, year: true, registrationNumber: true } },
            customer: { select: { id: true, fullName: true, email: true, phone: true } },
          },
        },
      },
    });
    if (!instalment) throw ApiError.notFound('That month does not exist');

    /*
     * Paid months only.
     *
     * The tax point for a rental month is when it is settled. Invoicing one
     * in advance would declare VAT on money that has not arrived and may
     * never - a customer can cancel a long-term rental mid-term.
     */
    if (instalment.status !== 'PAID') {
      throw ApiError.conflict(
        'This month has not been paid yet. A month is invoiced when it is settled.',
      );
    }

    const existing = await prisma.invoice.findFirst({
      where: { instalmentId, type: 'INVOICE', status: { not: 'CANCELLED' } },
    });
    if (existing) {
      throw ApiError.conflict(
        `Month ${instalment.sequence} is already invoiced as ${existing.invoiceNumber}. Issue a credit note to correct it.`,
      );
    }

    const booking = instalment.booking;
    const period = `${instalment.periodStart.toISOString().slice(0, 10)} to ${instalment.periodEnd
      .toISOString()
      .slice(0, 10)}`;

    const lines: DraftLine[] = [
      {
        description: `${booking.vehicle.brand} ${booking.vehicle.model} - month ${instalment.sequence}`,
        detail: `${booking.vehicle.registrationNumber} · ${period}`,
        quantity: new Prisma.Decimal(1),
        /*
         * `subtotal`, not `amount`.
         *
         * The instalment stores the month VAT-INCLUSIVE in `amount`, with the
         * net in `subtotal` and the tax in `taxAmount`. An invoice line is
         * net by definition and the tax is stated once at the bottom - using
         * the gross here would add VAT to VAT.
         */
        unitPrice: instalment.subtotal,
        lineTotal: instalment.subtotal,
        isTaxable: true,
      },
      /*
       * Anything billed WITH this month, named individually - a customer
       * querying a bill AED 30 higher than last month must be able to see
       * which gate, on which day.
       *
       * Marked NOT taxable because no VAT was added when the charge was
       * raised: it is the authority's figure plus the company's handling fee,
       * and that is exactly what was collected. Adding VAT here would invoice
       * the customer for tax nobody charged them. If the client's accountant
       * wants these treated as a taxable recharge rather than a disbursement,
       * that is a change to how the charge is CREATED, not a fudge here.
       */
      ...instalment.charges.map((charge) => ({
        description: charge.description,
        quantity: new Prisma.Decimal(1),
        unitPrice: charge.amount,
        lineTotal: charge.amount,
        isTaxable: false,
      })),
    ];

    const seller = await sellerSnapshot();
    const taxableAmount = sum(lines.filter((line) => line.isTaxable));
    const nonTaxable = sum(lines.filter((line) => !line.isTaxable));
    const subtotal = taxableAmount.add(nonTaxable);

    /*
     * The rate this BOOKING agreed to, not today's rate.
     *
     * Derived from the instalment's own tax split, so a VAT change six weeks
     * into a six-month rental does not silently re-rate the months already
     * agreed.
     */
    const taxTotal = instalment.taxAmount;
    const taxPercentage = derivePercentage(taxTotal, taxableAmount);

    const invoice = await prisma.$transaction(async (tx) => {
      const created = await tx.invoice.create({
        data: {
          invoiceNumber: await nextDocumentNumber(tx, 'invoice'),
          type: 'INVOICE',
          status: 'PAID',
          bookingId: booking.id,
          instalmentId: instalment.id,
          customerId: booking.customerId,
          ...seller,
          customerName: booking.customer.fullName,
          customerEmail: booking.customer.email,
          customerPhone: booking.customer.phone,
          subtotal,
          discountTotal: new Prisma.Decimal(0),
          taxableAmount,
          taxPercentage,
          taxTotal,
          total: subtotal.add(taxTotal),
          currency: instalment.currency,
          issuedById: actor.id,
          notes: `Month ${instalment.sequence} of booking ${booking.bookingNumber} (${period}).`,
          lineItems: {
            create: lines.map((line, index) => ({
              sortOrder: index,
              description: line.description,
              detail: line.detail ?? null,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              lineTotal: line.lineTotal,
              isTaxable: line.isTaxable,
            })),
          },
        },
        include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
      });

      // The extras that rode along on this month are now on a tax document.
      await tx.additionalCharge.updateMany({
        where: { instalmentId: instalment.id, status: 'PENDING' },
        data: { status: 'INVOICED' },
      });

      return created;
    });

    await auditService.record({
      action: 'invoice.issued',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'Invoice',
      entityId: invoice.id,
      metadata: {
        invoiceNumber: invoice.invoiceNumber,
        bookingNumber: booking.bookingNumber,
        instalment: instalment.sequence,
        total: invoice.total.toFixed(2),
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return invoice;
  },

  /**
   * Issue the invoice for a booking.
   *
   * Refuses if one already stands. Re-invoicing a booking would put two live
   * tax documents for one supply into the world; the way to correct an invoice
   * is `creditNote()`, which is the whole reason that method exists.
   */
  async issueForBooking(bookingId: string, actor: InvoiceActor) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        vehicle: { select: { brand: true, model: true, year: true, registrationNumber: true } },
        customer: { select: { id: true, fullName: true, email: true, phone: true } },
        services: true,
        additionalCharges: true,
        pickupLocation: { select: { name: true } },
      },
    });
    if (!booking) throw ApiError.notFound('Booking not found');

    if (!INVOICEABLE_STATUSES.includes(booking.status as (typeof INVOICEABLE_STATUSES)[number])) {
      throw ApiError.conflict(
        `A ${booking.status.toLowerCase().replace(/_/g, ' ')} booking cannot be invoiced`,
      );
    }

    /*
     * A long-term rental is invoiced a month at a time.
     *
     * Its `totalAmount` is the whole term, which is a contract value, not a
     * supply. Issuing it as one document would declare six months of VAT in
     * one period and hand the customer nothing to reclaim against for five of
     * them - so this path refuses and points at the one that is correct.
     */
    if (booking.billingCycle === 'MONTHLY') {
      throw ApiError.conflict(
        'This is a monthly rental, so each month is invoiced on its own when it is paid. Issue the invoice for a month from the booking instead.',
      );
    }

    const existing = await prisma.invoice.findFirst({
      where: { bookingId, instalmentId: null, type: 'INVOICE', status: { not: 'CANCELLED' } },
    });
    if (existing) {
      throw ApiError.conflict(
        `This booking is already invoiced as ${existing.invoiceNumber}. Issue a credit note to correct it.`,
      );
    }

    const lines = buildLines(booking);
    const seller = await sellerSnapshot();

    const taxableAmount = sum(lines.filter((line) => line.isTaxable));
    const nonTaxable = sum(lines.filter((line) => !line.isTaxable));
    const subtotal = taxableAmount.add(nonTaxable);

    // The rate ACTUALLY charged on this booking, derived from its own price
    // snapshot rather than read live from settings. If VAT changed since the
    // customer booked, the invoice must state the rate they agreed to.
    const taxTotal = booking.taxAmount;
    const taxPercentage = derivePercentage(taxTotal, taxableAmount);

    const notes = await invoiceNotes(booking, nonTaxable);

    const invoice = await prisma.$transaction(async (tx) => {
      const created = await tx.invoice.create({
        data: {
          invoiceNumber: await nextDocumentNumber(tx, 'invoice'),
          type: 'INVOICE',
          status: 'ISSUED',
          bookingId: booking.id,
          customerId: booking.customerId,
          ...seller,
          customerName: booking.customer.fullName,
          customerEmail: booking.customer.email,
          customerPhone: booking.customer.phone,
          subtotal,
          discountTotal: booking.discountAmount,
          taxableAmount,
          taxPercentage,
          taxTotal,
          total: subtotal.add(taxTotal),
          currency: booking.currency,
          notes,
          issuedById: actor.id,
          lineItems: {
            create: lines.map((line, index) => ({
              sortOrder: index,
              description: line.description,
              detail: line.detail ?? null,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              lineTotal: line.lineTotal,
              isTaxable: line.isTaxable,
            })),
          },
        },
        include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
      });

      // Charges that were beyond the deposit are now billed. Charges already
      // taken from the deposit keep their SETTLED status - they appear on the
      // invoice as supplies, but the money has already moved.
      await tx.additionalCharge.updateMany({
        where: { bookingId: booking.id, status: 'PENDING' },
        data: { status: 'INVOICED' },
      });

      return created;
    });

    await auditService.record({
      action: 'invoice.issued',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'Invoice',
      entityId: invoice.id,
      metadata: {
        invoiceNumber: invoice.invoiceNumber,
        bookingNumber: booking.bookingNumber,
        total: invoice.total.toFixed(2),
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    fireAndForget(notify.invoiceIssued(invoice.id));

    return toPublicInvoice(invoice);
  },

  /**
   * Reverse an invoice with a credit note.
   *
   * Every line is copied and negated, so the pair sums to zero and the trail
   * shows what was corrected rather than hiding it. The original is marked
   * CANCELLED but stays exactly as issued.
   */
  async creditNote(invoiceId: string, reason: string, actor: InvoiceActor) {
    const original = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!original) throw ApiError.notFound('Invoice not found');

    if (original.type === 'CREDIT_NOTE') {
      throw ApiError.badRequest('A credit note cannot itself be credited');
    }
    if (original.status === 'CANCELLED') {
      throw ApiError.conflict('This invoice has already been credited');
    }
    if (!reason.trim()) {
      throw ApiError.badRequest('Give a reason for the credit note');
    }

    const note = await prisma.$transaction(async (tx) => {
      const created = await tx.invoice.create({
        data: {
          invoiceNumber: await nextDocumentNumber(tx, 'credit_note'),
          type: 'CREDIT_NOTE',
          status: 'ISSUED',
          bookingId: original.bookingId,
          customerId: original.customerId,
          // The ORIGINAL's snapshot, not today's settings. A credit note
          // corrects a specific document and must carry that document's
          // company and customer details.
          companyName: original.companyName,
          companyAddress: original.companyAddress,
          companyPhone: original.companyPhone,
          companyEmail: original.companyEmail,
          companyTrn: original.companyTrn,
          customerName: original.customerName,
          customerEmail: original.customerEmail,
          customerPhone: original.customerPhone,
          customerAddress: original.customerAddress,

          subtotal: original.subtotal.neg(),
          discountTotal: original.discountTotal.neg(),
          taxableAmount: original.taxableAmount.neg(),
          taxPercentage: original.taxPercentage,
          taxTotal: original.taxTotal.neg(),
          total: original.total.neg(),
          currency: original.currency,

          correctsId: original.id,
          reason: reason.trim(),
          issuedById: actor.id,

          lineItems: {
            create: original.lineItems.map((line) => ({
              sortOrder: line.sortOrder,
              description: line.description,
              detail: line.detail,
              quantity: line.quantity,
              unitPrice: line.unitPrice.neg(),
              lineTotal: line.lineTotal.neg(),
              isTaxable: line.isTaxable,
            })),
          },
        },
        include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
      });

      await tx.invoice.update({ where: { id: original.id }, data: { status: 'CANCELLED' } });

      return created;
    });

    await auditService.record({
      action: 'invoice.credited',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'Invoice',
      entityId: note.id,
      metadata: {
        creditNoteNumber: note.invoiceNumber,
        original: original.invoiceNumber,
        reason: reason.trim(),
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return toPublicInvoice(note);
  },

  /**
   * Fetch one invoice for a specific caller.
   *
   * A customer who is not the owner gets 404, not 403 - the same rule as
   * documents and bookings. Confirming that INV-2026-000042 exists is itself
   * a leak.
   */
  async getForActor(id: string, actor: InvoiceActor) {
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        lineItems: { orderBy: { sortOrder: 'asc' } },
        booking: { select: { bookingNumber: true, pickupAt: true, returnAt: true } },
      },
    });

    const backOffice = isBackOffice(actor.role);
    if (!invoice || (!backOffice && invoice.customerId !== actor.id)) {
      throw ApiError.notFound('Invoice not found');
    }

    return {
      ...toPublicInvoice(invoice),
      booking: {
        bookingNumber: invoice.booking.bookingNumber,
        pickupAt: invoice.booking.pickupAt.toISOString(),
        returnAt: invoice.booking.returnAt.toISOString(),
      },
    };
  },

  async list(query: {
    page: number;
    limit: number;
    customerId?: string;
    bookingId?: string;
    type?: 'INVOICE' | 'CREDIT_NOTE';
  }) {
    const where: Prisma.InvoiceWhereInput = {
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.bookingId ? { bookingId: query.bookingId } : {}),
      ...(query.type ? { type: query.type } : {}),
    };

    const [items, total] = await prisma.$transaction([
      prisma.invoice.findMany({
        where,
        include: {
          lineItems: { orderBy: { sortOrder: 'asc' } },
          booking: { select: { bookingNumber: true } },
        },
        orderBy: { issuedAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.invoice.count({ where }),
    ]);

    return {
      items: items.map((invoice) => ({
        ...toPublicInvoice(invoice),
        bookingNumber: invoice.booking.bookingNumber,
      })),
      total,
    };
  },
};

/** Turn a booking's stored figures into invoice lines. Pure. */
function buildLines(booking: {
  vehicle: { brand: string; model: string; year: number; registrationNumber: string };
  pickupAt: Date;
  returnAt: Date;
  rentalDays: number;
  vehicleSubtotal: Prisma.Decimal;
  deliveryFee: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  couponCode: string | null;
  pickupLocation: { name: string } | null;
  services: { name: string; quantity: number; unitPrice: Prisma.Decimal; lineTotal: Prisma.Decimal }[];
  additionalCharges: { type: string; status: string; description: string; amount: Prisma.Decimal }[];
}): DraftLine[] {
  const lines: DraftLine[] = [];

  lines.push({
    description: `${booking.vehicle.brand} ${booking.vehicle.model} (${booking.vehicle.year}) rental`,
    detail: `${booking.rentalDays} day(s), ${booking.pickupAt.toISOString().slice(0, 10)} to ${booking.returnAt
      .toISOString()
      .slice(0, 10)} - ${booking.vehicle.registrationNumber}`,
    quantity: new Prisma.Decimal(1),
    unitPrice: booking.vehicleSubtotal,
    lineTotal: booking.vehicleSubtotal,
    isTaxable: true,
  });

  for (const service of booking.services) {
    lines.push({
      description: service.name,
      quantity: new Prisma.Decimal(service.quantity),
      unitPrice: service.unitPrice,
      lineTotal: service.lineTotal,
      isTaxable: true,
    });
  }

  if (!booking.deliveryFee.isZero()) {
    lines.push({
      description: booking.pickupLocation
        ? `Delivery to ${booking.pickupLocation.name}`
        : 'Delivery charge',
      quantity: new Prisma.Decimal(1),
      unitPrice: booking.deliveryFee,
      lineTotal: booking.deliveryFee,
      isTaxable: true,
    });
  }

  if (!booking.discountAmount.isZero()) {
    lines.push({
      description: booking.couponCode ? `Discount (${booking.couponCode})` : 'Discount',
      quantity: new Prisma.Decimal(1),
      unitPrice: booking.discountAmount.neg(),
      lineTotal: booking.discountAmount.neg(),
      isTaxable: true,
    });
  }

  // Charges raised at return. WAIVED ones are excluded: writing a charge off
  // and then billing it would defeat the point of waiving it.
  for (const charge of booking.additionalCharges) {
    if (charge.status === 'WAIVED') continue;

    lines.push({
      description: charge.description,
      detail: charge.type.replace(/_/g, ' ').toLowerCase(),
      quantity: new Prisma.Decimal(1),
      unitPrice: charge.amount,
      lineTotal: charge.amount,
      // NOT taxed here. The booking's VAT was calculated on the agreed rental
      // (BRD 15); whether a late-return fee or a damage recharge is a taxable
      // supply is a question for the client's accountant, and adding 5% on a
      // guess would put an invented tax figure on a tax document.
      isTaxable: false,
    });
  }

  return lines;
}

function sum(lines: DraftLine[]): Prisma.Decimal {
  return lines.reduce((total, line) => total.add(line.lineTotal), ZERO);
}

/**
 * The rate as a percentage, back-calculated from what was actually charged.
 * Null when there is nothing to divide by, or no tax was applied.
 */
function derivePercentage(taxTotal: Prisma.Decimal, taxable: Prisma.Decimal): Prisma.Decimal | null {
  if (taxable.isZero() || taxTotal.isZero()) return null;
  return taxTotal.div(taxable).mul(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** Company details AT ISSUE TIME. Blank where the client has not supplied one. */
async function sellerSnapshot() {
  const [name, address, phone, email, trn] = await Promise.all([
    settingsService.getString(SettingKey.COMPANY_NAME),
    settingsService.getString(SettingKey.COMPANY_ADDRESS),
    settingsService.getString(SettingKey.COMPANY_PHONE),
    settingsService.getString(SettingKey.COMPANY_EMAIL),
    settingsService.getString(SettingKey.COMPANY_TRN),
  ]);

  return {
    companyName: name || null,
    companyAddress: address || null,
    companyPhone: phone || null,
    companyEmail: email || null,
    companyTrn: trn || null,
  };
}

/**
 * Notes printed on the invoice.
 *
 * The deposit gets a line here rather than in the totals: a refundable
 * security hold is not a supply of services, so taxing it or adding it to an
 * invoice total would both be wrong. The customer still needs to see it.
 */
async function invoiceNotes(
  booking: { securityDeposit: Prisma.Decimal; currency: string },
  nonTaxable: Prisma.Decimal,
): Promise<string> {
  const notes: string[] = [];

  if (!booking.securityDeposit.isZero()) {
    notes.push(
      `A refundable security deposit of ${booking.currency} ${booking.securityDeposit.toFixed(2)} is held separately and is not part of this invoice.`,
    );
  }

  if (!nonTaxable.isZero()) {
    notes.push(
      'Post-rental charges are shown at the amount charged. Their VAT treatment is pending confirmation and no tax has been added to them.',
    );
  }

  const trn = await settingsService.getString(SettingKey.COMPANY_TRN);
  if (!trn) {
    notes.push(
      'This document is not a valid UAE tax invoice: no Tax Registration Number is configured. Set company.trn in Settings.',
    );
  }

  return notes.join('\n');
}

export function toPublicInvoice(
  invoice: Invoice & { lineItems?: InvoiceLineItem[] },
) {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    type: invoice.type,
    status: invoice.status,
    bookingId: invoice.bookingId,
    customerId: invoice.customerId,
    company: {
      name: invoice.companyName,
      address: invoice.companyAddress,
      phone: invoice.companyPhone,
      email: invoice.companyEmail,
      trn: invoice.companyTrn,
    },
    customer: {
      name: invoice.customerName,
      email: invoice.customerEmail,
      phone: invoice.customerPhone,
      address: invoice.customerAddress,
    },
    subtotal: invoice.subtotal.toFixed(2),
    discountTotal: invoice.discountTotal.toFixed(2),
    taxableAmount: invoice.taxableAmount.toFixed(2),
    taxPercentage: invoice.taxPercentage?.toFixed(2) ?? null,
    taxTotal: invoice.taxTotal.toFixed(2),
    total: invoice.total.toFixed(2),
    currency: invoice.currency,
    correctsId: invoice.correctsId,
    reason: invoice.reason,
    notes: invoice.notes,
    issuedAt: invoice.issuedAt.toISOString(),
    lineItems: (invoice.lineItems ?? []).map((line) => ({
      description: line.description,
      detail: line.detail,
      quantity: line.quantity.toFixed(2),
      unitPrice: line.unitPrice.toFixed(2),
      lineTotal: line.lineTotal.toFixed(2),
      isTaxable: line.isTaxable,
    })),
  };
}
