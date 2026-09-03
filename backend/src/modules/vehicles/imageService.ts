/**
 * modules/vehicles/imageService.ts
 * ---------------------------------------------------------------------------
 * Vehicle image handling (BRD 41 "upload, replace and delete vehicle images").
 *
 * Split from service.ts because image handling has genuinely different
 * concerns - bytes, storage keys, orphan cleanup - and bundling it would have
 * pushed the fleet service past the point where it reads as business rules.
 *
 * Two things worth understanding:
 *
 *  1. Magic-byte validation runs on EVERY file before anything is written. The
 *     declared MIME type is a client-supplied string; the file's leading bytes
 *     are not.
 *
 *  2. Storage and database can disagree. If the DB write fails after the file
 *     lands, we delete the uploaded file rather than leave an orphan nobody
 *     will ever find. The reverse - a row pointing at a missing file - is worse,
 *     because it breaks the page.
 */
import { prisma } from '../../config/prisma';
import { logger } from '../../config/logger';
import { ApiError } from '../../utils/ApiError';
import { assertRealImage } from '../../middleware/upload';
import { storage } from '../../services/storage';
import type { VehicleImageType } from '@prisma/client';

export const vehicleImageService = {
  /**
   * Store one or more uploaded images against a vehicle.
   *
   * The first image ever uploaded for a vehicle becomes primary automatically,
   * so a car is never listed with a blank thumbnail because someone forgot to
   * pick one.
   */
  async upload(
    vehicleId: string,
    files: Express.Multer.File[],
    type: VehicleImageType,
  ): Promise<void> {
    if (files.length === 0) throw ApiError.badRequest('No images were uploaded');

    const vehicle = await prisma.vehicle.findFirst({
      where: { id: vehicleId, deletedAt: null },
      select: { id: true, brand: true, model: true },
    });
    if (!vehicle) throw ApiError.notFound('Vehicle not found');

    // Validate everything BEFORE storing anything, so a bad third file does not
    // leave the first two written.
    files.forEach(assertRealImage);

    const existingCount = await prisma.vehicleImage.count({ where: { vehicleId } });

    for (const [index, file] of files.entries()) {
      const stored = await storage.upload({
        buffer: file.buffer,
        originalName: file.originalname,
        mimeType: file.mimetype,
        folder: `vehicles/${vehicleId}`,
        visibility: 'public',
      });

      try {
        await prisma.vehicleImage.create({
          data: {
            vehicleId,
            storageKey: stored.key,
            type,
            altText: `${vehicle.brand} ${vehicle.model}`,
            isPrimary: existingCount === 0 && index === 0,
            sortOrder: existingCount + index,
            sizeBytes: stored.sizeBytes,
            mimeType: stored.mimeType,
          },
        });
      } catch (error) {
        // The bytes are on disk but the row failed. Remove the file so we do
        // not accumulate uploads nothing references.
        await storage.delete(stored.key).catch((cleanupError: unknown) => {
          logger.error('Failed to clean up orphaned upload', {
            key: stored.key,
            error: String(cleanupError),
          });
        });
        throw error;
      }
    }
  },

  /** Promote one image to primary and demote the rest, atomically. */
  async setPrimary(vehicleId: string, imageId: string): Promise<void> {
    const image = await prisma.vehicleImage.findFirst({ where: { id: imageId, vehicleId } });
    if (!image) throw ApiError.notFound('Image not found for this vehicle');

    await prisma.$transaction([
      prisma.vehicleImage.updateMany({ where: { vehicleId }, data: { isPrimary: false } }),
      prisma.vehicleImage.update({ where: { id: imageId }, data: { isPrimary: true } }),
    ]);
  },

  /**
   * Delete an image from the database and from storage.
   *
   * If the deleted image was primary, another is promoted - otherwise the
   * vehicle would silently lose its thumbnail.
   */
  async remove(vehicleId: string, imageId: string): Promise<void> {
    const image = await prisma.vehicleImage.findFirst({ where: { id: imageId, vehicleId } });
    if (!image) throw ApiError.notFound('Image not found for this vehicle');

    await prisma.vehicleImage.delete({ where: { id: imageId } });

    // Storage failure must not undo the database change: from the user's point
    // of view the image IS gone. Log the stray file for later cleanup instead.
    await storage.delete(image.storageKey).catch((error: unknown) => {
      logger.error('Failed to delete file from storage', {
        key: image.storageKey,
        error: String(error),
      });
    });

    if (image.isPrimary) {
      const next = await prisma.vehicleImage.findFirst({
        where: { vehicleId },
        orderBy: { sortOrder: 'asc' },
      });
      if (next) {
        await prisma.vehicleImage.update({ where: { id: next.id }, data: { isPrimary: true } });
      }
    }
  },
};
