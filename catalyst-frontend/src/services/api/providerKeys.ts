import apiClient from './client';

/**
 * Which provider API keys are configured, as booleans only (never key values).
 *
 * Providers whose required key is missing are hidden from the plugin/mod-manager
 * provider dropdowns — selecting them would only return 409 errors. The backend
 * exposes this to any authenticated user because subusers see the same tabs.
 */
export type ProviderKeyStatus = {
  modrinth: boolean;
  curseforge: boolean;
};

export const providerKeysApi = {
  status: async (): Promise<ProviderKeyStatus> => {
    const data = await apiClient.get<{ success: boolean; data: ProviderKeyStatus }>(
      '/api/providers/status',
    );
    return data.data;
  },
};

/**
 * Provider ids that require a configured API key to work.
 * Every other provider (paper, spigot, metamod, …) needs no key.
 */
export const KEY_GATED_PROVIDERS = ['modrinth', 'curseforge'] as const;

export const providerRequiresKey = (providerId: string): boolean =>
  (KEY_GATED_PROVIDERS as readonly string[]).includes(providerId);

export const providerKeyConfigured = (
  providerId: string,
  status: ProviderKeyStatus | undefined,
): boolean => {
  if (!providerRequiresKey(providerId)) return true;
  if (!status) return true; // status unknown — don't hide anything yet
  if (providerId === 'modrinth') return status.modrinth;
  if (providerId === 'curseforge') return status.curseforge;
  return true;
};
