/**
 * modules/fleet/statementImport.ts
 * ---------------------------------------------------------------------------
 * Turns a parsed statement into recorded, attributed charges - Salik crossings
 * or traffic fines.
 *
 * ===========================================================================
 * ONE ENGINE, TWO KINDS
 * ===========================================================================
 * Everything that is hard here is identical for both: matching a plate written
 * five different ways, deciding who had the car at that moment, refusing to
 * bill a closed rental, and never importing the same charge twice. Only two
 * things differ - what makes a row UNIQUE, and which table it lands in.
 *
 * So the difference is a parameter, not a second file. A fines importer copied
 * from this one would drift from it within a month, and the half that drifted
 * would be the duplicate checking.
 *
 * ===========================================================================
 * PREVIEW, THEN COMMIT
 * ===========================================================================
 * Nothing is written until someone has seen what would be. An import touches
 * hundreds of rows and charges real customers real money, and the failure mode
 * of getting it wrong - a column misread, the wrong month's file - is dozens
 * of people billed for journeys they did not make.
 *
 * So the same work runs twice: `preview` reports exactly what it would do, and
 * `commit` does it. They share one function so the preview cannot drift from
 * the thing it is previewing, which is the usual way a "dry run" becomes a
 * lie.
 *
 * ===========================================================================
 * WHAT IT DECIDES PER ROW
 * ===========================================================================
 *   unknown vehicle  - the plate is not in the fleet. Skipped, reported.
 *   duplicate        - already recorded. Skipped, so re-uploading a file, or
 *                      uploading an overlapping month, is safe.
 *   unattached       - nobody had the car then. Recorded; it is the company's.
 *   written off      - small, and on a SHORT rental. Recorded as WAIVED.
 *   billable         - matched to a rental, ready to recover.
 */
import { Prisma } from '@prisma/client';
import type { ChargeRecoveryStatus } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { auditService } from '../audit/service';
import { SettingKey, settingsService } from '../settings/service';
import { parseStatement, type ParseProblem } from './statementParser';
import type { FleetActor } from '../damages/service';

/** Which kind of charge a file contains. */
export type ChargeKind = 'toll' | 'fine';

export type RowOutcome =
  | 'billable'
  | 'unattached'
  | 'written_off'
  | 'duplicate'
  | 'unknown_vehicle';

export interface PreparedRow {
  line: number;
  plate: string;
  crossedAt: string;
  gate: string | null;
  /** The fine number. Null on a Salik row, which has no such thing. */
  reference: string | null;
  violation: string | null;
  amount: string;
  serviceFee: string;
  total: string;
  outcome: RowOutcome;
  vehicleId: string | null;
  vehicleName: string | null;
  bookingId: string | null;
  bookingNumber: string | null;
  customerName: string | null;
}

export interface ImportSummary {
  rows: PreparedRow[];
  problems: ParseProblem[];
  counts: Record<RowOutcome, number>;
  /** What would actually be charged to customers, fees included. */
  billableTotal: string;
  writtenOffTotal: string;
  currency: string;
}

/**
 * Work out what each row means, without writing anything.
 *
 * Deliberately sequential rather than parallel: rows within one file can be
 * duplicates OF EACH OTHER, and a batch of concurrent lookups would each find
 * no existing row and all insert. The files are a few hundred lines; clarity
 * is worth more than the milliseconds.
 */
