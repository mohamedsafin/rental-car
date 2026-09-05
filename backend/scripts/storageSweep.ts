/**
 * scripts/storageSweep.ts
 * ---------------------------------------------------------------------------
 * Reports - and, with --delete, removes - files no database row points at.
 *
 * Run with:
 *   npm run storage:sweep --workspace backend              # report only
 *   npm run storage:sweep --workspace backend -- --delete  # actually remove
 *
 * A COMMAND rather than an endpoint, deliberately. Bulk-deleting files is
 * irreversible and needs a person who has read the report to decide; an HTTP
 * route for it would be one compromised admin session away from wiping every
 * identity document on file.
 */
import { orphanedFilesService } from '../src/modules/maintenance/orphanedFiles';
import { prisma } from '../src/config/prisma';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function main(): Promise<void> {
  const shouldDelete = process.argv.includes('--delete');
  const graceArg = process.argv.find((arg) => arg.startsWith('--grace-hours='));
  const graceHours = graceArg ? Number(graceArg.split('=')[1]) : 24;

  const report = await orphanedFilesService.find(graceHours);

  if (!report.supported) {
    console.log('\n  The configured storage provider cannot enumerate files, so nothing to sweep.\n');
    return;
  }

  console.log('\n  ---------------------------------------------------------------');
  console.log('   STORAGE SWEEP');
  console.log(`   ${report.totalFiles} files stored, ${report.referencedKeys} referenced by a row`);
  console.log(`   Grace period: ${graceHours}h (${report.skippedRecent} files too recent to judge)`);
  console.log('  ---------------------------------------------------------------\n');

  if (report.orphans.length === 0) {
    console.log('  No orphaned files. Nothing to do.\n');
    return;
  }

  const privateOrphans = report.orphans.filter((orphan) => orphan.isPrivate);

  console.log(`  ${report.orphans.length} orphaned files, ${formatBytes(report.reclaimableBytes)} reclaimable:\n`);
  for (const orphan of report.orphans.slice(0, 50)) {
    const marker = orphan.isPrivate ? 'PRIVATE' : 'public ';
    console.log(`    [${marker}] ${orphan.key}  ${formatBytes(orphan.sizeBytes)}  ${orphan.modifiedAt.slice(0, 10)}`);
  }
  if (report.orphans.length > 50) {
    console.log(`    ... and ${report.orphans.length - 50} more`);
  }

  if (privateOrphans.length > 0) {
    console.log(
      `\n  ${privateOrphans.length} of these are PRIVATE files - identity or vehicle documents`,
    );
    console.log('  that no record points at. Those are a data-retention issue, not just disk.');
  }

  if (!shouldDelete) {
    console.log('\n  Report only. Re-run with --delete to remove them.\n');
    return;
  }

  console.log('\n  Deleting...');
  const result = await orphanedFilesService.remove(graceHours);
  console.log(`  ${result.deleted} deleted, ${result.failed} failed.\n`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
