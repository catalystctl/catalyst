import { test, type Page, type Browser, type BrowserContext, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

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
 *   admin/  — admin pages + one server/node/template detail
 *
 * Resolution: 1920×1080 (1080p).
 */

// The build script (docs/screenshots-site/build.mjs) reads from ../screenshots
// relative to its own location (docs/screenshots-site/), which resolves to
// docs/screenshots/ at the repo root. Use process.cwd() so this is relative
// to where Playwright was invoked (catalyst-frontend/), giving the repo-root path.
const BASE_DIR = path.resolve(process.cwd(), '../docs/screenshots');
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

  // Wait for the login form to be fully rendered
  await page.locator('input[id="email"]').waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('input[id="password"]').waitFor({ state: 'visible', timeout: 5_000 });

  await page.locator('input[id="email"]').fill(CREDS.email);
  await page.locator('input[id="password"]').fill(CREDS.password);

  // Click the Sign in button and wait for navigation away from /login
  const signInBtn = page.locator('button:has-text("Sign in")').first();
  await expect(signInBtn).toBeEnabled({ timeout: 5_000 });
  await signInBtn.click();

  // Wait until we leave /login (successful redirect)
  await page.waitForURL(
    (url) => !url.pathname.includes('/login'),
    { timeout: 15_000 },
  ).catch(() => {});

  // Additional wait for the app shell / sidebar to render
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
  await page.waitForTimeout(1_000);
}

function isAuthed(page: Page) {
  const url = page.url();
  // Not on login, register, forgot-password, or any other auth page
  return !url.includes('/login') && !url.includes('/register') && !url.includes('/forgot-password');
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
    const ok = await navAndWait(page, url);
    if (!ok) {
      console.log(`  ✗ ${folder}/${slugify(name)} — navigation failed`);
      return;
    }
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
  const file = `${slugify(name)}.png`;
  const destPath = path.join(BASE_DIR, folder, file);
  const dir = path.join(BASE_DIR, folder);
  ensureDir(dir);
  await page.screenshot({ path: destPath, fullPage: true });
  console.log(`  ✓ ${folder}/${file}  → ${destPath}`);
}

/**
 * Hide the Tanstack Query devtools button so it doesn't pollute screenshots,
 * then wait briefly for the page to settle.
 */
async function hideDevtoolsAndSettle(page: Page) {
  await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="Open Tanstack query devtools"]') as HTMLElement | null;
    if (btn) btn.style.display = 'none';
  }).catch(() => {});
  await page.waitForTimeout(300);
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
  const count = await links.count({ timeout: 10_000 }).catch(() => 0);
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
// Only includes entities that have actual detail routes in App.tsx
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
  // NOTE: Roles and plugins use modals (not detail routes), so they are omitted.
];

// ─── Setup ────────────────────────────────────────────────────────────────────

async function setupScreenshots() {
  // Ensure all dirs exist. Only clean auth (runs first in every fresh run).
  // User/admin dirs may have screenshots from concurrent workers — don't wipe them.
  for (const folder of ['auth', 'user', 'admin']) {
    const dir = path.join(BASE_DIR, folder);
    ensureDir(dir);
    // Clean auth only (it runs first so it always starts clean)
    if (folder === 'auth') {
      for (const file of fs.readdirSync(dir)) {
        fs.unlinkSync(path.join(dir, file));
      }
    }
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
      const ok = await navAndWait(page, route.path);
      if (!ok) {
        console.log(`  ⚠ ${route.path} — navigation failed (skipped)`);
        return;
      }
      await hideDevtoolsAndSettle(page);
      await screenshotPage(page, route.folder, route.label);
    });
  }
});

// ─── Worker 2: User pages (login + user entity screenshots) ──────────────────