async function prepare(text: string, kind: ChargeKind): Promise<ImportSummary> {
  const { rows, problems } = parseStatement(text);

  const serviceFeeSetting = await settingsService.getNumber(
    kind === 'fine' ? SettingKey.FINE_SERVICE_FEE : SettingKey.TOLL_SERVICE_FEE,
  );
  const serviceFee = new Prisma.Decimal(serviceFeeSetting ?? 0);
  /*
   * Only Salik is ever written off automatically.
   *
   * The threshold exists because chasing four dirhams costs more than four
   * dirhams. A traffic fine is never that small, and writing one off silently
   * would be writing off a penalty the company is liable for.
   */
  const writeOffBelow =
    kind === 'toll'
      ? await settingsService.getNumber(SettingKey.TOLL_AUTO_WRITE_OFF_BELOW)
      : null;
  const currency = (await settingsService.getString(SettingKey.CURRENCY)) ?? 'AED';

  const prepared: PreparedRow[] = [];
  const counts: Record<RowOutcome, number> = {
    billable: 0,
    unattached: 0,
    written_off: 0,
    duplicate: 0,
    unknown_vehicle: 0,
  };

  let billableTotal = new Prisma.Decimal(0);
  let writtenOffTotal = new Prisma.Decimal(0);

  // Plates are matched case- and space-insensitively: statements write
  // "DEMO D40001", "demo-d40001" and "DEMOD40001" for one car.
  const fleet = await prisma.vehicle.findMany({
    where: { deletedAt: null },
    select: { id: true, registrationNumber: true, brand: true, model: true },
  });
  const key = (plate: string) => plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const byPlate = new Map(fleet.map((vehicle) => [key(vehicle.registrationNumber), vehicle]));

  // Rows already accepted in THIS file, so a statement containing the same
  // charge twice does not import it twice.
  const seenInFile = new Set<string>();

  /*
   * What makes a fine unique is its NUMBER, which is stamped by the authority
   * and is the same on every export. A crossing has no such identifier, so it
   * is identified by the only thing that can never repeat: one car cannot pass
   * one gate twice in the same instant.
   */
  const fingerprintOf = (vehicleId: string, row: (typeof rows)[number]): string =>
    kind === 'fine'
      ? `fine|${(row.reference ?? '').trim().toUpperCase()}`
      : `${vehicleId}|${row.crossedAt.toISOString()}|${row.gate ?? ''}`;

  for (const row of rows) {
    const vehicle = byPlate.get(key(row.plate));
    const amount = new Prisma.Decimal(row.amount);
    const total = amount.add(serviceFee);

    const base = {
      line: row.line,
      plate: row.plate,
      crossedAt: row.crossedAt.toISOString(),
      gate: row.gate,
      reference: row.reference,
      violation: row.violation,
      amount: amount.toFixed(2),
      serviceFee: serviceFee.toFixed(2),
      total: total.toFixed(2),
      vehicleId: vehicle?.id ?? null,
      vehicleName: vehicle ? `${vehicle.brand} ${vehicle.model}` : null,
      bookingId: null as string | null,
      bookingNumber: null as string | null,
      customerName: null as string | null,
    };

    if (!vehicle) {
      counts.unknown_vehicle += 1;
      prepared.push({ ...base, outcome: 'unknown_vehicle' });
      continue;
    }

    const fingerprint = fingerprintOf(vehicle.id, row);

    /*
     * A fine with no number cannot be de-duplicated at all, and re-importing
     * the file would bill the customer twice. Refused rather than guessed at.
     */
    if (kind === 'fine' && !row.reference?.trim()) {
      problems.push({
        line: row.line,
        reason:
          'No fine number on this row. Without it the same fine cannot be told apart from a re-upload, so it is skipped.',
        raw: row.plate,
      });
      continue;
    }

    const alreadyInDatabase =
      kind === 'fine'
        ? await prisma.trafficFine.findUnique({
            where: { fineNumber: row.reference!.trim() },
            select: { id: true },
          })
        : await prisma.tollCharge.findFirst({
            where: { vehicleId: vehicle.id, crossedAt: row.crossedAt, gate: row.gate ?? null },
            select: { id: true },
          });

    if (alreadyInDatabase || seenInFile.has(fingerprint)) {
      counts.duplicate += 1;
      prepared.push({ ...base, outcome: 'duplicate' });
      continue;
    }
    seenInFile.add(fingerprint);

    const booking = await prisma.booking.findFirst({
      where: {
        vehicleId: vehicle.id,
        pickupAt: { lte: row.crossedAt },
        returnAt: { gte: row.crossedAt },
        /*
         * Open rentals only. A completed rental is closed: the customer has
         * settled, the deposit has gone back, and the car is out with somebody
         * else. A crossing that lands on one is the company's - which is what
         * `unattached` means, and it is reported honestly rather than billed
         * to a customer who has finished with us.
         */
        status: { in: ['ACTIVE', 'EXTENSION_REQUESTED', 'RETURN_PENDING', 'RETURNED'] },
      },
      select: {
        id: true,
        bookingNumber: true,
        billingCycle: true,
        customer: { select: { fullName: true } },
      },
    });

    if (!booking) {
      counts.unattached += 1;
      prepared.push({ ...base, outcome: 'unattached' });
      continue;
    }

    const matched = {
      ...base,
      bookingId: booking.id,
      bookingNumber: booking.bookingNumber,
      customerName: booking.customer.fullName,
    };

    /*
     * Small, and on a short rental: not worth chasing.
     *
     * Monthly rentals are exempt on purpose. There the charge rides on an
     * invoice the customer is already paying, so collecting it costs nothing -
     * writing it off would simply be giving money away every month.
     */
    const tooSmallToChase =
      writeOffBelow !== null &&
      booking.billingCycle !== 'MONTHLY' &&
      total.lessThan(new Prisma.Decimal(writeOffBelow));

    if (tooSmallToChase) {
      counts.written_off += 1;
      writtenOffTotal = writtenOffTotal.add(total);
      prepared.push({ ...matched, outcome: 'written_off' });
      continue;
    }

    counts.billable += 1;
    billableTotal = billableTotal.add(total);
    prepared.push({ ...matched, outcome: 'billable' });
  }

  return {
    rows: prepared,
    problems,
    counts,
    billableTotal: billableTotal.toFixed(2),
    writtenOffTotal: writtenOffTotal.toFixed(2),
    currency,
  };
}

