/**
 * services/customer.service.ts
 * ---------------------------------------------------------------------------
 * Customer profile and document API calls.
 */
import { api, getData, patchData } from './api';
import type { PaginatedData } from '../types/api';
import type {
  CustomerDocument,
  CustomerListItem,
  CustomerProfile,
  DocumentType,
  VerificationSummary,
} from '../types/customer';

export interface ProfileResponse {
  customer: CustomerProfile;
  verification: VerificationSummary;
}

export const customerService = {
  /** The signed-in customer's own profile. No id - it comes from the token. */
  getMyProfile: () => getData<ProfileResponse>('/customers/me'),

  updateMyProfile: (data: Record<string, unknown>) =>
    patchData<ProfileResponse>('/customers/me', data),

  getMyDocuments: () => getData<{ documents: CustomerDocument[] }>('/customers/me/documents'),

  /**
   * Upload one identity document.
   *
   * Content-Type is set to undefined so the browser can add the multipart
   * boundary itself - setting it by hand produces a request the server cannot
   * parse.
   */
  async uploadDocument(input: {
    file: File;
    type: DocumentType;
    documentNumber?: string;
    issuingCountry?: string;
    issueDate?: string;
    expiryDate?: string;
  }) {
    const form = new FormData();
    form.append('document', input.file);
    form.append('type', input.type);
    if (input.documentNumber) form.append('documentNumber', input.documentNumber);
    if (input.issuingCountry) form.append('issuingCountry', input.issuingCountry);
    if (input.issueDate) form.append('issueDate', input.issueDate);
    if (input.expiryDate) form.append('expiryDate', input.expiryDate);

    const response = await api.post('/documents', form, {
      headers: { 'Content-Type': undefined },
    });
    return response.data.data as { document: CustomerDocument; verification: VerificationSummary };
  },

  /**
   * Fetch a document's bytes as a blob URL.
   *
   * The request carries the auth token, which is exactly why an <img src>
   * pointing at the raw path would not work - and why the file is safe.
   */
  async getDocumentBlobUrl(downloadPath: string): Promise<string> {
    const response = await api.get(downloadPath, { responseType: 'blob' });
    return URL.createObjectURL(response.data as Blob);
  },

  // --- Staff and admin -----------------------------------------------------

  listCustomers: (params: Record<string, unknown>) =>
    getData<PaginatedData<CustomerListItem>>('/customers', params),

  getCustomer: (id: string) =>
    getData<{
      customer: CustomerListItem;
      verification: VerificationSummary;
      documents: CustomerDocument[];
    }>(`/customers/${id}`),

  reviewDocument: (id: string, body: { status: 'APPROVED' | 'REJECTED'; rejectionReason?: string }) =>
    patchData<{ document: CustomerDocument }>(`/documents/${id}/review`, body),
};
