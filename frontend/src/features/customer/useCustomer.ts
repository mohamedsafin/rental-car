/**
 * features/customer/useCustomer.ts
 * ---------------------------------------------------------------------------
 * Profile, documents and upload hooks.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customerService, type ProfileResponse } from '../../services/customer.service';
import type { NormalisedApiError } from '../../types/api';
import type { CustomerDocument, DocumentType, VerificationSummary } from '../../types/customer';

export function useMyProfile() {
  return useQuery<ProfileResponse, NormalisedApiError>({
    queryKey: ['my-profile'],
    queryFn: customerService.getMyProfile,
    /*
     * Refetch when the tab regains focus, overriding the app-wide default.
     *
     * Verification status is the one thing on this page that changes because
     * of an action the customer did NOT take: a staff member approves their
     * documents in another system entirely. With the global
     * `refetchOnWindowFocus: false`, a customer sitting on this tab while
     * their passport was approved would keep reading "upload your ID" until
     * they happened to navigate or hard-reload - and nothing on screen would
     * suggest they should.
     */
    refetchOnWindowFocus: true,
  });
}

export function useUpdateMyProfile() {
  const queryClient = useQueryClient();
  return useMutation<ProfileResponse, NormalisedApiError, Record<string, unknown>>({
    mutationFn: customerService.updateMyProfile,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-profile'] }),
  });
}

export function useMyDocuments() {
  return useQuery<{ documents: CustomerDocument[] }, NormalisedApiError>({
    queryKey: ['my-documents'],
    queryFn: customerService.getMyDocuments,
    // Same reason as the profile: an approval or rejection happens in the
    // back office, so this list changes without the customer doing anything.
    refetchOnWindowFocus: true,
  });
}

export function useUploadDocument() {
  const queryClient = useQueryClient();

  return useMutation<
    { document: CustomerDocument; verification: VerificationSummary },
    NormalisedApiError,
    {
      file: File;
      type: DocumentType;
      documentNumber?: string;
      issuingCountry?: string;
      issueDate?: string;
      expiryDate?: string;
    }
  >({
    mutationFn: customerService.uploadDocument,
    onSuccess: () => {
      // Both the document list and the profile's verification summary change.
      void queryClient.invalidateQueries({ queryKey: ['my-documents'] });
      void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
    },
  });
}
