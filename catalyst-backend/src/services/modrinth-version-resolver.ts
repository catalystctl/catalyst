/**
 * Cache for Modrinth game version tags.
 * Keyed by provider id, stores the list of valid game version strings.
 */
let versionCache: { key: string; versions: ModrinthGameVersion[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface ModrinthGameVersion {
  version: string;
  version_type: "release" | "snapshot" | "old_alpha" | "old_beta";
  date: string;
  major?: boolean;
}

/**
 * Fetch the list of valid game version tags from Modrinth's tag API.
 * Results are cached for 10 minutes to avoid hammering the API.
 */
async function fetchGameVersions(baseUrl: string, headers: Record<string, string>): Promise<ModrinthGameVersion[]> {
  const cacheKey = baseUrl;
  if (versionCache && versionCache.key === cacheKey && Date.now() - versionCache.fetchedAt < CACHE_TTL_MS) {
    return versionCache.versions;
  }

  const url = `${baseUrl}/v2/tag/game_version`;
  const response = await fetch(url, { headers });
  if (!response.ok) {
    // If the tag endpoint fails, return empty and don't cache
    return [];
  }

  const data = (await response.json()) as ModrinthGameVersion[];
  versionCache = { key: cacheKey, versions: data, fetchedAt: Date.now() };
  return data;
}

/**
 * Resolve a user-provided game version string to a valid Modrinth game version tag.
 *
 * Handles:
 * - "latest" → the most recent release version (e.g. "1.21.4")
 * - Exact matches (e.g. "1.21.4") → returned as-is
 * - Partial versions (e.g. "1.21") → the latest release matching that prefix (e.g. "1.21.4")
 * - Versions not found in Modrinth → returned as-is (let the API return 0 results)
 */
export async function resolveModrinthGameVersion(
  input: string,
  baseUrl: string,
  headers: Record<string, string>,
): Promise<string> {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return input;

  const allVersions = await fetchGameVersions(baseUrl, headers);
  if (!allVersions.length) return input; // Can't resolve without data

  // 1. Handle "latest" — find the most recent release
  if (trimmed === "latest") {
    const releases = allVersions
      .filter((v) => v.version_type === "release")
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    if (releases.length) {
      return releases[0].version;
    }
    // Fallback: most recent any type
    const sorted = [...allVersions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return sorted[0]?.version ?? input;
  }

  // 2. Exact match (case-insensitive)
  const exact = allVersions.find((v) => v.version.toLowerCase() === trimmed);
  if (exact) return exact.version;

  // 3. Partial prefix match — find the latest release starting with the input
  const matching = allVersions.filter((v) => v.version.toLowerCase().startsWith(`${trimmed  }.`) || v.version.toLowerCase() === trimmed);
  if (matching.length) {
    // Prefer releases, sorted by date descending
    const releases = matching
      .filter((v) => v.version_type === "release")
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    if (releases.length) return releases[0].version;
    // Fallback to any match, sorted by date descending
    const sorted = matching.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return sorted[0].version;
  }

  // 4. No match — return as-is (let Modrinth API handle it, likely 0 results)
  return input;
}

/**
 * Invalidate the game version cache (useful for testing or forced refresh).
 */
export function invalidateGameVersionCache(): void {
  versionCache = null;
}
