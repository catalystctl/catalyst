import { test, type Page, type Browser, type BrowserContext } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

/**
 * Concurrent screenshot crawler.
 *
 * Architecture:
 *   - Auth pages run in their own worker (no login needed)
 *   - User pages run in their own worker (single login + screenshot one entity per type)
 *   - Admin pages run in their own worker (single login + screenshot one entity per type)
 *
 * Each worker discovers its own entities and screenshots exactly ONE per type.
 * This dramatically speeds up the crawl (3x fewer browser actions) while
 * still covering every route and entity type.
 *
 * Screenshots saved to docs/screenshots/ organized by category:
 *   auth/   — login, register, forgot-password
 *   user/   — dashboard, profile, servers, server tabs
 *   admin/  — admin pages + one server/node/template/role/plugin detail
 *
 * Resolution: 1920×1080 (1080p).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Configuration ────────────────────────────────────────────────────────────
const BASE_DIR = path.resolve(__dirname, '../../docs/screenshots');
const CREDS = { email: 'admin@example.com', password: 'admin123' };
const RESOLUTION = { width: 1920, height: 1080 };

// ─── Shared helpers ──────────────────────────────────────────────────────────

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

async function navAndWait(page: Page, pathStr: string): Promise<boolean> {
  try {
    const resp = await page.goto(pathStr, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    if (!resp) return false;
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(800);
    return true;
  } catch {
    await page.waitForTimeout(1_000).catch(() => {});
    return false;
  }
}

async function login(page: Page) {
  await navAndWait(page, '/login');
  await page.locator('input[id="email"]').fill(CREDS.email);
  await page.locator('input[id="password"]').fill(CREDS.password);
  await page.locator('button:has-text("Sign in")').first().click({ timeout: 10_000 });
  await page.waitForURL(/\/(servers|dashboard)/, { timeout: 15_000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(800);
}

function isAuthed(page: Page) {
  return !page.url().includes('/login');
}

async function screenshot(
  ctx: BrowserContext,
  folder: string,
  name: string,
  url: string,
): Promise<void> {
  const page = await ctx.newPage();
  try {
    await page.setViewportSize(RESOLUTION);
    await navAndWait(page, url);
    const dir = path.join(BASE_DIR, folder);
    ensureDir(dir);
    const file = `${slugify(name)}.png`;
    await page.screenshot({ path: path.join(dir, file), fullPage: true });
    console.log(`  ✓ ${folder}/${file}`);
  } finally {
    await page.close();
  }
}

async function screenshotPage(
  page: Page,
  folder: string,
  name: string,
): Promise<void> {
  const dir = path.join(BASE_DIR, folder);
  ensureDir(dir);
  const file = `${slugify(name)}.png`;
  await page.screenshot({ path: path.join(dir, file), fullPage: true });
  console.log(`  ✓ ${folder}/${file}`);
}

/**
 * Discover up to `maxItems` entity IDs from a list page.
 * Stops after the first one is found if `maxItems` is 1.
 */
