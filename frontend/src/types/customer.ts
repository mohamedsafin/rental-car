/**
 * types/customer.ts
 * ---------------------------------------------------------------------------
 * Customer profile and identity-document contracts.
 *
 * Note there is no `url` on a document, and no storage key. Files are fetched
 * from `downloadPath` through an authorised API route that checks who is
 * asking - there is deliberately no public URL to hold.
 */

export type ResidencyStatus = 'UAE_RESIDENT' | 'VISITOR';

export type DocumentType =
  | 'EMIRATES_ID'
  | 'UAE_DRIVING_LICENCE'
  | 'PASSPORT'
  | 'VISA'
  | 'DRIVING_LICENCE'
  | 'INTERNATIONAL_DRIVING_PERMIT'
  | 'OTHER';

export type DocumentStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';

export interface CustomerProfile {
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

export interface CustomerDocument {
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
  rejectionReason: string | null;
  reviewedAt: string | null;
  supersededAt: string | null;
  uploadedAt: string;
  isExpired: boolean;
  /** Relative API path, e.g. "/documents/<id>/file". Not a public URL. */
  downloadPath: string;
}

export interface DocumentRequirement {
  type: DocumentType;
  label: string;
  required: boolean;
  status: DocumentStatus | 'MISSING';
  documentId: string | null;
  rejectionReason: string | null;
  /** When this document stops being valid. Null if it never expires. */
  expiryDate: string | null;
}

export interface VerificationSummary {
  isVerified: boolean;
  residencyStatus: ResidencyStatus | null;
  requirements: DocumentRequirement[];
  /** Surfaced when the operator has not configured a requirement list yet. */
  warnings: string[];
}

export interface CustomerListItem extends CustomerProfile {
  user: {
    id: string;
    fullName: string;
    email: string;
    phone: string | null;
    status: string;
  };
  pendingDocumentCount: number;
}

/** Labels matching the BRD's own wording. */
export const DOCUMENT_LABELS: Record<DocumentType, string> = {
  EMIRATES_ID: 'Emirates ID',
  UAE_DRIVING_LICENCE: 'UAE Driving Licence',
  PASSPORT: 'Passport',
  VISA: 'Visa / entry documentation',
  DRIVING_LICENCE: 'Driving Licence',
  INTERNATIONAL_DRIVING_PERMIT: 'International Driving Permit',
  OTHER: 'Other document',
};

export const STATUS_STYLE: Record<DocumentStatus | 'MISSING', string> = {
  APPROVED: 'bg-emerald-100 text-emerald-800',
  PENDING: 'bg-amber-100 text-amber-800',
  REJECTED: 'bg-red-100 text-red-800',
  EXPIRED: 'bg-orange-100 text-orange-800',
  MISSING: 'bg-slate-100 text-slate-600',
};
