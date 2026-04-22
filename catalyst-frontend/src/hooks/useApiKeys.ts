import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
    refetchInterval: 30000,
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
    refetchOnWindowFocus: true,
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
      queryClient.invalidateQueries({ queryKey: qk.apiKeys() });
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
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: qk.apiKeys() });
      queryClient.invalidateQueries({ queryKey: qk.apiKeyVariable(variables.id) });
      toast.success('API key updated successfully');
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to update API key');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.apiKeys() });
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
      queryClient.setQueryData<ApiKey[]>(qk.apiKeys(), (old) =>
        old ? old.filter((key) => key.id !== id) : old,
      );
      return { previous };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.apiKeys() });
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
