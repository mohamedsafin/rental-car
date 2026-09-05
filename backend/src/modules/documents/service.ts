/**
 * modules/documents/service.ts
 * ---------------------------------------------------------------------------
 * Customer identity documents (BRD 12 and 13).
 *
 * This is the most sensitive data the system holds: Emirates IDs, passports,
 * visas. Four rules, enforced here rather than trusted to callers:
 *
 *  1. Files go to PRIVATE storage. The `visibility: 'private'` argument is
 *     required by the StorageProvider interface, so it cannot be forgotten,
 *     and the local driver refuses to build a public URL for a private key.
 *
 *  2. The storage key never leaves the server. Clients address a document by
 *     its id and receive the bytes through an authorised route.
 *
 *  3. Ownership is checked against the TOKEN, never a parameter. Customer A
 *     asking for customer B's document id gets 404, not 403 - a 403 would
 *     confirm the document exists.
 *
 *  4. A rejected or replaced document is superseded, never deleted. BRD 13
 *     wants the customer to re-upload; the rejection remains part of the
 *     record of what was checked and when.
 */
import type { DocumentType, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { logger } from '../../config/logger';
import { ApiError } from '../../utils/ApiError';
import { assertRealDocument } from '../../middleware/upload';
import { storage } from '../../services/storage';
import { auditService } from '../audit/service';
import { fireAndForget, notify } from '../notifications/triggers';
import { evaluateRequirements } from '../customers/requirements';
import { toPublicDocument, type PublicDocument } from '../customers/types';

export interface DocumentActor {
  id: string;
  email: string;
  role: 'CUSTOMER' | 'ADMIN' | 'STAFF';
  ipAddress?: string;
  userAgent?: string;
}

/** Refresh the cached `isVerified` roll-up after any document change. */
async function refreshVerification(customerId: string): Promise<boolean> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: {
      documents: {
        select: {
          id: true,
          type: true,
          status: true,
          expiryDate: true,
          rejectionReason: true,
          supersededAt: true,
        },
      },
    },
  });
  if (!customer) return false;

  const { isVerified } = await evaluateRequirements(customer.residencyStatus, customer.documents);

  await prisma.customer.update({
    where: { id: customerId },
    data: {
      isVerified,
      // Stamp the moment verification was first achieved; clear it if the
      // customer falls back out of compliance (an expiry, a new requirement).
      verifiedAt: isVerified ? (customer.verifiedAt ?? new Date()) : null,
    },
  });

  return isVerified;
}

