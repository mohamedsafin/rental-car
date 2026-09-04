/**
 * modules/customers/validation.ts
 */
import { z } from 'zod';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');
const country2 = z.string().length(2, 'Use a 2-letter code, e.g. AE').toUpperCase();
const phone = z.string().regex(/^\+?[1-9]\d{7,14}$/, 'Enter a valid phone number, e.g. +971501234567');

export const updateCustomerProfileSchema = z
  .object({
    residencyStatus: z.enum(['UAE_RESIDENT', 'VISITOR']).optional(),
    dateOfBirth: dateOnly.optional(),
    nationality: country2.optional(),
    addressLine1: z.string().max(200).trim().optional(),
    addressLine2: z.string().max(200).trim().optional(),
    city: z.string().max(80).trim().optional(),
    emirate: z.string().max(80).trim().optional(),
    country: country2.optional(),
    emergencyContactName: z.string().max(120).trim().optional(),
    emergencyContactPhone: phone.optional(),
    licenceNumber: z.string().max(60).trim().optional(),
    licenceIssuingCountry: country2.optional(),
    licenceIssueDate: dateOnly.optional(),
    licenceExpiryDate: dateOnly.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  })
  // Minimum rental age is a client setting (BRD 51), so we do NOT enforce a
  // number here. We only reject dates that cannot describe a driver at all.
  .refine(
    (data) => {
      if (!data.dateOfBirth) return true;
      const dob = new Date(data.dateOfBirth);
      const years = (Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      return years >= 16 && years <= 110;
    },
    { message: 'Enter a valid date of birth', path: ['dateOfBirth'] },
  )
  .refine(
    (data) =>
      !data.licenceIssueDate ||
      !data.licenceExpiryDate ||
      new Date(data.licenceExpiryDate) > new Date(data.licenceIssueDate),
    { message: 'Licence expiry must be after the issue date', path: ['licenceExpiryDate'] },
  );

export const uploadDocumentSchema = z
  .object({
    type: z.enum([
      'EMIRATES_ID',
      'UAE_DRIVING_LICENCE',
      'PASSPORT',
      'VISA',
      'DRIVING_LICENCE',
      'INTERNATIONAL_DRIVING_PERMIT',
      'OTHER',
    ]),
    documentNumber: z.string().max(60).trim().optional(),
    issuingCountry: country2.optional(),
    issueDate: dateOnly.optional(),
    expiryDate: dateOnly.optional(),
  })
  .refine(
    (data) =>
      !data.issueDate || !data.expiryDate || new Date(data.expiryDate) > new Date(data.issueDate),
    { message: 'Expiry date must be after the issue date', path: ['expiryDate'] },
  );

export const reviewDocumentSchema = z
  .object({
    status: z.enum(['APPROVED', 'REJECTED']),
    rejectionReason: z.string().max(500).trim().optional(),
  })
  // BRD 13: a rejection must carry a reason so the customer knows what to fix.
  .refine((data) => data.status !== 'REJECTED' || (data.rejectionReason?.length ?? 0) >= 3, {
    message: 'Give a reason so the customer knows what to correct',
    path: ['rejectionReason'],
  });

export const customerIdParamSchema = z.object({ id: z.string().uuid('Invalid customer id') });
export const documentIdParamSchema = z.object({ id: z.string().uuid('Invalid document id') });

export const listCustomersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().max(120).optional(),
  verified: z.enum(['true', 'false']).optional().transform((v) => (v === undefined ? undefined : v === 'true')),
  pendingDocuments: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});

export type UpdateCustomerProfileInput = z.infer<typeof updateCustomerProfileSchema>;
export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>;
export type ReviewDocumentInput = z.infer<typeof reviewDocumentSchema>;
export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;
