import { describe, it, expect } from "vitest";
import {
  buildModrinthSearchParams,
  CURSEFORGE_SORT_FIELDS,
  MOD_SORT_VALUES,
  normalizeModSort,
  parseCategoryList,
  projectTypeFacet,
} from "../lib/mod-manager-search";
import {
  PROJECT_TYPE_BY_TARGET,
  selectCategoriesForTarget,
  type ModrinthCategory,
} from "../services/modrinth-categories";

describe("normalizeModSort", () => {
  it("accepts every advertised sort value", () => {
    for (const value of MOD_SORT_VALUES) {
      expect(normalizeModSort(value)).toBe(value);
    }
  });

  it("is case- and whitespace-insensitive", () => {
    expect(normalizeModSort(" Downloads ")).toBe("downloads");
    expect(normalizeModSort("NEWEST")).toBe("newest");
  });

  it("returns null for unknown values so the route can reject them", () => {
    // Silently substituting a different order would hide the mistake.
    expect(normalizeModSort("bogus")).toBeNull();
    expect(normalizeModSort("")).toBeNull();
    expect(normalizeModSort(undefined)).toBeNull();
    expect(normalizeModSort(42)).toBeNull();
  });

  it("maps sort values onto CurseForge field ids, leaving relevance unmapped", () => {
    expect(CURSEFORGE_SORT_FIELDS.downloads).toBe("6");
    expect(CURSEFORGE_SORT_FIELDS.follows).toBe("2");
    expect(CURSEFORGE_SORT_FIELDS.newest).toBe("11");
    expect(CURSEFORGE_SORT_FIELDS.updated).toBe("3");
    expect(CURSEFORGE_SORT_FIELDS.relevance).toBeUndefined();
  });
});

describe("parseCategoryList", () => {
  it("splits, trims and lowercases a comma-separated list", () => {
    expect(parseCategoryList(" Adventure, TECHNOLOGY ")).toEqual(["adventure", "technology"]);
  });

  it("de-duplicates", () => {
    expect(parseCategoryList("magic,magic,Magic")).toEqual(["magic"]);
  });

  it("drops values that are not slug-shaped", () => {
    // Categories are interpolated into a provider facet.
    for (const bad of ["../etc", "a b", "a:b", "\"quoted\"", "[x]", "x/y"]) {
      expect(parseCategoryList(bad)).toEqual([]);
    }
  });

  it("ignores empty segments and non-strings", () => {
    expect(parseCategoryList(",,")).toEqual([]);
    expect(parseCategoryList(undefined)).toEqual([]);
    expect(parseCategoryList(["adventure"])).toEqual([]);
  });

  it("caps the number of categories", () => {
    const many = Array.from({ length: 30 }, (_, i) => `cat${i}`).join(",");
    expect(parseCategoryList(many)).toHaveLength(12);
  });
});

describe("selectCategoriesForTarget", () => {
  const categories: ModrinthCategory[] = [
    { name: "adventure", header: "categories", projectType: "modpack" },
    { name: "optimization", header: "categories", projectType: "modpack" },
    { name: "worldgen", header: "categories", projectType: "mod" },
    { name: "library", header: "categories", projectType: "mod" },
    { name: "adventure", header: "categories", projectType: "datapack" },
    { name: "typed-less" },
  ];

  it("keeps only the categories for the browsed target", () => {
    expect(selectCategoriesForTarget(categories, "modpacks").map((c) => c.name)).toEqual([
      "adventure",
      "optimization",
    ]);
    expect(selectCategoriesForTarget(categories, "mods").map((c) => c.name)).toEqual([
      "library",
      "worldgen",
    ]);
  });

  it("drops entries without a project type", () => {
    expect(selectCategoriesForTarget(categories, "mods").map((c) => c.name)).not.toContain(
      "typed-less",
    );
  });

  it("sorts by name so the dropdown order is stable", () => {
    expect(selectCategoriesForTarget(categories, "modpacks").map((c) => c.name)).toEqual([
      "adventure",
      "optimization",
    ]);
  });

  it("maps each Catalyst target to Modrinth's project_type", () => {
    expect(PROJECT_TYPE_BY_TARGET.mods).toBe("mod");
    expect(PROJECT_TYPE_BY_TARGET.datapacks).toBe("datapack");
    expect(PROJECT_TYPE_BY_TARGET.modpacks).toBe("modpack");
  });
});

describe("buildModrinthSearchParams", () => {
  const parse = (input: Parameters<typeof buildModrinthSearchParams>[0]) => {
    const params = buildModrinthSearchParams(input);
    const facets: string[][] = JSON.parse(params.get("facets") ?? "[]");
    return {
      params,
      facets,
      has: (facet: string) => facets.some((group) => group.includes(facet)),
    };
  };

  it("facets modpacks by project_type", () => {
    const { has } = parse({ target: "modpacks", query: "cobblemon" });
    expect(has("project_type:modpack")).toBe(true);
    expect(projectTypeFacet("mods")).toBe("mod");
    expect(projectTypeFacet("datapacks")).toBe("datapack");
    expect(projectTypeFacet("modpacks")).toBe("modpack");
  });

  it("does not filter by game version unless one is given", () => {
    // The regression: falling back to the server's version ("latest" → 26.3)
    // returned 0 results for "cobblemon" instead of 843.
    const { facets } = parse({ target: "modpacks", query: "cobblemon" });
    expect(facets.some((group) => group.some((f) => f.startsWith("versions:")))).toBe(false);
  });

  it("applies an explicitly requested game version", () => {
    const { has } = parse({ target: "modpacks", query: "cobblemon", gameVersion: "1.20.1" });
    expect(has("versions:1.20.1")).toBe(true);
  });

  it("does not apply a loader facet for an empty loader", () => {
    // "Any loader" must mean any: defaulting to Forge hid 798 of 843 packs.
    const { has } = parse({ target: "modpacks", query: "cobblemon", loader: "" });
    for (const loader of ["forge", "fabric", "neoforge", "quilt"]) {
      expect(has(`categories:${loader}`)).toBe(false);
    }
  });

  it("applies a loader facet case-insensitively when chosen", () => {
    const { has } = parse({ target: "modpacks", query: "cobblemon", loader: " NeoForge " });
    expect(has("categories:neoforge")).toBe(true);
  });

  it("ANDs multiple categories as separate facet groups", () => {
    const { facets } = parse({
      target: "modpacks",
      query: "",
      categories: ["adventure", "quests"],
    });
    expect(facets).toContainEqual(["categories:adventure"]);
    expect(facets).toContainEqual(["categories:quests"]);
  });

  it("sorts browsing by downloads and searching by relevance", () => {
    expect(parse({ target: "modpacks", query: "" }).params.get("index")).toBe("downloads");
    expect(parse({ target: "modpacks", query: "cobblemon" }).params.get("index")).toBeNull();
    expect(parse({ target: "modpacks", query: "cobblemon", sort: "newest" }).params.get("index")).toBe(
      "newest",
    );
  });

  it("paginates at 20 per page with a safe offset", () => {
    expect(parse({ target: "modpacks", query: "x", page: 3 }).params.get("offset")).toBe("40");
    expect(parse({ target: "modpacks", query: "x", page: 1 }).params.get("offset")).toBe("0");
    expect(parse({ target: "modpacks", query: "x", page: 0 }).params.get("offset")).toBe("0");
    expect(parse({ target: "modpacks", query: "x", page: NaN }).params.get("offset")).toBe("0");
  });
});
