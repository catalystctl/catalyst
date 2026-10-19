/**
 * Catalyst - mod manager search filter parsing.
 *
 * Shared by the search route and the category endpoint so the accepted sort
 * values and category syntax are defined once and unit-testable.
 */

/** Sort orders the UI offers, mapped per provider below. */
export const MOD_SORT_VALUES = ["relevance", "downloads", "follows", "newest", "updated"] as const;

export type ModSortValue = (typeof MOD_SORT_VALUES)[number];

/**
 * Normalize the `sort` query parameter.
 *
 * Returns `null` for anything unrecognised so the caller can reject it rather
 * than silently substituting a different order.
 */
export function normalizeModSort(value: unknown): ModSortValue | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return (MOD_SORT_VALUES as readonly string[]).includes(normalized)
    ? (normalized as ModSortValue)
    : null;
}

/**
 * CurseForge `sortField` ids. `relevance` is intentionally absent: CurseForge
 * has no relevance field, so omitting `sortField` lets it decide.
 */
export const CURSEFORGE_SORT_FIELDS: Partial<Record<ModSortValue, string>> = {
  downloads: "6",
  follows: "2",
  newest: "11",
  updated: "3",
};

const MAX_CATEGORIES = 12;
const CATEGORY_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

/**
 * Parse the comma-separated `categories` parameter.
 *
 * Categories are interpolated into a Modrinth facet, so only conservative
 * slug-shaped values are accepted; anything else is dropped instead of being
 * passed through to the provider.
 */
export function parseCategoryList(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const seen = new Set<string>();
  for (const part of value.split(",")) {
    const category = part.trim().toLowerCase();
    if (!category || !CATEGORY_PATTERN.test(category)) continue;
    seen.add(category);
    if (seen.size >= MAX_CATEGORIES) break;
  }
  return [...seen];
}

/** Modrinth `project_type` value for each Catalyst search target. */
export function projectTypeFacet(target: "mods" | "datapacks" | "modpacks"): string {
  return target === "mods" ? "mod" : target === "datapacks" ? "datapack" : "modpack";
}

export interface ModrinthSearchInput {
  target: "mods" | "datapacks" | "modpacks";
  /** Trimmed search text; empty means "browse". */
  query: string;
  /** Already resolved (never "latest"). Empty means "every game version". */
  gameVersion?: string;
  loader?: string;
  categories?: string[];
  /** A provider-level game tag (e.g. "minecraft"). */
  gameTag?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Build the Modrinth `/v2/search` query string.
 *
 * Two rules here were each a bug that made modpack search look broken:
 *  - an *empty* game version must not become a facet. The route used to fall
 *    back to the server's own version ("latest" → newest MC release), which
 *    hid nearly every modpack.
 *  - an *empty* loader must not become a facet, or "Any loader" would still
 *    filter to one loader.
 */
export function buildModrinthSearchParams(input: ModrinthSearchInput): URLSearchParams {
  const pageSize = input.pageSize ?? 20;
  const page = Number(input.page);
  const safePage = Number.isFinite(page) && page > 0 ? page : 1;

  const facets: string[][] = [[`project_type:${projectTypeFacet(input.target)}`]];
  if (input.gameTag && input.gameTag.trim()) {
    facets.push([`categories:${input.gameTag.trim().toLowerCase()}`]);
  }
  const gameVersion = input.gameVersion?.trim() ?? "";
  if (gameVersion) {
    facets.push([`versions:${gameVersion}`]);
  }
  const loader = input.loader?.trim().toLowerCase() ?? "";
  if (loader) {
    facets.push([`categories:${loader}`]);
  }
  for (const category of input.categories ?? []) {
    facets.push([`categories:${category}`]);
  }

  // Relevance only exists when there is something to be relevant to; browsing
  // keeps the downloads order unless the caller asked for a specific sort.
  const index = input.sort ?? (input.query ? undefined : "downloads");

  const params = new URLSearchParams({
    query: input.query,
    limit: String(pageSize),
    facets: JSON.stringify(facets),
    offset: String((safePage - 1) * pageSize),
  });
  if (index) params.set("index", index);
  return params;
}
