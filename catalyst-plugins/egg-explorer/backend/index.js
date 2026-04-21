/**
 * Egg Explorer Plugin — Backend v2
 *
 * Uses the GitHub REST API (Tree + Contents) instead of cloning the repo.
 *
 * Flow:
 *   1. GET /repos/…/git/trees/main?recursive=1  →  all file paths in 1 call
 *   2. Build a browseable index from paths alone (category, name from filename)
 *   3. Background: fetch full egg JSONs for changed files via Contents API
 *   4. On-demand: GET /repos/…/contents/{path}  →  full egg when user views/imports
 *
 * Routes (auto-prefixed to /api/plugins/egg-explorer):
 *   GET  /              — paginated egg list with search & filters
 *   GET  /categories    — category tree with counts
 *   GET  /egg?path=…    — full raw egg JSON for a given file
 *   POST /sync          — trigger re-index (async)
 *   GET  /status        — sync health check
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GITHUB_API = 'https://api.github.com/repos/pterodactyl/game-eggs';

let ctx;
let eggIndex = null;
let isSyncing = false;

// ─── Helpers ────────────────────────────────────────────────────────────────

const IMAGE_FAMILY_KEYWORDS = [
  { family: 'steam',  keywords: ['steamcmd'] },
  { family: 'java',   keywords: ['yolks:java'] },
  { family: 'wine',   keywords: ['yolks:wine'] },
  { family: 'source', keywords: ['games:source'] },
  { family: 'mono',   keywords: ['yolks:mono'] },
  { family: 'dotnet', keywords: ['yolks:dotnet'] },
  { family: 'proton', keywords: ['proton'] },
  { family: 'debian', keywords: ['yolks:debian'] },
  { family: 'alpine', keywords: ['alpine'] },
];

function classifyImageFamily(images) {
  const str = (images || []).join(' ').toLowerCase();
  for (const { family, keywords } of IMAGE_FAMILY_KEYWORDS) {
    if (keywords.some((k) => str.includes(k))) return family;
  }
  return 'other';
}

function humanize(slug) {
  return slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Derive a display name from an egg filename (e.g. egg-vanilla-bedrock.json → "Vanilla Bedrock") */
function nameFromFilename(filePath) {
  const base = path.basename(filePath, '.json');
  return base
    .replace(/^egg-/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function getSyncInterval() {
  const val = ctx && ctx.getConfig('syncInterval');
  return typeof val === 'string' && val ? val : 'weekly';
}

// ─── GitHub API client ─────────────────────────────────────────────────────

async function githubFetch(apiPath) {
  const headers = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'Catalyst-EggExplorer',
  };
  const token = ctx?.getConfig('ghToken');
  if (typeof token === 'string' && token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${GITHUB_API}${apiPath}`, { headers });

  // Handle rate-limit with auto-retry
  if (res.status === 403) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    if (remaining === '0') {
      const reset = parseInt(res.headers.get('x-ratelimit-reset') || '0', 10);
      const waitSec = Math.max(1, Math.ceil((reset * 1000 - Date.now()) / 1000));
      ctx?.logger.warn(`GitHub rate limited, waiting ${waitSec}s`);
      await new Promise((r) => setTimeout(r, Math.min(waitSec, 120) * 1000));
      return githubFetch(apiPath);
    }
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`);
  }

  return res.json();
}

/** Get current core rate-limit budget (without spending a request if possible) */
async function getRateLimit() {
  try {
    const token = ctx?.getConfig('ghToken');
    const headers = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'Catalyst-EggExplorer',
    };
    if (typeof token === 'string' && token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch('https://api.github.com/rate_limit', { headers });
    const data = await res.json();
    return data.resources?.core || { remaining: 0, limit: 60, reset: 0 };
  } catch {
    return { remaining: 0, limit: 60, reset: 0 };
  }
}

// ─── Index building ────────────────────────────────────────────────────────

