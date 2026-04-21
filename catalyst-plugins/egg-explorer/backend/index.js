/**
 * Egg Explorer Plugin — Backend
 *
 * On first load, reads a bundled egg-index.json (pre-built from the repo).
 * Serves it immediately so the frontend is usable in <1s.
 * In the background, clones/pulls the game-eggs repo and re-indexes to
 * get the latest data.
 *
 * Routes (auto-prefixed to /api/plugins/egg-explorer):
 *   GET  /              — paginated egg list with search & filters
 *   GET  /categories    — category tree with counts
 *   GET  /egg?path=…    — full raw egg JSON for a given file
 *   POST /sync          — trigger git pull + re-index (async)
 *   GET  /status        — sync health check
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_URL = 'https://github.com/pterodactyl/game-eggs.git';

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

function getRepoPath() {
  const val = ctx && ctx.getConfig('repoPath');
  return typeof val === 'string' && val ? val : '/tmp/catalyst-game-eggs';
}

function getSyncInterval() {
  const val = ctx && ctx.getConfig('syncInterval');
  return typeof val === 'string' && val ? val : 'weekly';
}

// ─── Bundled index loader ───────────────────────────────────────────────────

async function loadBundledIndex() {
  const bundledPath = path.join(__dirname, 'egg-index.json');
  try {
    const raw = await fs.readFile(bundledPath, 'utf-8');
    const data = JSON.parse(raw);
    ctx.logger.info(
      `Loaded bundled index: ${data.totalEggs} eggs across ${data.categories.length} categories`,
    );
    return data;
  } catch {
    ctx.logger.warn('No bundled egg-index.json found — will need a full sync.');
    return null;
  }
}

// ─── Git operations ─────────────────────────────────────────────────────────

async function syncRepo(repoPath) {
  try {
    await fs.stat(path.join(repoPath, '.git'));
    ctx.logger.info(`Pulling latest changes → ${repoPath}`);
    await execAsync(`git -C "${repoPath}" pull --ff-only`, { timeout: 120_000 });
  } catch {
    ctx.logger.info(`Cloning repo → ${repoPath}`);
    await fs.mkdir(repoPath, { recursive: true });
    await execAsync(`git clone --depth 1 "${REPO_URL}" "${repoPath}"`, {
      timeout: 300_000,
    });
  }
}

// ─── Egg parsing ────────────────────────────────────────────────────────────

async function walkDir(dir, visitor) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(full, visitor);
    } else if (entry.name.startsWith('egg-') && entry.name.endsWith('.json')) {
      await visitor(full);
    }
  }
}

async function parseAllEggs(repoPath) {
  const eggs = [];
  const catMap = {};

  await walkDir(repoPath, async (filePath) => {
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const egg = JSON.parse(raw);
      if (!egg.name) return;

      const rel = path.relative(repoPath, filePath).replace(/\\/g, '/');
      const parts = rel.split('/');
      const category = parts[0] || 'other';
      const sub = parts.length > 2 ? parts.slice(1, -1).join('/') : null;

      const images = egg.docker_images
        ? Object.values(egg.docker_images)
        : Array.isArray(egg.images)
          ? egg.images
          : [];
      const variables = Array.isArray(egg.variables) ? egg.variables : [];
      const features = Array.isArray(egg.features) ? egg.features : [];

      eggs.push({
        id: rel,
        name: egg.name,
        description: egg.description || '',
        author: egg.author || 'Unknown',
        category,
        categoryName: humanize(category),
        subcategory: sub,
        subcategoryName: sub ? humanize(sub) : null,
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
      });

      if (!catMap[category]) {
        catMap[category] = { count: 0, subs: new Set(), families: new Set() };
      }
      catMap[category].count++;
      if (sub) catMap[category].subs.add(sub);
      catMap[category].families.add(classifyImageFamily(images));
    } catch (err) {
      ctx.logger.warn({ file: filePath, err: err.message }, 'Failed to parse egg');
    }
  });

  eggs.sort((a, b) => a.name.localeCompare(b.name));

  const categories = Object.entries(catMap)
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

  return { eggs, categories, totalEggs: eggs.length };
}

// ─── Index build + cache ────────────────────────────────────────────────────

async function buildIndex() {
  if (isSyncing) return eggIndex;
  isSyncing = true;

  try {
    const repoPath = getRepoPath();
    await syncRepo(repoPath);
    const data = await parseAllEggs(repoPath);
    eggIndex = data;
    await ctx.setStorage('eggIndex', data);
    await ctx.setStorage('lastSync', new Date().toISOString());
    ctx.logger.info(
      `Indexed ${data.totalEggs} eggs across ${data.categories.length} categories`,
    );
    return data;
  } catch (err) {
    ctx.logger.error({ err }, 'Failed to build egg index');
    throw err;
  } finally {
    isSyncing = false;
  }
}

// ─── Route handlers ─────────────────────────────────────────────────────────

function handleListEggs(request, reply) {
  if (!eggIndex) {
    return reply
      .status(503)
      .send({ success: false, error: 'Egg index not ready — trigger a sync first.' });
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
  if (!eggIndex) {
    return reply
      .status(503)
      .send({ success: false, error: 'Egg index not ready.' });
  }

  const filePath = request.query.path;
  if (!filePath) {
    return reply
      .status(400)
      .send({ success: false, error: 'Missing "path" query parameter.' });
  }

  const repoPath = getRepoPath();
  const fullPath = path.resolve(path.join(repoPath, filePath));
  const resolvedRepo = path.resolve(repoPath);

  if (!fullPath.startsWith(resolvedRepo + path.sep) && fullPath !== resolvedRepo) {
    return reply
      .status(403)
      .send({ success: false, error: 'Path traversal detected.' });
  }

  try {
    const raw = await fs.readFile(fullPath, 'utf-8');
    const egg = JSON.parse(raw);
    reply.send({ success: true, data: { ...egg, _filePath: filePath } });
  } catch {
    reply.status(404).send({ success: false, error: 'Egg file not found.' });
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
  reply.send({
    success: true,
    data: {
      ready: !!eggIndex,
      syncing: isSyncing,
      totalEggs: eggIndex?.totalEggs ?? 0,
      totalCategories: eggIndex?.categories?.length ?? 0,
      lastSync,
    },
  });
}

// ─── Plugin lifecycle ───────────────────────────────────────────────────────

const plugin = {
  async onLoad(context) {
    ctx = context;

    // Priority order:
    // 1. Plugin storage cache (from a previous live sync)
    // 2. Bundled egg-index.json (ships with the plugin, instant)
    // 3. Nothing — will sync on enable
    const cached = await ctx.getStorage('eggIndex');
    if (cached) {
      eggIndex = cached;
      const lastSync = await ctx.getStorage('lastSync');
      ctx.logger.info(
        `Loaded ${cached.totalEggs} eggs from cache (last sync: ${lastSync || 'unknown'})`,
      );
    } else {
      const bundled = await loadBundledIndex();
      if (bundled) {
        eggIndex = bundled;
      } else {
        ctx.logger.info('No cached or bundled index — will sync on enable.');
      }
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

    // If index is available (bundled or cached), sync in background.
    // If nothing available, block until sync completes.
    if (eggIndex) {
      ctx.logger.info('Index available — starting background sync for latest data.');
      buildIndex().catch((err) =>
        ctx.logger.error({ err }, 'Background sync failed'),
      );
    } else {
      ctx.logger.info('Performing initial egg index sync…');
      try {
        await buildIndex();
      } catch (err) {
        ctx.logger.error(
          { err },
          'Initial sync failed — the user can retry from the UI.',
        );
      }
    }

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

  async onDisable() {
    // Nothing to clean up
  },

  async onUnload() {
    eggIndex = null;
  },
};

export default plugin;
