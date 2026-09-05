/**
 * modules/maintenance/orphanedFiles.ts
 * ---------------------------------------------------------------------------
 * Finds files on the storage provider that no database row points at.
 *
 * This closes a gap that was deliberately deferred from Phase 5. Uploads are
 * cleaned up when the row that would have referenced them fails to save, but
 * files can still be stranded by:
 *
 *  - a cascade delete (removing a customer takes their document ROWS, not the
 *    bytes on disk),
 *  - a process killed between writing a file and committing its row,
 *  - a provider delete that failed and was logged rather than retried.
 *
 * For vehicle photos that is wasted disk. For an Emirates ID or a passport
 * scan it is a data-retention problem: a customer who asks to be forgotten is
 * not forgotten while their passport is still sitting in `private/`.
 *
 * Two safety rules, because deleting files is not reversible:
 *
 *  1. A GRACE PERIOD. A file younger than the cutoff is never touched - it may
 *     belong to an upload whose row is committing right now, and a sweep that
 *     races an upload would delete a live document.
 *  2. Reporting is the default. Deleting requires an explicit flag, so the
 *     first thing anyone runs is the one that cannot do damage.
 */
import { prisma } from '../../config/prisma';
import { logger } from '../../config/logger';
import { storage } from '../../services/storage';

export interface OrphanReport {
  supported: boolean;
  totalFiles: number;
  referencedKeys: number;
  /** Old enough to be judged, and referenced by nothing. */
  orphans: { key: string; sizeBytes: number; modifiedAt: string; isPrivate: boolean }[];
  /** Too recent to judge - an upload may still be committing its row. */
  skippedRecent: number;
  reclaimableBytes: number;
}

/**
 * Every storage key the database currently points at.
 *
 * Every table holding a key must appear here. Missing one would report live
 * files as orphans, and with `--delete` that means deleting real documents -
 * which is why the list is explicit rather than inferred.
 */
async function referencedKeys(): Promise<Set<string>> {
  const [vehicleImages, customerDocuments, inspectionPhotos, damagePhotos, vehicleDocuments] =
    await Promise.all([
      prisma.vehicleImage.findMany({ select: { storageKey: true } }),
      prisma.customerDocument.findMany({ select: { storageKey: true } }),
      prisma.inspectionPhoto.findMany({ select: { storageKey: true } }),
      prisma.damagePhoto.findMany({ select: { storageKey: true } }),
      prisma.vehicleDocument.findMany({ select: { storageKey: true } }),
    ]);

  const keys = new Set<string>();
  for (const rows of [vehicleImages, customerDocuments, inspectionPhotos, damagePhotos, vehicleDocuments]) {
    for (const row of rows) keys.add(row.storageKey);
  }

  return keys;
}

export const orphanedFilesService = {
  /**
   * Report only. Never deletes.
   *
   * @param graceHours files newer than this are left alone.
   */
  async find(graceHours = 24): Promise<OrphanReport> {
    if (!storage.list) {
      // S3 and Cloudinary can enumerate, but a provider is not required to,
      // and guessing is worse than saying so.
      return {
        supported: false,
        totalFiles: 0,
        referencedKeys: 0,
        orphans: [],
        skippedRecent: 0,
        reclaimableBytes: 0,
      };
    }

    const cutoff = new Date(Date.now() - graceHours * 60 * 60 * 1000);

    const [files, referenced] = await Promise.all([storage.list(), referencedKeys()]);

    let skippedRecent = 0;
    const orphans: OrphanReport['orphans'] = [];

    for (const file of files) {
      if (referenced.has(file.key)) continue;

      if (file.modifiedAt > cutoff) {
        // Possibly an upload whose row is committing right now.
        skippedRecent += 1;
        continue;
      }

      orphans.push({
        key: file.key,
        sizeBytes: file.sizeBytes,
        modifiedAt: file.modifiedAt.toISOString(),
        isPrivate: file.key.startsWith('private/'),
      });
    }

    // Private orphans first: an abandoned passport scan matters more than an
    // abandoned thumbnail, and whoever reads this report should see it first.
    orphans.sort((a, b) => Number(b.isPrivate) - Number(a.isPrivate) || a.key.localeCompare(b.key));

    return {
      supported: true,
      totalFiles: files.length,
      referencedKeys: referenced.size,
      orphans,
      skippedRecent,
      reclaimableBytes: orphans.reduce((total, orphan) => total + orphan.sizeBytes, 0),
    };
  },

  /**
   * Delete what `find()` reported.
   *
   * Re-runs the scan rather than accepting a caller's list, so there is no
   * window between deciding and deleting in which a file could become
   * referenced again.
   */
  async remove(graceHours = 24): Promise<{ deleted: number; failed: number }> {
    const report = await this.find(graceHours);
    let deleted = 0;
    let failed = 0;

    for (const orphan of report.orphans) {
      try {
        await storage.delete(orphan.key);
        deleted += 1;
        logger.info('Deleted orphaned file', { key: orphan.key, isPrivate: orphan.isPrivate });
      } catch (error) {
        failed += 1;
        logger.warn('Could not delete orphaned file', {
          key: orphan.key,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { deleted, failed };
  },
};