export const statementImport = {
  /** What WOULD happen. Writes nothing. */
  async preview(text: string, kind: ChargeKind = 'toll'): Promise<ImportSummary> {
    return prepare(text, kind);
  },

  /**
   * Do it.
   *
   * Re-prepares from the text rather than trusting a preview sent back by the
   * browser: the fleet, the bookings and the settings can all have moved since
   * the preview was drawn, and a client-supplied list of what to charge is a
   * client-supplied list of what to charge.
   */
  async commit(
    text: string,
    actor: FleetActor,
    kind: ChargeKind = 'toll',
  ): Promise<ImportSummary & { imported: number }> {
    const summary = await prepare(text, kind);

    const toWrite = summary.rows.filter(
      (row) => row.outcome === 'billable' || row.outcome === 'unattached' || row.outcome === 'written_off',
    );

    if (toWrite.length > 0) {
      /*
       * Annotated, not asserted.
       *
       * Without a declared return type the ternary widens to `string` and
       * Prisma rejects it; an inline `as` cast reads as unnecessary to the
       * linter, which removes it, which breaks the build. Naming the type
       * once is the version that survives both.
       */
      const statusOf = (row: PreparedRow): ChargeRecoveryStatus =>
        row.outcome === 'written_off' ? 'WAIVED' : row.bookingId ? 'ASSIGNED' : 'RECORDED';

      const common = (row: PreparedRow) => ({
        vehicleId: row.vehicleId!,
        bookingId: row.bookingId,
        amount: new Prisma.Decimal(row.amount),
        serviceFee: new Prisma.Decimal(row.serviceFee),
        currency: summary.currency,
        status: statusOf(row),
        notes:
          row.outcome === 'written_off'
            ? 'Written off automatically: below the threshold for a short rental.'
            : null,
        recordedById: actor.id,
      });

      if (kind === 'fine') {
        /*
         * `createMany` with skipDuplicates rather than a plain insert: the
         * fine number is unique in the database, and a file that slipped past
         * the in-memory check - two uploads racing, say - must be absorbed
         * rather than fail the whole import at row 300.
         */
        await prisma.trafficFine.createMany({
          data: toWrite.map((row) => ({
            ...common(row),
            fineNumber: row.reference!.trim(),
            violationAt: new Date(row.crossedAt),
            violation: row.violation,
            location: row.gate,
          })),
          skipDuplicates: true,
        });
      } else {
        await prisma.tollCharge.createMany({
          data: toWrite.map((row) => ({
            ...common(row),
            crossedAt: new Date(row.crossedAt),
            gate: row.gate,
            reference: row.reference,
          })),
        });
      }
    }

    await auditService.record({
      action: kind === 'fine' ? 'fine.statement_imported' : 'toll.statement_imported',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: kind === 'fine' ? 'TrafficFine' : 'TollCharge',
      entityId: 'bulk',
      metadata: {
        imported: toWrite.length,
        ...summary.counts,
        billableTotal: summary.billableTotal,
        problems: summary.problems.length,
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return { ...summary, imported: toWrite.length };
  },
};
