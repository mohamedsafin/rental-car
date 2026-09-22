/**
 * modules/damages/service.ts
 * ---------------------------------------------------------------------------
 * Damage assessment (BRD 27).
 *
 * Damage is NOT just a charge with photos. It has a life of its own:
 *
 *   REPORTED  - "there is a scratch on the rear bumper"
 *   ASSESSED  - "the bodyshop quotes AED 500"
 *   APPROVED  - "we will charge AED 400 of that"   <- a decision, by a person
 *   DISMISSED - "that is fair wear and tear"
 *   CHARGED   - the approved amount became money
 *
 * Collapsing this into a single amount would lose the middle - which is
 * exactly the part that gets argued about. Charging uses the APPROVED amount,
 * never the estimate, so a bodyshop quote can never become a customer's bill
 * without someone signing it off.
 */
import { Prisma } from '@prisma/client';
import type { DamageStatus, DamageType, Role } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { logger } from '../../config/logger';
import { ApiError } from '../../utils/ApiError';
import { assertRealImage } from '../../middleware/upload';
import { storage } from '../../services/storage';
import { auditService } from '../audit/service';

export interface FleetActor {
  id: string;
  email: string;
  role: Role;
  ipAddress?: string;
  userAgent?: string;
}

function toPublicDamage(damage: {
  id: string;
  vehicleId: string;
  bookingId: string | null;
  type: DamageType;
  status: DamageStatus;
  description: string;
  location: string | null;
  estimatedAmount: Prisma.Decimal | null;
  approvedAmount: Prisma.Decimal | null;
  currency: string;
  assessmentNotes: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  photos?: { id: string; storageKey: string; caption: string | null }[];
}) {
  return {
    id: damage.id,
    vehicleId: damage.vehicleId,
    bookingId: damage.bookingId,
    type: damage.type,
    status: damage.status,
    description: damage.description,
    location: damage.location,
    estimatedAmount: damage.estimatedAmount?.toFixed(2) ?? null,
    approvedAmount: damage.approvedAmount?.toFixed(2) ?? null,
    currency: damage.currency,
    assessmentNotes: damage.assessmentNotes,
    approvedAt: damage.approvedAt?.toISOString() ?? null,
    createdAt: damage.createdAt.toISOString(),
    photos: (damage.photos ?? []).map((photo) => ({
      id: photo.id,
      caption: photo.caption,
      // Public: a photograph of a dented bumper is not sensitive.
      url: `/uploads/${photo.storageKey.replace(/^public\//, '')}`,
    })),
  };
}

