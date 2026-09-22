/**
 * modules/deposits/service.ts
 * ---------------------------------------------------------------------------
 * Security deposits (BRD 14 and 20).
 *
 * ===========================================================================
 * THE LEDGER
 * ===========================================================================
 * The outstanding balance is DERIVED by summing `deposit_transactions`. It is
 * never stored as a number someone can edit.
 *
 *     balance = sum(HOLD) - sum(DEDUCTION) - sum(RELEASE)
 *
 * Why it matters: when a customer says "you kept AED 500 of my deposit and I
 * do not know why", the answer has to be a list of dated, categorised,
 * attributed entries - not a single figure that was silently overwritten. An
 * append-only ledger cannot be quietly amended; a balance column can.
 *
 * Every deduction carries a category from BRD 20 (damage, fine, toll, fuel,
 * cleaning) and the id of whoever recorded it.
 */
import { Prisma } from '@prisma/client';
import type { DeductionCategory, Role } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { ApiError } from '../../utils/ApiError';
import { auditService } from '../audit/service';
import { fireAndForget, notify } from '../notifications/triggers';
import { settlementCheck } from '../fleet/settlementCheck';

const ZERO = new Prisma.Decimal(0);

export interface DepositActor {
  id: string;
  email: string;
  role: Role;
  ipAddress?: string;
  userAgent?: string;
}

export interface DepositSummary {
  id: string;
  bookingId: string;
  bookingNumber: string;
  currency: string;
  status: string;
  /** What was agreed on the booking. */
  amount: string;
  /** Sum of HOLD entries - what we actually took. */
  held: string;
  deducted: string;
  released: string;
  /** held - deducted - released. What is still ours to settle. */
  balance: string;
  heldAt: string | null;
  settledAt: string | null;
  transactions: {
    id: string;
    type: string;
    amount: string;
    category: string | null;
    reason: string | null;
    createdAt: string;
  }[];
}

/** Sum one type of ledger entry. Pure - no I/O, trivially testable. */
function total(
  transactions: { type: string; amount: Prisma.Decimal }[],
  type: string,
): Prisma.Decimal {
  return transactions
    .filter((entry) => entry.type === type)
    .reduce((sum, entry) => sum.add(entry.amount), ZERO);
}