/** Build a browseable index from tree paths alone — no per-file API calls needed. */
function buildBasicIndex(tree) {
  const eggEntries = tree.filter(
    (t) => t.type === 'blob' && t.path.endsWith('.json') && path.basename(t.path).startsWith('egg-'),
  );

  const eggs = eggEntries.map((f) => {
    const rel = f.path;
    const parts = rel.split('/');
    const category = parts[0] || 'other';
    const sub = parts.length > 2 ? parts.slice(1, -1).join('/') : null;

    return {
      id: rel,
      blobSha: f.sha,
      name: nameFromFilename(rel),
      description: '',
      author: 'Unknown',
      category,
      categoryName: humanize(category),
      subcategory: sub,
      subcategoryName: sub ? humanize(sub) : null,
      imageFamily: 'other',
      images: [],
      features: [],
      variableCount: 0,
      variables: [],
      startup: '',
      installImage: null,
      stopCommand: null,
      hasInstallScript: false,
      enriched: false,
    };
  });

  eggs.sort((a, b) => a.name.localeCompare(b.name));
  const categories = buildCategories(eggs);

  return { eggs, categories, totalEggs: eggs.length };
}

function buildCategories(eggs) {
  const catMap = {};
  for (const egg of eggs) {
    if (!catMap[egg.category]) {
      catMap[egg.category] = { count: 0, subs: new Set(), families: new Set() };
    }
    catMap[egg.category].count++;
    if (egg.subcategory) catMap[egg.category].subs.add(egg.subcategory);
    catMap[egg.category].families.add(egg.imageFamily);
  }
  return Object.entries(catMap)
    .map(([id, v]) => ({
      id,
      name: humanize(id),
      count: v.count,
      subcategories: Array.from(v.subs)
        .sort()
        .map((s) => ({ id: s, name: humanize(s) })),
      imageFamilies: Array.from(v.families).sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Parse raw egg JSON and merge into an existing index entry. */
function parseEggData(entry, rawJson) {
  const egg = JSON.parse(rawJson);
  if (!egg.name) return entry;

  const images = egg.docker_images
    ? Object.values(egg.docker_images)
    : Array.isArray(egg.images)
      ? egg.images
      : [];
  const variables = Array.isArray(egg.variables) ? egg.variables : [];
  const features = Array.isArray(egg.features) ? egg.features : [];

  return {
    ...entry,
    name: egg.name,
    description: egg.description || '',
    author: egg.author || 'Unknown',
    imageFamily: classifyImageFamily(images),
    images,
    features,
    variableCount: variables.length,
    variables: variables.slice(0, 10).map((v) => ({
      name: v.env_variable || v.name,
      description: v.description || '',
      default: v.default_value,
      required: v.rules ? v.rules.includes('required') : false,
    })),
    startup: egg.startup || '',
    installImage: egg.scripts?.installation?.container || null,
    stopCommand: egg.config?.stop || null,
    hasInstallScript: !!egg.scripts?.installation?.script,
    enriched: true,
  };
}

/** Fetch a single egg JSON from GitHub and merge into the index entry. */
async function fetchAndParseEgg(entry) {
  const data = await githubFetch(`/contents/${entry.id}`);
  const content = Buffer.from(data.content, 'base64').toString('utf-8');
  return parseEggData(entry, content);
}

// ─── Sync orchestration ────────────────────────────────────────────────────

async function buildIndex() {
  if (isSyncing) return eggIndex;
  isSyncing = true;

  try {
    // 1. Fetch full repo tree (1 API call)
    ctx.logger.info('Fetching repository tree from GitHub…');
    const treeData = await githubFetch('/git/trees/main?recursive=1');
    const treeSha = treeData.sha;

    if (treeData.truncated) {
      ctx.logger.warn('GitHub tree response was truncated — some eggs may be missing.');
    }

    // 2. Check if tree has changed since last sync
    const cachedSha = await ctx.getStorage('treeSha');
    if (cachedSha === treeSha) {
      const cached = await ctx.getStorage('eggIndex');
      if (cached) {
        eggIndex = cached;
        ctx.logger.info(`Tree unchanged (${treeSha.slice(0, 8)}), using cached index`);
        return eggIndex;
      }
    }

    // 3. Build basic index from paths (instant, no extra API calls)
    const basic = buildBasicIndex(treeData.tree);
    eggIndex = basic;
    await ctx.setStorage('eggIndex', basic);
    await ctx.setStorage('treeSha', treeSha);
    ctx.logger.info(`Basic index built: ${basic.totalEggs} eggs from tree`);

    // 4. Background enrichment (non-blocking)
    enrichInBackground(treeData.tree).catch((err) =>
      ctx.logger.error({ err }, 'Background enrichment failed'),
    );

    return eggIndex;
  } catch (err) {
    ctx.logger.error({ err }, 'Failed to build egg index');
    // Return whatever we have (cached index or the basic one from this run)
    return eggIndex;
  } finally {
    isSyncing = false;
  }
}

/** Enrich changed/new eggs in the background. Respects rate limits. */
async function enrichInBackground(tree) {
  const eggTreeEntries = tree.filter(
    (t) => t.type === 'blob' && t.path.endsWith('.json') && path.basename(t.path).startsWith('egg-'),
  );

  // Diff against cached blob SHAs to find only changed files
  const cachedShas = (await ctx.getStorage('blobShas')) || {};
  const newShas = {};
  const toEnrich = [];

  for (const f of eggTreeEntries) {
    newShas[f.path] = f.sha;
    if (cachedShas[f.path] !== f.sha) {
      const idx = eggIndex.eggs.findIndex((e) => e.id === f.path);
      if (idx >= 0) toEnrich.push(eggIndex.eggs[idx]);
    }
  }

  if (toEnrich.length === 0) {
    ctx.logger.info('No changed eggs to enrich');
    await ctx.setStorage('lastSync', new Date().toISOString());
    return;
  }

  const hasToken = typeof ctx.getConfig('ghToken') === 'string' && ctx.getConfig('ghToken').length > 0;
  let batch = toEnrich;

  if (!hasToken) {
    // Rate-limited: budget = remaining - 15 reserved for on-demand detail fetches
    const rate = await getRateLimit();
    const budget = Math.max(0, rate.remaining - 15);
    if (budget <= 0) {
      ctx.logger.warn(`Rate limit exhausted (${rate.remaining} remaining), deferring enrichment`);
      return;
    }
    batch = toEnrich.slice(0, budget);
    ctx.logger.info(`Enriching ${batch.length}/${toEnrich.length} eggs (rate-limited, ${rate.remaining} remaining)`);
  } else {
    ctx.logger.info(`Enriching ${batch.length} changed eggs (with token)`);
  }

  let enrichedCount = 0;
  for (const entry of batch) {
    try {
      const enriched = await fetchAndParseEgg(entry);
      const idx = eggIndex.eggs.findIndex((e) => e.id === entry.id);
      if (idx >= 0) eggIndex.eggs[idx] = enriched;
      enrichedCount++;
    } catch (err) {
      ctx.logger.warn({ path: entry.id, err: err.message }, 'Failed to enrich egg');
    }
  }

  // Rebuild categories with enriched metadata
  eggIndex.categories = buildCategories(eggIndex.eggs);

  // Persist
  await ctx.setStorage('eggIndex', eggIndex);
  await ctx.setStorage('blobShas', newShas);
  await ctx.setStorage('lastSync', new Date().toISOString());

  const totalEnriched = eggIndex.eggs.filter((e) => e.enriched).length;
  ctx.logger.info(
    `Enrichment complete: ${enrichedCount} updated, ${totalEnriched}/${eggIndex.totalEggs} total enriched`,
  );
}

// ─── Route handlers ─────────────────────────────────────────────────────────

function handleListEggs(request, reply) {
  if (!eggIndex) {
    return reply
      .status(503)
      .send({ success: false, error: 'Egg index not ready — try again shortly.' });
  }

  const {
    search,
    category,
    subcategory,
    imageFamily,
    feature,
    page = '1',
    pageSize = '60',
  } = request.query;

  let filtered = eggIndex.eggs;

  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.author.toLowerCase().includes(q) ||
        e.categoryName.toLowerCase().includes(q) ||
        (e.subcategoryName && e.subcategoryName.toLowerCase().includes(q)),
    );
  }
  if (category) filtered = filtered.filter((e) => e.category === category);
  if (subcategory) filtered = filtered.filter((e) => e.subcategory === subcategory);
  if (imageFamily) filtered = filtered.filter((e) => e.imageFamily === imageFamily);
  if (feature) filtered = filtered.filter((e) => e.features.includes(feature));

  const total = filtered.length;
  const p = Math.max(1, parseInt(page, 10) || 1);
  const ps = Math.min(200, Math.max(1, parseInt(pageSize, 10) || 60));
  const start = (p - 1) * ps;

  reply.send({
    success: true,
    data: filtered.slice(start, start + ps),
    pagination: { page: p, pageSize: ps, total, totalPages: Math.ceil(total / ps) },
  });
}

function handleListCategories(_request, reply) {
  if (!eggIndex) {
    return reply
      .status(503)
      .send({ success: false, error: 'Egg index not ready.' });
  }

  reply.send({
    success: true,
    data: eggIndex.categories,
    totalCategories: eggIndex.categories.length,
    totalEggs: eggIndex.totalEggs,
  });
}

async function handleGetEgg(request, reply) {
  const filePath = request.query.path;
  if (!filePath) {
    return reply
      .status(400)
      .send({ success: false, error: 'Missing "path" query parameter.' });
  }

  try {
    const data = await githubFetch(`/contents/${filePath}`);
    const content = Buffer.from(data.content, 'base64').toString('utf-8');
    const egg = JSON.parse(content);
    reply.send({ success: true, data: { ...egg, _filePath: filePath } });
  } catch (err) {
    ctx.logger.warn({ path: filePath, err: err.message }, 'Failed to fetch egg from GitHub');
    reply.status(502).send({ success: false, error: `Failed to fetch egg: ${err.message}` });
  }
}

async function handleSync(_request, reply) {
  if (isSyncing) {
    return reply.send({
      success: true,
      message: 'Sync already in progress.',
      syncing: true,
    });
  }

  buildIndex().catch((err) =>
    ctx.logger.error({ err }, 'Background sync failed'),
  );

  reply.send({ success: true, message: 'Sync started.', syncing: true });
}

async function handleStatus(_request, reply) {
  const lastSync = await ctx.getStorage('lastSync');
  const enrichedCount = eggIndex ? eggIndex.eggs.filter((e) => e.enriched).length : 0;
  const hasToken = typeof ctx.getConfig('ghToken') === 'string' && ctx.getConfig('ghToken').length > 0;

  reply.send({
    success: true,
    data: {
      ready: !!eggIndex,
      syncing: isSyncing,
      totalEggs: eggIndex?.totalEggs ?? 0,
      totalCategories: eggIndex?.categories?.length ?? 0,
      enriched: enrichedCount,
      hasToken,
      lastSync,
    },
  });
}

// ─── Plugin lifecycle ───────────────────────────────────────────────────────

const plugin = {
  async onLoad(context) {
    ctx = context;

    // Load cached index from plugin storage (instant)
    const cached = await ctx.getStorage('eggIndex');
    if (cached) {
      eggIndex = cached;
      const lastSync = await ctx.getStorage('lastSync');
      ctx.logger.info(
        `Loaded ${cached.totalEggs} eggs from cache (last sync: ${lastSync || 'unknown'})`,
      );
    }

    // Register API routes
    ctx.registerRoute({ method: 'GET', url: '/', handler: handleListEggs });
    ctx.registerRoute({ method: 'GET', url: '/categories', handler: handleListCategories });
    ctx.registerRoute({ method: 'GET', url: '/egg', handler: handleGetEgg });
    ctx.registerRoute({ method: 'POST', url: '/sync', handler: handleSync });
    ctx.registerRoute({ method: 'GET', url: '/status', handler: handleStatus });
  },

  async onEnable(context) {
    ctx = context;

    // Sync on enable — tree check is a single API call (~1s), then basic index is ready.
    // Full enrichment happens in the background.
    buildIndex().catch((err) =>
      ctx.logger.error({ err }, 'Enable sync failed'),
    );

    // Schedule automatic sync
    const interval = getSyncInterval();
    const cronMap = {
      daily: '0 3 * * *',
      weekly: '0 3 * * 0',
      monthly: '0 3 1 * *',
    };
    if (cronMap[interval]) {
      ctx.scheduleTask(cronMap[interval], async () => {
        ctx.logger.info(`Scheduled ${interval} sync triggered.`);
        await buildIndex();
      });
      ctx.logger.info(`Scheduled automatic ${interval} sync.`);
    }
  },

  async onDisable() {},

  async onUnload() {
    eggIndex = null;
  },
};

export default plugin;
