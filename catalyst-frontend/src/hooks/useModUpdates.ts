/**
 * Mod updates summary (audit D13).
 *
 * The manual "check updates" button used to be the only way to learn that a
 * mod had a newer version, and it lived inside Mods → Installed. This hook
 * produces the count once per server and caches it under a stable key so the
 * page tab bar can badge the Mods tab without firing its own request:
 *
 *   useQuery({ queryKey: ['mod-updates-summary', serverId], enabled: false })
 *
 * The key literal is a cross-workstream contract — see
 * `qk.modUpdatesSummary` in lib/queryKeys.ts. The reader must NOT import this
 * hook (it would run the check-updates request); it only reads the cache.
 */
import { useQuery } from '@/csync';
import { modManagerApi } from '../services/api/modManager';
import { qk } from '../lib/queryKeys';

/** A provider check is a fan-out of upstream requests: never more than once
 *  per 5 minutes per server, however often the tab remounts. */
export const MOD_UPDATES_STALE_MS = 5 * 60 * 1000;

export type ModUpdatesSummary = {
  /** How many installed mods have a newer version available. */
  updates: number;
};

export type ModUpdatesSummaryQuery = ReturnType<typeof useModUpdatesSummary>;

/**
 * @param serverId the server whose installed mods are checked.
 * @param installedCount how many mods are installed right now. The
 *   check-updates endpoint walks every installed file and calls the provider
 *   APIs, so it stays disabled while the folder is empty — there is nothing to
 *   report and no reason to spend the requests.
 */
export function useModUpdatesSummary(
  serverId: string | undefined,
  installedCount = 0,
) {
  const query = useQuery<ModUpdatesSummary>({
    queryKey: qk.modUpdatesSummary(serverId ?? ''),
    queryFn: async () => {
      if (!serverId) return { updates: 0 };
      const result = await modManagerApi.checkUpdates(serverId);
      return { updates: result?.updatesAvailable ?? 0 };
    },
    enabled: Boolean(serverId) && installedCount > 0,
    staleTime: MOD_UPDATES_STALE_MS,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  return {
    ...query,
    /** Convenience: the count, 0 while loading or unavailable. */
    updates: query.data?.updates ?? 0,
  };
}