/**
 * modules/rentals/photoService.ts
 * ---------------------------------------------------------------------------
 * Inspection photographs (BRD 25).
 *
 * These go to PUBLIC storage, unlike customer documents. They are pictures of
 * a car, not of anybody's passport, and staff need to pull them up quickly on
 * a phone at the counter. The `visibility` argument makes that a deliberate
 * choice rather than an accident of which folder was handy.
 */
import { prisma } from '../../config/prisma';
import { logger } from '../../config/logger';
import { ApiError } from '../../utils/ApiError';
import { assertRealImage } from '../../middleware/upload';
import { storage } from '../../services/storage';
import { auditService } from '../audit/service';
import { rentalsService, type RentalActor } from './service';

export const inspectionPhotoService = {
  async upload(
    inspectionId: string,
    files: Express.Multer.File[],
    type: string,
    actor: RentalActor,
  ) {
    const inspection = await prisma.vehicleInspection.findUnique({
      where: { id: inspectionId },
      include: { rental: { select: { id: true, bookingId: true } } },
    });
    if (!inspection) throw ApiError.notFound('Inspection not found');

    // Validate everything before storing anything, so a bad third file does
    // not leave the first two written.
    files.forEach(assertRealImage);

    for (const file of files) {
      const stored = await storage.upload({
        buffer: file.buffer,
        originalName: file.originalname,
        mimeType: file.mimetype,
        folder: `inspections/${inspectionId}`,
        visibility: 'public',
      });

      try {
        await prisma.inspectionPhoto.create({
          data: {
            inspectionId,
            type: type as never,
            storageKey: stored.key,
            sizeBytes: stored.sizeBytes,
            mimeType: stored.mimeType,
          },
        });
      } catch (error) {
        // Remove the file rather than leave an upload nothing references.
        await storage.delete(stored.key).catch((cleanupError: unknown) => {
          logger.error('Failed to clean up orphaned inspection photo', {
            key: stored.key,
            error: String(cleanupError),
          });
        });
        throw error;
      }
    }

    await auditService.record({
      action: 'inspection.photos_added',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'VehicleInspection',
      entityId: inspectionId,
      metadata: { count: files.length, type },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return rentalsService.getByBookingId(inspection.rental.bookingId);
  },
};
