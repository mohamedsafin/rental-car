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