export const damagesService = {
  async report(
    input: {
      vehicleId: string;
      bookingId?: string;
      type: DamageType;
      description: string;
      location?: string;
      estimatedAmount?: string;
    },
    actor: FleetActor,
  ) {
    const vehicle = await prisma.vehicle.findFirst({
      where: { id: input.vehicleId, deletedAt: null },
    });
    if (!vehicle) throw ApiError.notFound('Vehicle not found');

    const damage = await prisma.damage.create({
      data: {
        vehicleId: input.vehicleId,
        bookingId: input.bookingId ?? null,
        type: input.type,
        description: input.description,
        location: input.location ?? null,
        estimatedAmount: input.estimatedAmount ? new Prisma.Decimal(input.estimatedAmount) : null,
        // An estimate at reporting time moves it straight to ASSESSED; without
        // one it sits at REPORTED until somebody costs it.
        status: input.estimatedAmount ? 'ASSESSED' : 'REPORTED',
        reportedById: actor.id,
      },
      include: { photos: true },
    });

    await auditService.record({
      action: 'damage.reported',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'Damage',
      entityId: damage.id,
      metadata: { vehicleId: input.vehicleId, type: input.type, bookingId: input.bookingId },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return toPublicDamage(damage);
  },

  /**
   * Approve or dismiss (admin).
   *
   * Approving REQUIRES an amount, and it may differ from the estimate -
   * negotiating a bodyshop quote down is normal. Dismissing requires a reason,
   * because "we decided not to charge you" should be explainable months later.
   */
  async assess(
    damageId: string,
    decision: { approve: boolean; approvedAmount?: string; notes?: string },
    actor: FleetActor,
  ) {
    const damage = await prisma.damage.findUnique({ where: { id: damageId } });
    if (!damage) throw ApiError.notFound('Damage record not found');

    if (damage.status === 'CHARGED') {
      throw ApiError.conflict('This damage has already been charged');
    }

    if (decision.approve) {
      if (!decision.approvedAmount) {
        throw ApiError.badRequest('Enter the amount you are approving');
      }
    } else if (!decision.notes?.trim()) {
      throw ApiError.badRequest('Say why this damage is being dismissed');
    }

    const updated = await prisma.damage.update({
      where: { id: damageId },
      data: {
        status: decision.approve ? 'APPROVED' : 'DISMISSED',
        approvedAmount: decision.approve ? new Prisma.Decimal(decision.approvedAmount!) : null,
        assessmentNotes: decision.notes?.trim() ?? null,
        approvedById: actor.id,
        approvedAt: new Date(),
      },
      include: { photos: true },
    });

    await auditService.record({
      action: decision.approve ? 'damage.approved' : 'damage.dismissed',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'Damage',
      entityId: damageId,
      metadata: {
        approvedAmount: decision.approvedAmount,
        estimatedAmount: damage.estimatedAmount?.toFixed(2),
        notes: decision.notes,
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return toPublicDamage(updated);
  },

  /**
   * Turn an approved damage into a chargeable amount on the booking.
   *
   * Uses the APPROVED figure, never the estimate. It creates an
   * AdditionalCharge rather than touching the deposit directly, so damage
   * joins the same settle/waive flow as every other post-return charge - one
   * place staff look, one place the customer sees.
   */
  async raiseCharge(damageId: string, actor: FleetActor) {
    const damage = await prisma.damage.findUnique({
      where: { id: damageId },
      include: { booking: { select: { id: true, bookingNumber: true, currency: true } } },
    });
    if (!damage) throw ApiError.notFound('Damage record not found');

    if (damage.status !== 'APPROVED') {
      throw ApiError.conflict('Only approved damage can be charged. Assess it first.');
    }
    if (!damage.bookingId || !damage.booking) {
      throw ApiError.badRequest(
        'This damage is not linked to a rental, so there is nobody to charge. Record it against a booking first.',
      );
    }
    if (!damage.approvedAmount) {
      throw ApiError.badRequest('This damage has no approved amount');
    }

    await prisma.$transaction(async (tx) => {
      await tx.additionalCharge.create({
        data: {
          bookingId: damage.bookingId!,
          type: 'DAMAGE',
          amount: damage.approvedAmount!,
          currency: damage.booking!.currency,
          description: `Damage: ${damage.description}`,
          calculation: {
            damageId: damage.id,
            damageType: damage.type,
            location: damage.location,
            estimatedAmount: damage.estimatedAmount?.toFixed(2) ?? null,
            approvedAmount: damage.approvedAmount!.toFixed(2),
            assessmentNotes: damage.assessmentNotes,
          },
          createdById: actor.id,
          status: 'PENDING',
        },
      });

      await tx.damage.update({ where: { id: damageId }, data: { status: 'CHARGED' } });
    });

    await auditService.record({
      action: 'damage.charged',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'Damage',
      entityId: damageId,
      metadata: {
        bookingNumber: damage.booking.bookingNumber,
        amount: damage.approvedAmount.toFixed(2),
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    const updated = await prisma.damage.findUniqueOrThrow({
      where: { id: damageId },
      include: { photos: true },
    });
    return toPublicDamage(updated);
  },

  async addPhotos(damageId: string, files: Express.Multer.File[], actor: FleetActor) {
    const damage = await prisma.damage.findUnique({ where: { id: damageId } });
    if (!damage) throw ApiError.notFound('Damage record not found');

    // Validate everything before storing anything.
    files.forEach(assertRealImage);

    for (const file of files) {
      const stored = await storage.upload({
        buffer: file.buffer,
        originalName: file.originalname,
        mimeType: file.mimetype,
        folder: `damages/${damageId}`,
        visibility: 'public',
      });

      try {
        await prisma.damagePhoto.create({
          data: {
            damageId,
            storageKey: stored.key,
            sizeBytes: stored.sizeBytes,
            mimeType: stored.mimeType,
          },
        });
      } catch (error) {
        await storage.delete(stored.key).catch((cleanupError: unknown) => {
          logger.error('Failed to clean up orphaned damage photo', {
            key: stored.key,
            error: String(cleanupError),
          });
        });
        throw error;
      }
    }

    await auditService.record({
      action: 'damage.photos_added',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'Damage',
      entityId: damageId,
      metadata: { count: files.length },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    const updated = await prisma.damage.findUniqueOrThrow({
      where: { id: damageId },
      include: { photos: true },
    });
    return toPublicDamage(updated);
  },

  async list(query: {
    page: number;
    limit: number;
    vehicleId?: string;
    bookingId?: string;
    status?: DamageStatus;
  }) {
    const where: Prisma.DamageWhereInput = {
      ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
      ...(query.bookingId ? { bookingId: query.bookingId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [items, total] = await prisma.$transaction([
      prisma.damage.findMany({
        where,
        include: {
          photos: true,
          vehicle: { select: { brand: true, model: true, registrationNumber: true } },
          booking: { select: { bookingNumber: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.damage.count({ where }),
    ]);

    return {
      items: items.map((damage) => ({
        ...toPublicDamage(damage),
        vehicle: `${damage.vehicle.brand} ${damage.vehicle.model} (${damage.vehicle.registrationNumber})`,
        bookingNumber: damage.booking?.bookingNumber ?? null,
      })),
      total,
    };
  },
};
