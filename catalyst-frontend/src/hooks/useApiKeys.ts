import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { apiKeyService, CreateApiKeyRequest, UpdateApiKeyRequest } from '../services/apiKeys';
import { toast } from 'sonner';

export const API_KEYS_QUERY_KEY = ['apiKeys'] as const;

/**
 * Hook to fetch all API keys
 */
export function useApiKeys() {
  return useQuery({
    queryKey: API_KEYS_QUERY_KEY,
    queryFn: () => apiKeyService.list(),
  });
}

/**
 * Hook to fetch a single API key
 */
export function useApiKey(id: string | undefined) {
  return useQuery({
    queryKey: [...API_KEYS_QUERY_KEY, id],
    queryFn: () => apiKeyService.get(id!),
    enabled: !!id,
  });
}

/**
 * Hook to fetch API key usage statistics
 */
export function useApiKeyUsage(id: string | undefined) {
  return useQuery({
    queryKey: [...API_KEYS_QUERY_KEY, id, 'usage'],
    queryFn: () => apiKeyService.getUsage(id!),
    enabled: !!id,
    refetchInterval: 30000, // Refetch every 30 seconds
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
  });
}

/**
 * Hook to delete (revoke) an API key
 */
export function useDeleteApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiKeyService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.apiKeys() });
      toast.success('API key revoked successfully');
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to revoke API key');
    },
  });
}
