/**
 * modules/fleet/insuranceService.ts
 * ---------------------------------------------------------------------------
 * Insurance policies, vehicle documents and expiry reminders (BRD 40, 41).
 *
 * Three things live together here because they answer one question: "is this
 * car legal to rent out today?" A car with an expired policy or an expired
 * registration is a liability, not an asset, and the point of this module is
 * that nobody has to remember to check.
 *
 * Two decisions worth stating:
 *
 *  1. Vehicle documents go to PRIVATE storage, like customer documents. A
 *     Mulkiya scan carries the chassis number and the owner's details; it is
 *     not marketing material and must not be reachable by guessing a URL.
 *
 *  2. The reminder windows are NOT hardcoded. BRD 41 gives 30/15/7/0 days as
 *     the client's example, so that is the seeded default, but the value is a
 *     setting. If the client comes back with 60/30/7, that is a settings edit,
 *     not a deployment.
 */
import { Prisma } from '@prisma/client';
import type { VehicleDocumentType } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { ApiError } from '../../utils/ApiError';
import { logger } from '../../config/logger';
import { auditService } from '../audit/service';
import { assertRealDocument } from '../../middleware/upload';
import { storage } from '../../services/storage';
import { SettingKey, settingsService } from '../settings/service';
import type { FleetActor } from '../damages/service';

/**
 * BRD 41's own example, used only when the setting has never been written.
 * It is a reminder schedule, not a price or a legal figure - erring towards
 * "warn someone" is safe in a way that inventing a fee is not.
 */
const DEFAULT_REMINDER_DAYS = [30, 15, 7, 0];

