import { useQuery, useMutation, useQueryClient } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { apiKeyService, CreateApiKeyRequest, UpdateApiKeyRequest, type ApiKey } from '../services/apiKeys';
import { toast } from 'sonner';

/**
 * Hook to fetch all API keys
 */
export function useApiKeys() {
  return useQuery({
    queryKey: qk.apiKeys(),
    queryFn: () => apiKeyService.list(),
    staleTime: 60_000,
    // api_key_* admin SSE.
    refetchInterval: false,
    refetchIntervalInBackground: false,
  });
}

/**
 * Hook to fetch a single API key
 */
export function useApiKey(id: string | undefined) {
  return useQuery({
    queryKey: qk.apiKeyDetail(id!),
    queryFn: () => apiKeyService.get(id!),
    enabled: !!id,
    staleTime: 60_000,
  });
}

/**
 * Hook to fetch API key usage statistics
 */
export function useApiKeyUsage(id: string | undefined) {
  return useQuery({
    queryKey: qk.apiKeyUsage(id!),
    queryFn: () => apiKeyService.getUsage(id!),
    enabled: !!id,
    staleTime: 30_000,
    // Usage counters are not SSE-pushed; keep a light poll while the detail view is open.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

/**
 * Hook to fetch the permissions catalog (categories + permissions).
 */
export function usePermissionsCatalog() {
  return useQuery({
    queryKey: qk.permissionsCatalog(),
    queryFn: () => apiKeyService.getPermissionsCatalog(),
    staleTime: 10 * 60 * 1000, // Catalog rarely changes
  });
}

/**
 * Hook to fetch the current user's effective permissions.
 */
export function useMyPermissions() {
  return useQuery({
    queryKey: qk.myPermissions(),
    queryFn: () => apiKeyService.getMyPermissions(),
    staleTime: 60 * 1000, // Refresh every minute
  });
}

/**
 * Hook to create a new API key
 */
export function useCreateApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateApiKeyRequest) => apiKeyService.create(data),
    onSuccess: () => {
      toast.success('API key created successfully');
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to create API key');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.apiKeys() });
    },
  });
}

/**
 * Hook to update an API key
 */
export function useUpdateApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateApiKeyRequest }) =>
      apiKeyService.update(id, data),
    onSuccess: () => {
      toast.success('API key updated successfully');
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to update API key');
    },
    onSettled: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: qk.apiKeys() });
      if (variables) {
        queryClient.invalidateQueries({ queryKey: qk.apiKeyVariable(variables.id) });
      }
    },
  });
}

/**
 * Hook to delete (revoke) an API key
 */
export function useDeleteApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiKeyService.delete(id),
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: qk.apiKeys() });
      const previous = queryClient.getQueryData<ApiKey[]>(qk.apiKeys());
      queryClient.setQueryData<ApiKey[]>(qk.apiKeys(), (old: ApiKey[] | undefined) =>
        old ? old.filter((key: ApiKey) => key.id !== id) : old,
      );
      return { previous };
    },
    onSuccess: () => {
      toast.success('API key revoked successfully');
    },
    onError: (_error, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(qk.apiKeys(), context.previous);
      }
      toast.error('Failed to revoke API key');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.apiKeys() });
    },
  });
}
