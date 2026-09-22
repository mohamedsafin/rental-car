/**
 * modules/customers/requirements.ts
 * ---------------------------------------------------------------------------
 * "Which documents does THIS customer have to provide?"
 *
 * BRD 12 lists examples for UAE residents and for visitors, then says: "The
 * exact document requirements will be provided and approved by the client."
 *
 * So the list is a SETTING, not a constant. Two keys hold it:
 *
 *   documents.required_uae_resident   e.g. ["EMIRATES_ID","UAE_DRIVING_LICENCE"]
 *   documents.required_visitor        e.g. ["PASSPORT","VISA","DRIVING_LICENCE"]
 *
 * Both seed as `[]`. With an empty list the system asks for nothing and says
 * so, rather than inventing a requirement that could wrongly block a paying
 * customer - or, worse, wrongly let one through.
 */
import type { DocumentStatus, DocumentType, ResidencyStatus } from '@prisma/client';
import { logger } from '../../config/logger';
import { settingsService } from '../settings/service';
import { DOCUMENT_LABELS, type DocumentRequirement } from './types';

export const RequirementSettingKey = {
  UAE_RESIDENT: 'documents.required_uae_resident',
  VISITOR: 'documents.required_visitor',
} as const;

const VALID_TYPES: DocumentType[] = [
  'EMIRATES_ID',
  'UAE_DRIVING_LICENCE',
  'PASSPORT',
  'VISA',
  'DRIVING_LICENCE',
  'INTERNATIONAL_DRIVING_PERMIT',
  'OTHER',
];

/** Read and sanity-check a configured requirement list. */
async function readRequiredTypes(key: string): Promise<DocumentType[]> {
  const raw = await settingsService.getJson<unknown>(key);
  if (!Array.isArray(raw)) return [];

  const valid = raw.filter((value): value is DocumentType =>
    typeof value === 'string' && VALID_TYPES.includes(value as DocumentType),
  );

  if (valid.length !== raw.length) {
    // Configuration mistake, not a customer problem: log it for the operator
    // and carry on with the entries that do make sense.
    logger.warn('Document requirement list contains unrecognised types', { key });
  }

  return valid;
}

export async function getRequiredDocumentTypes(
  residencyStatus: ResidencyStatus | null,
): Promise<{ types: DocumentType[]; warnings: string[] }> {
  const warnings: string[] = [];

  if (!residencyStatus) {
    return {
      types: [],
      warnings: ['Tell us whether you are a UAE resident or a visitor so we can list your documents.'],
    };
  }

  const key =
    residencyStatus === 'UAE_RESIDENT'
      ? RequirementSettingKey.UAE_RESIDENT
      : RequirementSettingKey.VISITOR;

  const types = await readRequiredTypes(key);

  if (types.length === 0) {
    warnings.push(
      `No document requirements are configured for ${
        residencyStatus === 'UAE_RESIDENT' ? 'UAE residents' : 'visitors'
      }. Set ${key} in Settings.`,
    );
  }

  return { types, warnings };
}

interface DocumentSummary {
  id: string;
  type: DocumentType;
  status: DocumentStatus;
  expiryDate: Date | null;
  rejectionReason: string | null;
  supersededAt: Date | null;
}

/**
 * An APPROVED document that has passed its expiry date does NOT count.
 *
 * A licence approved in January and expired in June is not valid in July, and
 * treating a stale APPROVED row as good enough is exactly how an expired
 * licence ends up behind the wheel.
 */
function isUsable(document: DocumentSummary, now: Date): boolean {
  if (document.supersededAt) return false;
  if (document.status !== 'APPROVED') return false;
  if (document.expiryDate && document.expiryDate < now) return false;
  return true;
}

/**
 * Build the checklist the customer sees and the verification verdict staff
 * rely on.
 *
 * Returns `isVerified: false` when nothing is configured. Defaulting to `true`
 * would silently let unverified customers through the moment a setting was
 * missing - the failure has to be visible, not permissive.
 */
export async function evaluateRequirements(
  residencyStatus: ResidencyStatus | null,
  documents: DocumentSummary[],
  now: Date = new Date(),
): Promise<{ requirements: DocumentRequirement[]; isVerified: boolean; warnings: string[] }> {
  const { types: requiredTypes, warnings } = await getRequiredDocumentTypes(residencyStatus);

  const live = documents.filter((document) => !document.supersededAt);

  const requirements: DocumentRequirement[] = requiredTypes.map((type) => {
    // Newest first, so a fresh re-upload replaces an older rejection in the UI.
    const match = live.find((document) => document.type === type);

    return {
      type,
      label: DOCUMENT_LABELS[type],
      required: true,
      status: match?.status ?? 'MISSING',
      documentId: match?.id ?? null,
      rejectionReason: match?.rejectionReason ?? null,
      expiryDate: match?.expiryDate ? match.expiryDate.toISOString().slice(0, 10) : null,
    };
  });

  // Anything uploaded that is not on the required list is still shown, marked
  // optional - customers volunteer extra documents and staff should see them.
  for (const document of live) {
    if (requiredTypes.includes(document.type)) continue;
    requirements.push({
      type: document.type,
      label: DOCUMENT_LABELS[document.type],
      required: false,
      status: document.status,
      documentId: document.id,
      rejectionReason: document.rejectionReason,
      expiryDate: document.expiryDate ? document.expiryDate.toISOString().slice(0, 10) : null,
    });
  }

  const isVerified =
    requiredTypes.length > 0 &&
    requiredTypes.every((type) =>
      live.some((document) => document.type === type && isUsable(document, now)),
    );

  return { requirements, isVerified, warnings };
}