export const documentService = {
  /**
   * Store an uploaded document.
   *
   * Uploading the same TYPE again supersedes the previous one, which is the
   * re-upload path BRD 13 asks for after a rejection. The old row stays.
   */
  async upload(
    customerId: string,
    file: Express.Multer.File,
    input: {
      type: DocumentType;
      documentNumber?: string;
      issuingCountry?: string;
      issueDate?: Date;
      expiryDate?: Date;
    },
    actor: DocumentActor,
  ): Promise<PublicDocument> {
    // Magic bytes before anything is written. The declared MIME type is a
    // string the client chose; the leading bytes are not.
    assertRealDocument(file);

    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw ApiError.notFound('Customer profile not found');

    if (input.expiryDate && input.expiryDate < new Date()) {
      throw ApiError.badRequest('This document has already expired. Upload a current one.');
    }

    const stored = await storage.upload({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      folder: `customers/${customerId}`,
      // NOT 'public'. This is the line that keeps an Emirates ID off the
      // open web, and the interface makes it impossible to omit.
      visibility: 'private',
    });

    try {
      const document = await prisma.$transaction(async (tx) => {
        // Supersede any live document of the same type.
        await tx.customerDocument.updateMany({
          where: { customerId, type: input.type, supersededAt: null },
          data: { supersededAt: new Date() },
        });

        return tx.customerDocument.create({
          data: {
            customerId,
            type: input.type,
            storageKey: stored.key,
            fileName: file.originalname.slice(0, 255),
            mimeType: stored.mimeType,
            sizeBytes: stored.sizeBytes,
            documentNumber: input.documentNumber ?? null,
            issuingCountry: input.issuingCountry ?? null,
            issueDate: input.issueDate ?? null,
            expiryDate: input.expiryDate ?? null,
            status: 'PENDING',
          },
        });
      });

      await refreshVerification(customerId);

      await auditService.record({
        action: 'document.uploaded',
        actorId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        entityType: 'CustomerDocument',
        entityId: document.id,
        // The TYPE is logged; the document number is not. Audit logs are
        // widely readable inside a company and get exported to spreadsheets.
        metadata: { type: input.type },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });

      return toPublicDocument(document);
    } catch (error) {
      // Bytes are stored but the row failed. Remove the file rather than leave
      // an unreferenced copy of someone's passport on disk.
      await storage.delete(stored.key).catch((cleanupError: unknown) => {
        logger.error('Failed to clean up orphaned document upload', {
          key: stored.key,
          error: String(cleanupError),
        });
      });
      throw error;
    }
  },

  /**
   * Fetch a document's file, checking the caller may see it.
   *
   * Ownership is derived from the verified token. A customer asking for a
   * document that is not theirs gets NOT FOUND, not FORBIDDEN - "forbidden"
   * would confirm the id exists, which is itself a leak.
   */
  async getFileForActor(
    documentId: string,
    actor: DocumentActor,
  ): Promise<{ stream: NodeJS.ReadableStream; mimeType: string; fileName: string }> {
    const document = await prisma.customerDocument.findUnique({
      where: { id: documentId },
      include: { customer: { select: { userId: true } } },
    });

    const isBackOffice = actor.role === 'ADMIN' || actor.role === 'STAFF';
    const isOwner = document?.customer.userId === actor.id;

    if (!document || (!isBackOffice && !isOwner)) {
      // Deliberately identical for "no such document" and "not yours".
      throw ApiError.notFound('Document not found');
    }

    if (!storage.getStream) {
      throw ApiError.internal('The configured storage provider cannot stream files');
    }

    // Every view of an identity document is recorded. If a customer ever asks
    // "who looked at my passport?", this is the answer.
    await auditService.record({
      action: 'document.viewed',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'CustomerDocument',
      entityId: document.id,
      metadata: { type: document.type },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return {
      stream: await storage.getStream(document.storageKey),
      mimeType: document.mimeType,
      fileName: document.fileName,
    };
  },

  /** Documents for one customer. Superseded rows are included for staff only. */
  async listForCustomer(customerId: string, includeSuperseded: boolean): Promise<PublicDocument[]> {
    const documents = await prisma.customerDocument.findMany({
      where: { customerId, ...(includeSuperseded ? {} : { supersededAt: null }) },
      orderBy: [{ supersededAt: 'asc' }, { uploadedAt: 'desc' }],
    });
    return documents.map(toPublicDocument);
  },

  /**
   * Approve or reject a document (BRD 13).
   *
   * A rejection REQUIRES a reason. "Rejected" with no explanation leaves the
   * customer re-uploading the same unacceptable photo, which helps nobody.
   */
  async review(
    documentId: string,
    decision: { status: 'APPROVED' | 'REJECTED'; rejectionReason?: string },
    actor: DocumentActor,
  ): Promise<PublicDocument> {
    const existing = await prisma.customerDocument.findUnique({ where: { id: documentId } });
    if (!existing) throw ApiError.notFound('Document not found');

    if (existing.supersededAt) {
      throw ApiError.conflict('This document has been replaced by a newer upload');
    }

    if (decision.status === 'REJECTED' && !decision.rejectionReason?.trim()) {
      throw ApiError.badRequest('Give a reason so the customer knows what to correct');
    }

    const document = await prisma.customerDocument.update({
      where: { id: documentId },
      data: {
        status: decision.status,
        rejectionReason: decision.status === 'REJECTED' ? decision.rejectionReason!.trim() : null,
        reviewedById: actor.id,
        reviewedAt: new Date(),
      },
    });

    const isVerified = await refreshVerification(existing.customerId);

    await auditService.record({
      action: decision.status === 'APPROVED' ? 'document.approved' : 'document.rejected',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'CustomerDocument',
      entityId: documentId,
      metadata: {
        type: document.type,
        customerVerified: isVerified,
        ...(decision.status === 'REJECTED' ? { reason: decision.rejectionReason } : {}),
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    /*
     * Tell the customer. Until now this was a TODO left over from Phase 5 -
     * the template and the trigger both existed by Phase 10, but nothing
     * called them, so a document could be approved and the customer would
     * never be told. The only way to find out was to go and look.
     *
     * Detached: the decision is already recorded and must not be rolled back
     * by a mail failure.
     */
    const customer = await prisma.customer.findUnique({
      where: { id: existing.customerId },
      select: { userId: true },
    });

    if (customer) {
      fireAndForget(
        notify.documentReviewed(customer.userId, document.type, decision.status === 'APPROVED', {
          reason: decision.rejectionReason?.trim(),
          nowVerified: isVerified,
          documentId: documentId,
        }),
      );
    }

    return toPublicDocument(document);
  },

  /**
   * Mark approved documents whose expiry has passed as EXPIRED.
   *
   * Run on a schedule in Phase 10. Exposed as a method now so the status is
   * derived by one piece of code rather than re-implemented per screen.
   */
  async expireOverdueDocuments(now: Date = new Date()): Promise<number> {
    const overdue = await prisma.customerDocument.findMany({
      where: { status: 'APPROVED', supersededAt: null, expiryDate: { lt: now } },
      select: { id: true, customerId: true },
    });

    if (overdue.length === 0) return 0;

    await prisma.customerDocument.updateMany({
      where: { id: { in: overdue.map((d) => d.id) } },
      data: { status: 'EXPIRED' },
    });

    const affected = [...new Set(overdue.map((d) => d.customerId))];
    for (const customerId of affected) {
      await refreshVerification(customerId);
    }

    logger.info('Expired overdue customer documents', { count: overdue.length });
    return overdue.length;
  },
};

/** Exported so the customers module can reuse the same roll-up logic. */
export { refreshVerification };
