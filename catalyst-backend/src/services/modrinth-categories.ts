/**
 * Catalyst - Modrinth category tags.
 *
 * Modrinth exposes one flat `/v2/tag/category` list where every entry carries
 * a `project_type`. The search UI needs only the categories that apply to the
 * target it is browsing (a modpack category is meaningless for a datapack
 * search), so the list is filtered per target and cached — tag data changes
 * rarely and must not be refetched on every keystroke.
 */

export type ModpackCategoryTarget = "mods" | "datapacks" | "modpacks";

export interface ModrinthCategory {
  name: string;
  /** Modrinth groups categories into headers ("categories", "resolutions", …). */
  header?: string;
  projectType?: string;
}

/** Modrinth's `project_type` value for each Catalyst target. */
export const PROJECT_TYPE_BY_TARGET: Record<ModpackCategoryTarget, string> = {
  mods: "mod",
  datapacks: "datapack",
  modpacks: "modpack",
};

const CACHE_TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
  categories: ModrinthCategory[];
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Test seam: drop cached tags. */
export function clearModrinthCategoryCache() {
  cache.clear();
}

/**
 * Keep the categories that belong to `target`.
 *
 * Entries without a `project_type` are dropped: Modrinth returns loaders and
 * environment tags from other endpoints, and an untyped entry cannot be
 * attributed to a target safely.
 */
export function selectCategoriesForTarget(
  categories: ModrinthCategory[],
  target: ModpackCategoryTarget,
): ModrinthCategory[] {
  const projectType = PROJECT_TYPE_BY_TARGET[target] ?? "mod";
  return categories
    .filter((category) => category?.projectType === projectType && typeof category.name === "string")
    .map((category) => ({
      name: category.name,
      ...(category.header ? { header: category.header } : {}),
      projectType: category.projectType,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Fetch (and memoize) the category names applicable to `target`.
 *
 * Failures return an empty list rather than throwing: category filtering is an
 * optional refinement, and losing it must not take the whole search down.
 */
export async function fetchModrinthCategories(
  baseUrl: string,
  headers: Record<string, string>,
  target: ModpackCategoryTarget,
): Promise<ModrinthCategory[]> {
  const key = baseUrl.replace(/\/$/, "");
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return selectCategoriesForTarget(cached.categories, target);
  }

  try {
    const response = await fetch(`${key}/v2/tag/category`, { headers });
    if (!response.ok) return [];
    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) return [];

    const categories: ModrinthCategory[] = payload
      .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
      .map((entry) => ({
        name: typeof entry.name === "string" ? entry.name : "",
        header: typeof entry.header === "string" ? entry.header : undefined,
        projectType: typeof entry.project_type === "string" ? entry.project_type : undefined,
      }))
      .filter((entry) => entry.name.length > 0);

    cache.set(key, { categories, fetchedAt: Date.now() });
    return selectCategoriesForTarget(categories, target);
  } catch {
    return [];
  }
}