async function discoverFirst(
  page: Page,
  listPath: string,
  linkPattern: string,
): Promise<{ id: string; name: string } | null> {
  await navAndWait(page, listPath);

  const links = page.locator(`a[href*="${linkPattern}"]`);
  const count = await links.count();
  if (count === 0) return null;

  // Only ever look at the first link
  const href = await links.first().getAttribute('href', { timeout: 3_000 }).catch(() => null);
  if (!href) return null;

  const escaped = linkPattern.replace(/\//g, '\\/');
  const match = href.match(new RegExp(`${escaped}([^/?#]+)`));
  if (!match) return null;

  let name = match[1];
  try {
    const text = (await links.first().innerText({ timeout: 2_000 })).trim();
    if (text && text.length < 100) name = text;
  } catch { /* noop */ }

  return { id: match[1], name };
}

// ─── Route definitions ────────────────────────────────────────────────────────

interface RouteEntry {
  path: string;
  label: string;
  folder: 'auth' | 'user' | 'admin';
}

const AUTH_ROUTES: RouteEntry[] = [
  { path: '/login', label: 'login', folder: 'auth' },
  { path: '/register', label: 'register', folder: 'auth' },
  { path: '/forgot-password', label: 'forgot-password', folder: 'auth' },
];

const USER_ROUTES: RouteEntry[] = [
  { path: '/dashboard', label: 'dashboard', folder: 'user' },
  { path: '/profile', label: 'profile', folder: 'user' },
  { path: '/servers', label: 'servers', folder: 'user' },
];

const ADMIN_ROUTES: RouteEntry[] = [
  { path: '/admin', label: 'admin-dashboard', folder: 'admin' },
  { path: '/admin/users', label: 'admin-users', folder: 'admin' },
  { path: '/admin/roles', label: 'admin-roles', folder: 'admin' },
  { path: '/admin/servers', label: 'admin-servers', folder: 'admin' },
  { path: '/admin/nodes', label: 'admin-nodes', folder: 'admin' },
  { path: '/admin/templates', label: 'admin-templates', folder: 'admin' },
  { path: '/admin/database', label: 'admin-database', folder: 'admin' },
  { path: '/admin/network', label: 'admin-activity', folder: 'admin' },
  { path: '/admin/system', label: 'admin-system', folder: 'admin' },
  { path: '/admin/security', label: 'admin-security', folder: 'admin' },
  { path: '/admin/theme-settings', label: 'admin-theme-settings', folder: 'admin' },
  { path: '/admin/migration', label: 'admin-migration', folder: 'admin' },
  { path: '/admin/alerts', label: 'admin-alerts', folder: 'admin' },
  { path: '/admin/audit-logs', label: 'admin-audit-logs', folder: 'admin' },
  { path: '/admin/api-keys', label: 'admin-api-keys', folder: 'admin' },
  { path: '/admin/plugins', label: 'admin-plugins', folder: 'admin' },
];

// Entity discovery config — screenshot ONE per type
interface EntityConfig {
  listPath: string;
  linkPattern: string;
  detailPrefix: string;
  detailTabs?: Array<{ suffix: string; label: string }>;
  folder: 'user' | 'admin';
  label: string;
}

const ENTITY_CONFIGS: EntityConfig[] = [
  {
    listPath: '/servers',
    linkPattern: '/servers/',
    detailPrefix: '/servers/',
    detailTabs: [
      { suffix: '', label: 'console' },
      { suffix: '/files', label: 'files' },
      { suffix: '/sftp', label: 'sftp' },
      { suffix: '/backups', label: 'backups' },
      { suffix: '/tasks', label: 'tasks' },
      { suffix: '/databases', label: 'databases' },
      { suffix: '/metrics', label: 'metrics' },
      { suffix: '/alerts', label: 'alerts' },
      { suffix: '/modManager', label: 'modManager' },
      { suffix: '/pluginManager', label: 'pluginManager' },
      { suffix: '/configuration', label: 'configuration' },
      { suffix: '/users', label: 'users' },
      { suffix: '/settings', label: 'settings' },
      { suffix: '/admin', label: 'admin' },
    ],
    folder: 'user',
    label: 'server',
  },
  {
    listPath: '/admin/nodes',
    linkPattern: '/admin/nodes/',
    detailPrefix: '/admin/nodes/',
    detailTabs: [
      { suffix: '', label: 'details' },
      { suffix: '/allocations', label: 'allocations' },
    ],
    folder: 'admin',
    label: 'node',
  },
  {
    listPath: '/admin/templates',
    linkPattern: '/admin/templates/',
    detailPrefix: '/admin/templates/',
    folder: 'admin',
    label: 'template',
  },
  {
    listPath: '/admin/roles',
    linkPattern: '/admin/roles/',
    detailPrefix: '/admin/roles/',
    folder: 'admin',
    label: 'role',
  },
  {
    listPath: '/admin/plugins',
    linkPattern: '/admin/plugin/',
    detailPrefix: '/admin/plugin/',
    folder: 'admin',
    label: 'plugin',
  },
];

// ─── Setup ────────────────────────────────────────────────────────────────────

async function setupScreenshots() {
  if (fs.existsSync(BASE_DIR)) fs.rmSync(BASE_DIR, { recursive: true });
  for (const folder of ['auth', 'user', 'admin']) {
    ensureDir(path.join(BASE_DIR, folder));
  }
}

// ─── Worker 1: Auth pages (no login needed, runs in parallel) ───────────────

test.describe('📸 Auth Pages', () => {
  test.setTimeout(2 * 60 * 1000);

  test.beforeAll(async () => {
    await setupScreenshots();
  });

  for (const route of AUTH_ROUTES) {
    test(`${route.label}`, async ({ page }) => {
      await page.setViewportSize(RESOLUTION);
      await navAndWait(page, route.path);
      await screenshotPage(page, route.folder, route.label);
    });
  }
});

// ─── Worker 2: User pages (login + user entity screenshots) ──────────────────

test.describe('📸 User Pages', () => {
  test.setTimeout(3 * 60 * 1000);

  test('Login + static pages', async ({ page }) => {
    await page.setViewportSize(RESOLUTION);
    await login(page);

    for (const route of USER_ROUTES) {
      if (!isAuthed(page)) {
        console.log(`  ⚠ ${route.path} — not authenticated (skipped)`);
        continue;
      }
      await navAndWait(page, route.path);
      await screenshotPage(page, route.folder, route.label);
    }
  });

  test('Server detail (one server, every tab)', async ({ page }) => {
    await page.setViewportSize(RESOLUTION);
    await login(page);
    if (!isAuthed(page)) return;

    const server = await discoverFirst(page, '/servers', '/servers/');
    if (!server) {
      console.log('  ⚠ No server found — skipped');
      return;
    }
    console.log(`  🖥️  Server: ${server.name}`);

    const base = `/servers/${encodeURIComponent(server.id)}`;

    // Screenshot every tab available for the server
    const serverConfig = ENTITY_CONFIGS.find(e => e.label === 'server')!;
    for (const tab of serverConfig.detailTabs) {
      await navAndWait(page, base + tab.suffix);
      await screenshotPage(page, 'user', `server-details-${tab.label}`);
    }
  });
});

// ─── Worker 3: Admin pages (login + admin entity screenshots) ────────────────

test.describe('📸 Admin Pages', () => {
  test.setTimeout(4 * 60 * 1000);

  test('Login + static admin pages', async ({ page }) => {
    await page.setViewportSize(RESOLUTION);
    await login(page);
    if (!isAuthed(page)) return;

    for (const route of ADMIN_ROUTES) {
      await navAndWait(page, route.path);
      await screenshotPage(page, route.folder, route.label);
    }
  });

  test('Admin entity details (one per type)', async ({ page }) => {
    await page.setViewportSize(RESOLUTION);
    await login(page);
    if (!isAuthed(page)) return;

    for (const entity of ENTITY_CONFIGS) {
      console.log(`\n  ── ${entity.label} ──`);
      const item = await discoverFirst(page, entity.listPath, entity.linkPattern);
      if (!item) {
        console.log(`  ⚠ No ${entity.label} found — skipped`);
        continue;
      }
      console.log(`  🖥️  ${item.name}`);

      const base = `${entity.detailPrefix}${encodeURIComponent(item.id)}`;

      if (entity.detailTabs && entity.detailTabs.length > 0) {
        for (const tab of entity.detailTabs) {
          await navAndWait(page, base + tab.suffix);
          await screenshotPage(page, entity.folder, `${entity.label}-${tab.label}`);
        }
      } else {
        await navAndWait(page, base);
        await screenshotPage(page, entity.folder, `${entity.label}-details`);
      }
    }
  });
});
