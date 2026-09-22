/**
 * modules/customers/types.ts
 * ---------------------------------------------------------------------------
 * Customer profile and document shapes.
 *
 * Note what a PublicDocument does NOT contain: `storageKey`. The key is the
 * only handle on the stored file, and it must never leave the server - a
 * client that has it could try to construct a path to someone else's passport.
 * Files are reached only through an authorised streaming route, by document id.
 */
import type {
  Customer,
  CustomerDocument,
  DocumentStatus,
  DocumentType,
  ResidencyStatus,
} from '@prisma/client';

export interface PublicCustomer {
  id: string;
  userId: string;
  residencyStatus: ResidencyStatus | null;
  dateOfBirth: string | null;
  nationality: string | null;
  address: {
    line1: string | null;
    line2: string | null;
    city: string | null;
    emirate: string | null;
    country: string | null;
  };
  emergencyContact: { name: string | null; phone: string | null };
  licence: {
    number: string | null;
    issuingCountry: string | null;
    issueDate: string | null;
    expiryDate: string | null;
  };
  isVerified: boolean;
  verifiedAt: string | null;
  createdAt: string;
}

export interface PublicDocument {
  id: string;
  type: DocumentType;
  status: DocumentStatus;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  documentNumber: string | null;
  issuingCountry: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  /** Only populated when the document was rejected (BRD 13). */
  rejectionReason: string | null;
  reviewedAt: string | null;
  supersededAt: string | null;
  uploadedAt: string;
  /** Derived: true when an APPROVED document has passed its expiry date. */
  isExpired: boolean;
  /** Where to fetch the file. Authorised route, not a public URL. */
  downloadPath: string;
}

/** One entry per document the customer still owes us. */
export interface DocumentRequirement {
  type: DocumentType;
  label: string;
  required: boolean;
  status: DocumentStatus | 'MISSING';
  documentId: string | null;
  rejectionReason: string | null;
  /**
   * When this document stops being valid.
   *
   * Exposed so a caller can say WHY a booking failed verification. A document
   * that is fine today and expires mid-rental is refused - correctly - but
   * "upload anything still outstanding" is useless advice when nothing is
   * outstanding and the real problem is a date.
   */
  expiryDate: string | null;
}

export interface VerificationSummary {
  /** True only when every REQUIRED document is APPROVED and unexpired. */
  isVerified: boolean;
  residencyStatus: ResidencyStatus | null;
  requirements: DocumentRequirement[];
  /** Set when the client has not configured a requirement list yet. */
  warnings: string[];
}

const dateOnly = (value: Date | null): string | null =>
  value ? value.toISOString().slice(0, 10) : null;

export function toPublicCustomer(customer: Customer): PublicCustomer {
  return {
    id: customer.id,
    userId: customer.userId,
    residencyStatus: customer.residencyStatus,
    dateOfBirth: dateOnly(customer.dateOfBirth),
    nationality: customer.nationality,
    address: {
      line1: customer.addressLine1,
      line2: customer.addressLine2,
      city: customer.city,
      emirate: customer.emirate,
      country: customer.country,
    },
    emergencyContact: {
      name: customer.emergencyContactName,
      phone: customer.emergencyContactPhone,
    },
    licence: {
      number: customer.licenceNumber,
      issuingCountry: customer.licenceIssuingCountry,
      issueDate: dateOnly(customer.licenceIssueDate),
      expiryDate: dateOnly(customer.licenceExpiryDate),
    },
    isVerified: customer.isVerified,
    verifiedAt: customer.verifiedAt?.toISOString() ?? null,
    createdAt: customer.createdAt.toISOString(),
  };
}

export function toPublicDocument(document: CustomerDocument): PublicDocument {
  const isExpired = document.expiryDate ? document.expiryDate < new Date() : false;

  return {
    id: document.id,
    type: document.type,
    status: document.status,
    fileName: document.fileName,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    documentNumber: document.documentNumber,
    issuingCountry: document.issuingCountry,
    issueDate: dateOnly(document.issueDate),
    expiryDate: dateOnly(document.expiryDate),
    rejectionReason: document.rejectionReason,
    reviewedAt: document.reviewedAt?.toISOString() ?? null,
    supersededAt: document.supersededAt?.toISOString() ?? null,
    uploadedAt: document.uploadedAt.toISOString(),
    isExpired,
    downloadPath: `/documents/${document.id}/file`,
  };
}

/** Human labels. The BRD's own wording, so admin screens match the spec. */
export const DOCUMENT_LABELS: Record<DocumentType, string> = {
  EMIRATES_ID: 'Emirates ID',
  UAE_DRIVING_LICENCE: 'UAE Driving Licence',
  PASSPORT: 'Passport',
  VISA: 'Visa / entry documentation',
  DRIVING_LICENCE: 'Driving Licence',
  INTERNATIONAL_DRIVING_PERMIT: 'International Driving Permit',
  OTHER: 'Other document',
};