export const depositsService = {
  async getByBookingId(bookingId: string): Promise<DepositSummary | null> {
    const deposit = await prisma.securityDeposit.findUnique({
      where: { bookingId },
      include: {
        booking: { select: { bookingNumber: true } },
        transactions: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!deposit) return null;

    const held = total(deposit.transactions, 'HOLD');
    const deducted = total(deposit.transactions, 'DEDUCTION');
    const released = total(deposit.transactions, 'RELEASE');

    return {
      id: deposit.id,
      bookingId: deposit.bookingId,
      bookingNumber: deposit.booking.bookingNumber,
      currency: deposit.currency,
      status: deposit.status,
      amount: deposit.amount.toFixed(2),
      held: held.toFixed(2),
      deducted: deducted.toFixed(2),
      released: released.toFixed(2),
      balance: held.sub(deducted).sub(released).toFixed(2),
      heldAt: deposit.heldAt?.toISOString() ?? null,
      settledAt: deposit.settledAt?.toISOString() ?? null,
      transactions: deposit.transactions.map((entry) => ({
        id: entry.id,
        type: entry.type,
        amount: entry.amount.toFixed(2),
        category: entry.category,
        reason: entry.reason,
        createdAt: entry.createdAt.toISOString(),
      })),
    };
  },

  /**
   * Deduct from a held deposit (BRD 20).
   *
   * A reason is REQUIRED. "We kept AED 500" with no explanation is exactly the
   * dispute this ledger exists to prevent.
   */
  async deduct(
    bookingId: string,
    input: { amount: string; category: DeductionCategory; reason: string },
    actor: DepositActor,
  ): Promise<DepositSummary> {
    const summary = await depositsService.getByBookingId(bookingId);
    if (!summary) throw ApiError.notFound('No security deposit exists for this booking');

    if (summary.status !== 'HELD' && summary.status !== 'PARTIALLY_RELEASED') {
      throw ApiError.conflict(
        summary.status === 'PENDING'
          ? 'The deposit has not been collected yet'
          : 'This deposit has already been settled',
      );
    }

    const amount = new Prisma.Decimal(input.amount);
    if (amount.lessThanOrEqualTo(0)) {
      throw ApiError.badRequest('The deduction must be greater than zero');
    }

    const balance = new Prisma.Decimal(summary.balance);
    if (amount.greaterThan(balance)) {
      // Charges beyond the deposit become a separate invoice (Phase 9/10),
      // never a negative deposit balance.
      throw ApiError.badRequest(
        `Only ${balance.toFixed(2)} ${summary.currency} remains on this deposit. Raise the excess as an additional charge instead.`,
      );
    }

    if (!input.reason.trim()) {
      throw ApiError.badRequest('Give a reason for the deduction');
    }

    await prisma.depositTransaction.create({
      data: {
        depositId: summary.id,
        type: 'DEDUCTION',
        amount,
        category: input.category,
        reason: input.reason.trim(),
        createdById: actor.id,
      },
    });

    await auditService.record({
      action: 'deposit.deducted',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'SecurityDeposit',
      entityId: summary.id,
      metadata: {
        bookingNumber: summary.bookingNumber,
        amount: amount.toFixed(2),
        category: input.category,
        reason: input.reason.trim(),
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    const updated = (await depositsService.getByBookingId(bookingId))!;

    /*
     * Tell the customer their deposit just went down, and why.
     *
     * Detached: the money has already moved and a mail server being unreachable
     * must not undo a recorded deduction. Silence here is what turns a correct
     * charge into a dispute - they discover it when the refund is short.
     */
    fireAndForget(
      notify.depositDeducted(bookingId, {
        amount: amount.toFixed(2),
        category: input.category,
        reason: input.reason,
        balance: updated.balance,
        currency: updated.currency,
      }),
    );

    return updated;
  },

  /**
   * Return what is left of the deposit to the customer.
   *
   * The RELEASE entry records the decision and closes the deposit. The money
   * itself moves through the refund flow against the deposit payment - two
   * records, because "we decided to release it" and "the provider sent it" are
   * genuinely different events and can be days apart.
   */
  async release(
    bookingId: string,
    input: { amount?: string; reason?: string; releaseAnyway?: boolean },
    actor: DepositActor,
  ): Promise<DepositSummary> {
    const summary = await depositsService.getByBookingId(bookingId);
    if (!summary) throw ApiError.notFound('No security deposit exists for this booking');

    if (summary.status !== 'HELD' && summary.status !== 'PARTIALLY_RELEASED') {
      throw ApiError.conflict('This deposit is not currently held');
    }

    /*
     * ===========================================================================
     * THE LAST MOMENT THE MONEY IS STILL COLLECTABLE
     * ===========================================================================
     * The counter screen already shows what is outstanding before the deposit
     * goes back - but showing is not enforcing. Anyone can release the deposit
     * from a list page, a second tab, or a direct API call, and once it is
     * back in the customer's account an unpaid Salik crossing is the company's
     * loss: nobody chases AED 24 across a border.
     *
     * So the refusal lives HERE, where every path to a release passes through,
     * and it names the figure rather than saying "not allowed". Staff who have
     * a reason to release anyway can, deliberately, with `releaseAnyway` - and
     * that decision is recorded on the transaction and in the audit trail
     * instead of being invisible.
     */
    const settlement = await settlementCheck.forBooking(bookingId);
    const outstanding = new Prisma.Decimal(settlement.outstandingTotal);

    if (outstanding.greaterThan(0) && !input.releaseAnyway) {
      throw ApiError.conflict(
        `${settlement.currency} ${outstanding.toFixed(2)} is still outstanding on this booking ` +
          `(${settlement.outstanding.length} item(s) - fines or tolls not yet recovered). ` +
          'Recover it from the deposit first, or release anyway if you have decided to write it off.',
      );
    }

    const overridden = outstanding.greaterThan(0) && input.releaseAnyway === true;

    const balance = new Prisma.Decimal(summary.balance);
    const amount = input.amount ? new Prisma.Decimal(input.amount) : balance;

    if (amount.lessThanOrEqualTo(0)) {
      throw ApiError.badRequest('There is nothing left to release on this deposit');
    }
    if (amount.greaterThan(balance)) {
      throw ApiError.badRequest(
        `Only ${balance.toFixed(2)} ${summary.currency} remains on this deposit`,
      );
    }

    const remainingAfter = balance.sub(amount);
    const held = new Prisma.Decimal(summary.held);
    const deducted = new Prisma.Decimal(summary.deducted);

    await prisma.$transaction(async (tx) => {
      await tx.depositTransaction.create({
        data: {
          depositId: summary.id,
          type: 'RELEASE',
          amount,
          reason:
            (input.reason?.trim() || 'Deposit returned to customer') +
            (overridden
              ? ` (released with ${settlement.currency} ${outstanding.toFixed(2)} still outstanding)`
              : ''),
          createdById: actor.id,
        },
      });

      await tx.securityDeposit.update({
        where: { id: summary.id },
        data: {
          // FORFEITED only when deductions consumed the whole deposit and
          // nothing went back. Otherwise it was released, in full or in part.
          status: remainingAfter.isZero()
            ? deducted.equals(held)
              ? 'FORFEITED'
              : 'RELEASED'
            : 'PARTIALLY_RELEASED',
          settledAt: remainingAfter.isZero() ? new Date() : null,
        },
      });
    });

    await auditService.record({
      action: 'deposit.released',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'SecurityDeposit',
      entityId: summary.id,
      metadata: {
        bookingNumber: summary.bookingNumber,
        amount: amount.toFixed(2),
        remaining: remainingAfter.toFixed(2),
        // Present only when somebody chose to release over the refusal. The
        // question "who let this go?" then has an answer.
        ...(overridden
          ? { releasedOverOutstanding: outstanding.toFixed(2), items: settlement.outstanding.length }
          : {}),
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    const settled = (await depositsService.getByBookingId(bookingId))!;

    // The counterpart message. Its template has existed all along with nothing
    // sending it, so a customer heard nothing when their money went back.
    fireAndForget(
      notify.depositReleased(bookingId, {
        amount: amount.toFixed(2),
        currency: settled.currency,
      }),
    );

    return settled;
  },

  /** Deposits needing attention (BRD 27 admin "Deposits"). */
  async list(query: { page: number; limit: number; status?: string }) {
    const where = query.status ? { status: query.status as never } : {};

    const [items, count] = await prisma.$transaction([
      prisma.securityDeposit.findMany({
        where,
        include: {
          booking: { select: { bookingNumber: true, customer: { select: { fullName: true } } } },
          transactions: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.securityDeposit.count({ where }),
    ]);

    return {
      items: items.map((deposit) => {
        const held = total(deposit.transactions, 'HOLD');
        const deducted = total(deposit.transactions, 'DEDUCTION');
        const released = total(deposit.transactions, 'RELEASE');

        return {
          id: deposit.id,
          bookingId: deposit.bookingId,
          bookingNumber: deposit.booking.bookingNumber,
          customerName: deposit.booking.customer.fullName,
          currency: deposit.currency,
          status: deposit.status,
          amount: deposit.amount.toFixed(2),
          held: held.toFixed(2),
          deducted: deducted.toFixed(2),
          balance: held.sub(deducted).sub(released).toFixed(2),
        };
      }),
      total: count,
    };
  },
};
