/**
 * scripts/repairFilenames.ts
 * ---------------------------------------------------------------------------
 * Repairs filenames stored before the multipart decoding fix.
 *
 *   npm run repair:filenames --workspace backend              # report
 *   npm run repair:filenames --workspace backend -- --apply   # write
 *
 * Multer hands over multipart filenames decoded as latin1, and those bytes
 * were stored as-is. A file called `வீடு வாடகைக்கு.pdf` became
 * `à®µà¯...` in the database - wrong on the customer's screen, wrong in the
 * admin, and wrong in the Content-Disposition header when the file is served.
 *
 * The damage is reversible: latin1 is a byte-for-byte mapping, so nothing was
 * lost. Re-encoding and decoding as UTF-8 recovers the original exactly.
 *
 * Reports by default. Only touches rows where the round trip actually produces
 * something different and valid - a row that is already correct is left alone,
 * so this is safe to run twice.
 */
import { prisma } from '../src/config/prisma';
import { decodeUploadFilename } from '../src/middleware/upload';

interface Repair {
  table: string;
  id: string;
  from: string;
  to: string;
}

async function collect(): Promise<Repair[]> {
  const [customerDocs, vehicleDocs] = await Promise.all([
    prisma.customerDocument.findMany({ select: { id: true, fileName: true } }),
    prisma.vehicleDocument.findMany({ select: { id: true, fileName: true } }),
  ]);

  const repairs: Repair[] = [];

  for (const [table, rows] of [
    ['customer_documents', customerDocs],
    ['vehicle_documents', vehicleDocs],
  ] as const) {
    for (const row of rows) {
      const fixed = decodeUploadFilename(row.fileName);
      if (fixed !== row.fileName) {
        repairs.push({ table, id: row.id, from: row.fileName, to: fixed });
      }
    }
  }

  return repairs;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const repairs = await collect();

  if (repairs.length === 0) {
    console.log('\n  No mangled filenames found. Nothing to repair.\n');
    return;
  }

  console.log(`\n  ${repairs.length} filename(s) to repair:\n`);
  for (const repair of repairs) {
    console.log(`    ${repair.table}`);
    console.log(`      before: ${repair.from}`);
    console.log(`      after:  ${repair.to}\n`);
  }

  if (!apply) {
    console.log('  Report only. Re-run with --apply to write these.\n');
    return;
  }

  for (const repair of repairs) {
    if (repair.table === 'customer_documents') {
      await prisma.customerDocument.update({
        where: { id: repair.id },
        data: { fileName: repair.to },
      });
    } else {
      await prisma.vehicleDocument.update({
        where: { id: repair.id },
        data: { fileName: repair.to },
      });
    }
  }

  console.log(`  ${repairs.length} filename(s) repaired.\n`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
