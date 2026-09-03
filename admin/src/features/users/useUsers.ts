/**
 * features/users/useUsers.ts
 * ---------------------------------------------------------------------------
 * TanStack Query hooks for admin user management.
 *
 * Note `invalidateQueries` after each mutation: rather than hand-patching the
 * cached list, we mark it stale and let Query refetch. The server is the source
 * of truth, and this is how the UI stays honest about what actually happened -
 * including the guard rails that may have refused the change.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getData, patchData, postData } from '../../services/api';
import type { Role, User, UserStatus } from '../../types/auth';
import type { NormalisedApiError, PaginatedData } from '../../types/api';

export interface UserFilters {
  page?: number;
  limit?: number;
  role?: Role;
  status?: UserStatus;
  search?: string;
}

export function useUsers(filters: UserFilters) {
  return useQuery<PaginatedData<User>, NormalisedApiError>({
    queryKey: ['users', filters],
    queryFn: () => getData<PaginatedData<User>>('/users', filters as Record<string, unknown>),
    // Keeps the previous page visible while the next one loads, instead of
    // flashing an empty table on every page change.
    placeholderData: (previous) => previous,
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation<
    { user: User },
    NormalisedApiError,
    { id: string; changes: { role?: Role; status?: UserStatus } }
  >({
    mutationFn: ({ id, changes }) => patchData<{ user: User }>(`/users/${id}`, changes),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

export function useCreateStaff() {
  const queryClient = useQueryClient();

  return useMutation<
    { user: User },
    NormalisedApiError,
    { fullName: string; email: string; password: string; role: 'ADMIN' | 'STAFF' }
  >({
    mutationFn: (data) => postData<{ user: User }>('/users', data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}
