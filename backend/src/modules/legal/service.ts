/**
 * modules/legal/service.ts
 * ---------------------------------------------------------------------------
 * Versioned terms, privacy policy and rental agreement (BRD 45-47).
 *
 * Versioned rather than editable in place, because the question asked in a
 * dispute is never "what do the terms say?" - it is "what did the terms say on
 * the day they booked?". Publishing a new version supersedes the previous one;
 * it never overwrites it, and a published version is never edited again.
 *
 * The CONTENT is entirely the client's. Nothing here ships with drafted legal
 * text: an invented cancellation clause would be worse than an empty page,
 * because an empty page gets filled in and an invented one gets relied upon.
 */
import { Prisma } from '@prisma/client';
import type { LegalDocumentType, Role } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { ApiError } from '../../utils/ApiError';
import { auditService } from '../audit/service';

export interface LegalActor {
  id: string;
  email: string;
  role: Role;
  ipAddress?: string;
  userAgent?: string;
}

export const legalService = {
  /** The live version of each document type - what the customer site shows. */
  async published() {
    const documents = await prisma.legalDocument.findMany({
      where: { isPublished: true },
      orderBy: [{ type: 'asc' }, { version: 'desc' }],
    });

    // Highest published version per type wins. Done in code rather than with a
    // DISTINCT ON so the ordering rule is visible.
    const latest = new Map<LegalDocumentType, (typeof documents)[number]>();
    for (const document of documents) {
      if (!latest.has(document.type)) latest.set(document.type, document);
    }

    return [...latest.values()].map(toPublicDocument);
  },

  async getPublished(type: LegalDocumentType) {
    const document = await prisma.legalDocument.findFirst({
      where: { type, isPublished: true },
      orderBy: { version: 'desc' },
    });
    if (!document) throw ApiError.notFound('That document has not been published yet');

    return toPublicDocument(document);
  },

  /** Every version of every type, newest first. Admin only. */
  async listAll(type?: LegalDocumentType) {
    const documents = await prisma.legalDocument.findMany({
      where: type ? { type } : {},
      orderBy: [{ type: 'asc' }, { version: 'desc' }],
    });

    return documents.map(toPublicDocument);
  },

  /**
   * Write a new version.
   *
   * Always a new version, never an update: `version` is `max + 1` for that
   * type. Editing published legal text in place would destroy the only record
   * of what customers actually agreed to.
   */
  async createVersion(
    input: { type: LegalDocumentType; title: string; content: string; effectiveFrom?: Date },
    actor: LegalActor,
  ) {
    const latest = await prisma.legalDocument.findFirst({
      where: { type: input.type },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    const document = await prisma.legalDocument.create({
      data: {
        type: input.type,
        version: (latest?.version ?? 0) + 1,
        title: input.title,
        content: input.content,
        effectiveFrom: input.effectiveFrom ?? null,
        createdById: actor.id,
      },
    });

    await auditService.record({
      action: 'legal_document.drafted',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'LegalDocument',
      entityId: document.id,
      metadata: { type: input.type, version: document.version },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return toPublicDocument(document);
  },

  /**
   * Edit a DRAFT. Refuses once published, which is the point.
   */
  async updateDraft(
    id: string,
    input: { title?: string; content?: string; effectiveFrom?: Date },
    actor: LegalActor,
  ) {
    const document = await prisma.legalDocument.findUnique({ where: { id } });
    if (!document) throw ApiError.notFound('Document not found');

    if (document.isPublished) {
      throw ApiError.conflict(
        'A published document cannot be edited. Create a new version instead - customers agreed to this text.',
      );
    }

    const updated = await prisma.legalDocument.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.content !== undefined ? { content: input.content } : {}),
        ...(input.effectiveFrom !== undefined ? { effectiveFrom: input.effectiveFrom } : {}),
      },
    });

    void actor;
    return toPublicDocument(updated);
  },

  /**
   * Publish a version, superseding whatever was live for that type.
   *
   * The previous version is unpublished, not deleted: bookings point at it,
   * and those agreements have to keep resolving.
   */
  async publish(id: string, actor: LegalActor) {
    const document = await prisma.legalDocument.findUnique({ where: { id } });
    if (!document) throw ApiError.notFound('Document not found');
    if (document.isPublished) throw ApiError.conflict('This version is already published');

    const published = await prisma.$transaction(async (tx) => {
      await tx.legalDocument.updateMany({
        where: { type: document.type, isPublished: true },
        data: { isPublished: false },
      });

      return tx.legalDocument.update({
        where: { id },
        data: {
          isPublished: true,
          publishedAt: new Date(),
          effectiveFrom: document.effectiveFrom ?? new Date(),
        },
      });
    });

    await auditService.record({
      action: 'legal_document.published',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'LegalDocument',
      entityId: id,
      metadata: { type: document.type, version: document.version },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return toPublicDocument(published);
  },

  /**
   * Record that a booking accepted whatever is published right now.
   *
   * Called inside the booking transaction. Records the CURRENT published
   * version of every type, so the agreement resolves to exact text later even
   * after ten more versions have been published.
   *
   * If nothing is published there is nothing to record - and that absence is
   * itself the honest answer to "which terms did they agree to?".
   */
  async recordAgreement(
    tx: Prisma.TransactionClient,
    bookingId: string,
    ipAddress?: string,
  ): Promise<number> {
    const published = await tx.legalDocument.findMany({
      where: { isPublished: true },
      select: { id: true, type: true, version: true },
      orderBy: [{ type: 'asc' }, { version: 'desc' }],
    });

    const latest = new Map<LegalDocumentType, string>();
    for (const document of published) {
      if (!latest.has(document.type)) latest.set(document.type, document.id);
    }

    if (latest.size === 0) return 0;

    await tx.bookingAgreement.createMany({
      data: [...latest.values()].map((legalDocumentId) => ({
        bookingId,
        legalDocumentId,
        ipAddress: ipAddress ?? null,
      })),
      skipDuplicates: true,
    });

    return latest.size;
  },

  /** What a given booking agreed to, and when. */
  async agreementsFor(bookingId: string) {
    const agreements = await prisma.bookingAgreement.findMany({
      where: { bookingId },
      include: { legalDocument: { select: { type: true, version: true, title: true } } },
      orderBy: { agreedAt: 'asc' },
    });

    return agreements.map((agreement) => ({
      type: agreement.legalDocument.type,
      version: agreement.legalDocument.version,
      title: agreement.legalDocument.title,
      legalDocumentId: agreement.legalDocumentId,
      agreedAt: agreement.agreedAt.toISOString(),
    }));
  },
};

function toPublicDocument(document: {
  id: string;
  type: LegalDocumentType;
  version: number;
  title: string;
  content: string;
  isPublished: boolean;
  publishedAt: Date | null;
  effectiveFrom: Date | null;
  updatedAt: Date;
}) {
  return {
    id: document.id,
    type: document.type,
    version: document.version,
    title: document.title,
    content: document.content,
    isPublished: document.isPublished,
    publishedAt: document.publishedAt?.toISOString() ?? null,
    effectiveFrom: document.effectiveFrom?.toISOString() ?? null,
    updatedAt: document.updatedAt.toISOString(),
  };
}