test.describe('📸 User Pages', () => {
  test.setTimeout(3 * 60 * 1000);

  test('Login + static pages', async ({ page }) => {
    test.setTimeout(4 * 60 * 1000); // login + 3 pages in one session
    await page.setViewportSize(RESOLUTION);
    await login(page);

    for (const route of USER_ROUTES) {
      if (!isAuthed(page)) {
        console.log(`  ⚠ ${route.path} — not authenticated (skipped)`);
        continue;
      }
      const ok = await navAndWait(page, route.path);
      if (!ok) {
        console.log(`  ⚠ ${route.path} — navigation failed (skipped)`);
        continue;
      }
      await hideDevtoolsAndSettle(page);
      await screenshotPage(page, route.folder, route.label);
    }
  });

  test('Server detail (one server, every tab)', async ({ page }) => {
    test.setTimeout(4 * 60 * 1000); // 14 tabs × ~10s each + discovery
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
      const ok = await navAndWait(page, base + tab.suffix);
      if (!ok) {
        console.log(`  ⚠ Server tab ${tab.label} — navigation failed (skipped)`);
        continue;
      }
      await hideDevtoolsAndSettle(page);
      await screenshotPage(page, 'user', `server-details-${tab.label}`);
    }
  });
});

// ─── Worker 3: Admin pages (login + admin entity screenshots) ────────────────

test.describe('📸 Admin Pages', () => {
  test.setTimeout(6 * 60 * 1000);

  test('Login + static admin pages', async ({ page }) => {
    await page.setViewportSize(RESOLUTION);
    await login(page);
    if (!isAuthed(page)) return;

    for (const route of ADMIN_ROUTES) {
      const ok = await navAndWait(page, route.path);
      if (!ok) {
        console.log(`  ⚠ ${route.path} — navigation failed (skipped)`);
        continue;
      }
      await hideDevtoolsAndSettle(page);
      await screenshotPage(page, route.folder, route.label);
    }
  });

  test('Admin entity details (one per type)', async ({ page }) => {
    test.setTimeout(8 * 60 * 1000); // server(14 tabs) + node(2) + template(1) = slow
    await page.setViewportSize(RESOLUTION);
    await login(page);
    if (!isAuthed(page)) return;

    for (const entity of ENTITY_CONFIGS) {
      console.log(`\n  ── ${entity.label} ──`);

      // Navigate to the list page and wait for it to settle before looking for links.
      await navAndWait(page, entity.listPath);
      // Small settle time for data tables / async rows to render after nav.
      await page.waitForTimeout(1_000);

      const links = page.locator(`a[href*="${entity.linkPattern}"]`);
      const count = await links.count({ timeout: 15_000 }).catch(() => 0);
      if (count === 0) {
        console.log(`  ⚠ No ${entity.label} found — skipped`);
        continue;
      }

      // Only ever look at the first link
      const href = await links.first().getAttribute('href', { timeout: 3_000 }).catch(() => null);
      if (!href) {
        console.log(`  ⚠ No href found for ${entity.label} — skipped`);
        continue;
      }

      const escaped = entity.linkPattern.replace(/\//g, '\\/');
      const match = href.match(new RegExp(`${escaped}([^/?#]+)`));
      if (!match) {
        console.log(`  ⚠ Could not parse ID from href: ${href}`);
        continue;
      }

      let name = match[1];
      try {
        const text = (await links.first().innerText({ timeout: 2_000 })).trim();
        if (text && text.length < 100) name = text;
      } catch { /* noop */ }

      const item = { id: match[1], name };
      console.log(`  🖥️  ${item.name}`);

      const base = `${entity.detailPrefix}${encodeURIComponent(item.id)}`;

      if (entity.detailTabs && entity.detailTabs.length > 0) {
        for (const tab of entity.detailTabs) {
          const ok = await navAndWait(page, base + tab.suffix);
          if (!ok) {
            console.log(`  ⚠ ${entity.label} tab ${tab.label} — navigation failed (skipped)`);
            continue;
          }
          await hideDevtoolsAndSettle(page);
          await screenshotPage(page, entity.folder, `${entity.label}-${tab.label}`);
        }
      } else {
        const ok = await navAndWait(page, base);
        if (!ok) {
          console.log(`  ⚠ ${entity.label} details — navigation failed (skipped)`);
        } else {
          await hideDevtoolsAndSettle(page);
          await screenshotPage(page, entity.folder, `${entity.label}-details`);
        }
      }
    }
  });
});