export const insuranceService = {
  /**
   * Record a policy. Adding a policy for a vehicle supersedes the previous
   * one rather than editing it, so last year's cover is still on file when a
   * claim arrives about last year's accident.
   */
  async addPolicy(
    input: {
      vehicleId: string;
      provider: string;
      policyNumber: string;
      coverType?: string;
      startDate: Date;
      expiryDate: Date;
      premium?: string;
      notes?: string;
    },
    actor: FleetActor,
  ) {
    if (input.expiryDate <= input.startDate) {
      throw ApiError.badRequest('The policy must expire after it starts');
    }

    const vehicle = await prisma.vehicle.findFirst({
      where: { id: input.vehicleId, deletedAt: null },
    });
    if (!vehicle) throw ApiError.notFound('Vehicle not found');

    const record = await prisma.$transaction(async (tx) => {
      await tx.insuranceRecord.updateMany({
        where: { vehicleId: input.vehicleId, isActive: true },
        data: { isActive: false },
      });

      return tx.insuranceRecord.create({
        data: {
          vehicleId: input.vehicleId,
          provider: input.provider,
          policyNumber: input.policyNumber,
          coverType: input.coverType ?? null,
          startDate: input.startDate,
          expiryDate: input.expiryDate,
          premium: input.premium ? new Prisma.Decimal(input.premium) : null,
          notes: input.notes ?? null,
          isActive: true,
        },
      });
    });

    await auditService.record({
      action: 'insurance.recorded',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'InsuranceRecord',
      entityId: record.id,
      metadata: {
        vehicleId: input.vehicleId,
        policyNumber: input.policyNumber,
        expiryDate: input.expiryDate.toISOString().slice(0, 10),
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return toPublicPolicy(record);
  },

  async listPolicies(vehicleId: string) {
    const records = await prisma.insuranceRecord.findMany({
      where: { vehicleId },
      orderBy: { expiryDate: 'desc' },
    });
    return records.map(toPublicPolicy);
  },

  /**
   * Store a vehicle document (Mulkiya, insurance certificate, inspection
   * report). Private storage, magic-byte checked, same as identity documents.
   */
  async uploadDocument(
    vehicleId: string,
    file: Express.Multer.File,
    input: {
      type: VehicleDocumentType;
      documentNumber?: string;
      issueDate?: Date;
      expiryDate?: Date;
      notes?: string;
    },
    actor: FleetActor,
  ) {
    assertRealDocument(file);

    const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, deletedAt: null } });
    if (!vehicle) throw ApiError.notFound('Vehicle not found');

    const stored = await storage.upload({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      folder: `vehicles/${vehicleId}/documents`,
      // A Mulkiya is not a marketing photo.
      visibility: 'private',
    });

    try {
      const document = await prisma.vehicleDocument.create({
        data: {
          vehicleId,
          type: input.type,
          storageKey: stored.key,
          fileName: file.originalname.slice(0, 255),
          mimeType: stored.mimeType,
          sizeBytes: stored.sizeBytes,
          documentNumber: input.documentNumber ?? null,
          issueDate: input.issueDate ?? null,
          expiryDate: input.expiryDate ?? null,
          notes: input.notes ?? null,
          uploadedById: actor.id,
        },
      });

      await auditService.record({
        action: 'vehicle_document.uploaded',
        actorId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        entityType: 'VehicleDocument',
        entityId: document.id,
        metadata: { vehicleId, type: input.type },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });

      return toPublicDocument(document);
    } catch (error) {
      // The row failed, so the bytes are unreferenced. Remove them rather than
      // leaving an orphan on disk.
      await storage.delete(stored.key).catch(() => undefined);
      throw error;
    }
  },

  async listDocuments(vehicleId: string) {
    const documents = await prisma.vehicleDocument.findMany({
      where: { vehicleId },
      orderBy: { createdAt: 'desc' },
    });
    return documents.map(toPublicDocument);
  },

  /** Stream a vehicle document. Back-office only; every read is audited. */
  async getDocumentFile(id: string, actor: FleetActor) {
    const document = await prisma.vehicleDocument.findUnique({ where: { id } });
    if (!document) throw ApiError.notFound('Document not found');

    if (!storage.getStream) {
      throw ApiError.internal('The configured storage provider cannot stream files');
    }

    await auditService.record({
      action: 'vehicle_document.viewed',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'VehicleDocument',
      entityId: document.id,
      metadata: { vehicleId: document.vehicleId, type: document.type },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return {
      stream: await storage.getStream(document.storageKey),
      mimeType: document.mimeType,
      fileName: document.fileName,
    };
  },

  async deleteDocument(id: string, actor: FleetActor) {
    const document = await prisma.vehicleDocument.findUnique({ where: { id } });
    if (!document) throw ApiError.notFound('Document not found');

    await prisma.vehicleDocument.delete({ where: { id } });
    await storage.delete(document.storageKey).catch((error) => {
      // The row is gone either way; a stranded file is a cleanup job, not a
      // failed request. Phase 11 sweeps these.
      logger.warn('Vehicle document file could not be deleted', { key: document.storageKey, error });
    });

    await auditService.record({
      action: 'vehicle_document.deleted',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'VehicleDocument',
      entityId: id,
      metadata: { vehicleId: document.vehicleId, type: document.type },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  },

  /**
   * The expiry dashboard (BRD 41).
   *
   * Returns everything expiring within the widest configured window, plus
   * anything already expired. "Already expired" is never filtered out by the
   * window - a policy that lapsed 90 days ago is the most urgent row on the
   * page, not the least.
   */
  async expiring(options?: { withinDays?: number }) {
    const reminderDays = await reminderDaysSetting();
    const horizonDays = options?.withinDays ?? Math.max(...reminderDays);

    const today = startOfDay(new Date());
    const horizon = new Date(today);
    horizon.setUTCDate(horizon.getUTCDate() + horizonDays);

    const [policies, documents] = await Promise.all([
      prisma.insuranceRecord.findMany({
        where: { isActive: true, expiryDate: { lte: horizon }, vehicle: { deletedAt: null } },
        include: { vehicle: { select: { id: true, brand: true, model: true, registrationNumber: true } } },
        orderBy: { expiryDate: 'asc' },
      }),
      prisma.vehicleDocument.findMany({
        where: { expiryDate: { not: null, lte: horizon }, vehicle: { deletedAt: null } },
        include: { vehicle: { select: { id: true, brand: true, model: true, registrationNumber: true } } },
        orderBy: { expiryDate: 'asc' },
      }),
    ]);

    const items = [
      ...policies.map((policy) => ({
        kind: 'INSURANCE' as const,
        id: policy.id,
        vehicleId: policy.vehicle.id,
        vehicle: `${policy.vehicle.brand} ${policy.vehicle.model} (${policy.vehicle.registrationNumber})`,
        label: `${policy.provider} - ${policy.policyNumber}`,
        expiryDate: policy.expiryDate.toISOString().slice(0, 10),
        daysRemaining: daysBetween(today, policy.expiryDate),
      })),
      ...documents.map((document) => ({
        kind: 'DOCUMENT' as const,
        id: document.id,
        vehicleId: document.vehicle.id,
        vehicle: `${document.vehicle.brand} ${document.vehicle.model} (${document.vehicle.registrationNumber})`,
        label: document.type,
        expiryDate: document.expiryDate!.toISOString().slice(0, 10),
        daysRemaining: daysBetween(today, document.expiryDate!),
      })),
    ].sort((a, b) => a.daysRemaining - b.daysRemaining);

    return {
      reminderDays,
      horizonDays,
      expired: items.filter((item) => item.daysRemaining < 0),
      dueSoon: items.filter((item) => item.daysRemaining >= 0),
    };
  },

  /**
   * The scan a scheduled job calls (Phase 10 wires it to notifications).
   *
   * It returns only the rows landing EXACTLY on a reminder day, so a 30-day
   * window sends one message on day 30 - not one every day for a month.
   * Alert fatigue is how a real expiry gets ignored.
   */
  async dueReminders() {
    const reminderDays = await reminderDaysSetting();
    const { expired, dueSoon } = await insuranceService.expiring({
      withinDays: Math.max(...reminderDays),
    });

    return [...expired, ...dueSoon].filter((item) => reminderDays.includes(item.daysRemaining));
  },
};

/**
 * Reads the configured reminder schedule.
 *
 * Unlike a price, a missing value here has a safe answer: warn on the BRD's
 * own example schedule. Sending a reminder nobody asked for is recoverable;
 * silently sending none is not.
 */
async function reminderDaysSetting(): Promise<number[]> {
  const configured = await settingsService.getJson<number[]>(SettingKey.EXPIRY_REMINDER_DAYS);

  if (!Array.isArray(configured) || configured.length === 0) {
    logger.warn('Expiry reminder schedule is not configured; using the BRD example of 30/15/7/0 days', {
      setting: SettingKey.EXPIRY_REMINDER_DAYS,
    });
    return DEFAULT_REMINDER_DAYS;
  }

  const valid = configured.filter((day) => Number.isInteger(day) && day >= 0);
  return valid.length > 0 ? [...valid].sort((a, b) => b - a) : DEFAULT_REMINDER_DAYS;
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000);
}

function toPublicPolicy(record: {
  id: string;
  vehicleId: string;
  provider: string;
  policyNumber: string;
  coverType: string | null;
  startDate: Date;
  expiryDate: Date;
  premium: Prisma.Decimal | null;
  currency: string;
  isActive: boolean;
  notes: string | null;
}) {
  return {
    id: record.id,
    vehicleId: record.vehicleId,
    provider: record.provider,
    policyNumber: record.policyNumber,
    coverType: record.coverType,
    startDate: record.startDate.toISOString().slice(0, 10),
    expiryDate: record.expiryDate.toISOString().slice(0, 10),
    premium: record.premium?.toFixed(2) ?? null,
    currency: record.currency,
    isActive: record.isActive,
    notes: record.notes,
  };
}

function toPublicDocument(document: {
  id: string;
  vehicleId: string;
  type: VehicleDocumentType;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  documentNumber: string | null;
  issueDate: Date | null;
  expiryDate: Date | null;
  notes: string | null;
  createdAt: Date;
}) {
  return {
    id: document.id,
    vehicleId: document.vehicleId,
    type: document.type,
    fileName: document.fileName,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    documentNumber: document.documentNumber,
    issueDate: document.issueDate?.toISOString().slice(0, 10) ?? null,
    expiryDate: document.expiryDate?.toISOString().slice(0, 10) ?? null,
    notes: document.notes,
    // Deliberately no URL. The bytes come only from the streaming route.
    createdAt: document.createdAt.toISOString(),
  };
}
