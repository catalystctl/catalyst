/**
 * Shared utility functions for Mod Manager and Plugin Manager.
 *
 * Handles version normalization, filtering, sorting, and provider display
 * logic that is identical across both manager tabs.
 */

// ── Provider display ──

export const titleCase = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1);

export const displayProviderName = (providerId: string) => {
  if (providerId === 'modrinth') return 'Modrinth';
  if (providerId === 'curseforge') return 'CurseForge';
  return titleCase(providerId);
};

// ── Release stability ──

const unstableReleasePattern = /\b(alpha|beta|snapshot|pre[-\s]?release|pre\b|rc)\b/i;

export const isStableRelease = (version: any): boolean => {
  const releaseType = version?.releaseType;
  if (typeof releaseType === 'number') {
    if (releaseType === 1) return true;
    if (releaseType === 2 || releaseType === 3) return false;
  }

  const explicitType =
    typeof version?.version_type === 'string'
      ? version.version_type
      : typeof version?.releaseChannel === 'string'
        ? version.releaseChannel
        : typeof version?.channel === 'string'
          ? version.channel
          : typeof version?.stability === 'string'
            ? version.stability
            : '';
  if (explicitType) {
    const normalized = explicitType.toLowerCase();
    if (normalized.includes('release') || normalized.includes('stable')) return true;
    if (unstableReleasePattern.test(normalized)) return false;
  }

  if (typeof version?.isStable === 'boolean') return version.isStable;
  if (typeof version?.stable === 'boolean') return version.stable;

  const label = normalizeVersionLabel(version);
  return !unstableReleasePattern.test(label.toLowerCase());
};

// ── Version normalization ──

export const normalizeVersionToken = (value: string) =>
  value.trim().toLowerCase().replace(/^v(?=\d)/, '');

export const normalizeVersionId = (version: any): string => {
  const id =
    version?.id ??
    version?.versionId ??
    version?.fileId ??
    version?.fileID ??
    version?.file?.id;
  if (id === undefined || id === null) return '';
  return String(id);
};

export const normalizeVersionLabel = (version: any): string => {
  return (
    version?.name ||
    version?.version ||
    version?.version_number ||
    version?.displayName ||
    version?.fileName ||
    normalizeVersionId(version)
  );
};

// ── Game version matching ──

const collectVersionStrings = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  return [];
};

export const extractGameVersions = (version: any): string[] => {
  const values = [
    ...collectVersionStrings(version?.game_versions),
    ...collectVersionStrings(version?.gameVersions),
    ...collectVersionStrings(version?.versions),
    ...collectVersionStrings(version?.supportedVersions),
    ...collectVersionStrings(version?.supported_versions),
    ...collectVersionStrings(version?.minecraftVersions),
    ...collectVersionStrings(version?.minecraft_versions),
  ];
  return Array.from(new Set(values.map((entry) => normalizeVersionToken(entry))));
};

export const isGameVersionMatch = (candidate: string, requested: string) => {
  const normalizedCandidate = normalizeVersionToken(candidate);
  const normalizedRequested = normalizeVersionToken(requested);
  if (!normalizedCandidate || !normalizedRequested) return false;
  if (normalizedCandidate === normalizedRequested) return true;
  if (normalizedCandidate.startsWith(`${normalizedRequested}.`)) return true;
  if (normalizedRequested.startsWith(`${normalizedCandidate}.`)) return true;
  return false;
};

export const matchesRequestedGameVersion = (
  version: any,
  requestedVersion?: string,
) => {
  const requested = requestedVersion?.trim();
  if (!requested) return true;
  // "latest" matches everything — let all versions through
  if (requested.toLowerCase() === 'latest') return true;
  const versions = extractGameVersions(version);
  if (!versions.length) return true;
  return versions.some((entry) => isGameVersionMatch(entry, requested));
};

// ── Timestamp resolution ──

export const resolveVersionTimestamp = (version: any): number => {
  const candidates = [
    version?.date_published,
    version?.datePublished,
    version?.publishedAt,
    version?.published,
    version?.fileDate,
    version?.createdAt,
    version?.created,
    version?.updatedAt,
    version?.releaseDate,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' || typeof value === 'number') {
      const ts = new Date(value).getTime();
      if (Number.isFinite(ts)) return ts;
    }
  }
  return 0;
};

// ── Filter and sort versions ──

export const filterAndSortVersions = (
  versions: any[],
  requestedGameVersion?: string,
) => {
  const matching = versions.filter((entry) =>
    matchesRequestedGameVersion(entry, requestedGameVersion),
  );
  const pool = matching.length ? matching : versions;
  return [...pool].sort((a, b) => {
    const stableDelta = Number(isStableRelease(b)) - Number(isStableRelease(a));
    if (stableDelta !== 0) return stableDelta;
    const timeDelta = resolveVersionTimestamp(b) - resolveVersionTimestamp(a);
    if (timeDelta !== 0) return timeDelta;
    const aId = Number(normalizeVersionId(a));
    const bId = Number(normalizeVersionId(b));
    if (Number.isFinite(aId) && Number.isFinite(bId) && aId !== bId) {
      return bId - aId;
    }
    return normalizeVersionLabel(b).localeCompare(normalizeVersionLabel(a));
  });
};

/**
 * Split a version list by the requested game version.
 *
 * Returns the list to display (game-version filtered and sorted when possible)
 * plus flags describing what happened so the UI can annotate the selector:
 * - `filtered`: the list was narrowed down by the requested game version.
 * - `exactMatch`: false means nothing was tagged for the requested version and
 *   the full list is shown as a fallback.
 *
 * Providers differ in how much compatibility data they expose:
 * - Modrinth versions carry `game_versions` — reliable filtering.
 * - Spigot versions often carry no tags; releases named after Minecraft
 *   versions (e.g. "1.21.4") are matched by label as a secondary signal.
 * - Hangar (Paper) versions carry no MC tags at all — the full list is shown.
 */
export const splitVersionsForGameVersion = (
  versions: any[],
  requestedGameVersion?: string,
): { list: any[]; exactMatch: boolean; filtered: boolean } => {
  const all = Array.isArray(versions) ? versions : [];
  if (!all.length) return { list: all, exactMatch: false, filtered: false };
  const requested = requestedGameVersion?.trim();
  if (!requested || requested.toLowerCase() === 'latest') {
    return { list: filterAndSortVersions(all), exactMatch: false, filtered: false };
  }

  const tagged = all.filter((entry) => extractGameVersions(entry).length > 0);
  if (!tagged.length) {
    // No explicit tags — try label-based matching before giving up.
    const byLabel = all.filter((entry) =>
      isGameVersionMatch(normalizeVersionLabel(entry), requested),
    );
    if (byLabel.length) {
      return {
        list: filterAndSortVersions(byLabel),
        exactMatch: true,
        filtered: byLabel.length < all.length,
      };
    }
    return { list: filterAndSortVersions(all), exactMatch: false, filtered: false };
  }

  const matching = all.filter((entry) => matchesRequestedGameVersion(entry, requested));
  if (matching.length) {
    return {
      list: filterAndSortVersions(matching),
      exactMatch: true,
      filtered: matching.length < all.length,
    };
  }
  return { list: filterAndSortVersions(all), exactMatch: false, filtered: false };
};

// ── Download count formatting ──

export const formatDownloadCount = (downloads: number): string => {
  if (downloads >= 1_000_000) return `${(downloads / 1_000_000).toFixed(1)}M`;
  if (downloads >= 1_000) return `${(downloads / 1_000).toFixed(1)}K`;
  return String(downloads);
};
