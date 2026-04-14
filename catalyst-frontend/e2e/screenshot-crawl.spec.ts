import { test, type Page } from '@playwright/test';

/**
 * Route-driven screenshot crawler.
 *
 * Screenshots are saved to docs/screenshots/ organized by category:
 *   auth/        — login, register, forgot-password
 *   user/        — dashboard, profile, servers, server tabs
 *   admin/       — admin pages, nodes, templates
 *
 * Keep the route arrays in sync with App.tsx <Routes>. Entity pages (servers,
 * nodes, templates) are auto-discovered from the list views at runtime.
 *
 * Resolution: 1920×1080 (1080p) only.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Configuration ──────────────────────────────────────────────────────────

// Output everything under docs/screenshots/ at the repo root
const BASE_DIR = path.resolve(__dirname, '../../docs/screenshots');
const CREDS = { email: 'admin@example.com', password: 'admin123' };

// ─── Route Map (single source of truth) ────────────────────────────────────
// Keep this in sync with App.tsx <Routes>.

interface RouteEntry {
  path: string;
  label: string;
  /** Folder under docs/screenshots/ */
  folder: 'auth' | 'user' | 'admin';
}

const ROUTES: RouteEntry[] = [
  // Auth (public)
  { path: '/login', label: 'login', folder: 'auth' },
  { path: '/register', label: 'register', folder: 'auth' },
  { path: '/forgot-password', label: 'forgot-password', folder: 'auth' },
  // User-facing
  { path: '/dashboard', label: 'dashboard', folder: 'user' },
  { path: '/profile', label: 'profile', folder: 'user' },
  { path: '/servers', label: 'servers', folder: 'user' },
  // Admin
  { path: '/admin', label: 'admin-dashboard', folder: 'admin' },
  { path: '/admin/users', label: 'admin-users', folder: 'admin' },
  { path: '/admin/roles', label: 'admin-roles', folder: 'admin' },
  { path: '/admin/servers', label: 'admin-servers', folder: 'admin' },
  { path: '/admin/nodes', label: 'admin-nodes', folder: 'admin' },
  { path: '/admin/templates', label: 'admin-templates', folder: 'admin' },
  { path: '/admin/database', label: 'admin-database', folder: 'admin' },
  { path: '/admin/network', label: 'admin-network', folder: 'admin' },
  { path: '/admin/system', label: 'admin-system', folder: 'admin' },
  { path: '/admin/security', label: 'admin-security', folder: 'admin' },
  { path: '/admin/theme-settings', label: 'admin-theme-settings', folder: 'admin' },
  { path: '/admin/alerts', label: 'admin-alerts', folder: 'admin' },
  { path: '/admin/audit-logs', label: 'admin-audit-logs', folder: 'admin' },
  { path: '/admin/api-keys', label: 'admin-api-keys', folder: 'admin' },
  { path: '/admin/plugins', label: 'admin-plugins', folder: 'admin' },
];

const SERVER_TABS = [
  'console', 'files', 'sftp', 'backups', 'tasks',
  'databases', 'metrics', 'alerts', 'modManager',
  'pluginManager', 'configuration', 'users', 'settings', 'admin',
] as const;

// ─── Helpers ────────────────────────────────────────────────────────────────

let screenshotCount = 0;

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

async function screenshot(page: Page, folder: string, name: string) {
  screenshotCount++;
  const dir = path.join(BASE_DIR, folder);
  ensureDir(dir);
  const file = `${slugify(name)}.png`;
  await page.screenshot({ path: path.join(dir, file), fullPage: true });
  console.log(`  ✓ [${String(screenshotCount).padStart(3, '0')}] ${folder}/${file}`);
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

async function nav(page: Page, pathStr: string): Promise<boolean> {
  try {
    const resp = await page.goto(pathStr, {
      waitUntil: 'domcontentloaded',
      timeout: 15_000,
    });
    if (!resp) return false;
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(800);
    return true;
  } catch {
    console.log(`  ⚠ Navigation to ${pathStr} timed out`);
    await page.waitForTimeout(1000).catch(() => {});
    return false;
  }
}

async function login(page: Page) {
  console.log('\n🔐 Logging in as admin…');
  await nav(page, '/login');
  await page.locator('input[id="email"]').fill(CREDS.email);
  await page.locator('input[id="password"]').fill(CREDS.password);
  await page.locator('button:has-text("Sign in")').first().click({ timeout: 10_000 });
  await page.waitForURL(/\/(servers|dashboard)/, { timeout: 15_000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(800);
  console.log('  ✓ Logged in');
}

function isRealPage(page: Page): boolean {
  return !page.url().includes('/login');
}

async function resolveAllEntityIds(
  page: Page,
  listPath: string,
  linkPattern: string,
): Promise<string[]> {
  await nav(page, listPath);
  const links = page.locator(`a[href*="${linkPattern}"]`);
  const count = await links.count();
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const href = await links.nth(i).getAttribute('href', { timeout: 3_000 }).catch(() => null);
    if (!href) continue;
    const escaped = linkPattern.replace(/\//g, '\\/');
    const match = href.match(new RegExp(`${escaped}([^/?]+)`));
    if (match && !ids.includes(match[1])) {
      ids.push(match[1]);
    }
  }
  return ids;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

test.describe('Screenshot Crawl — All Pages @1080p', () => {
  test.setTimeout(5 * 60 * 1000);

  test.beforeAll(() => {
    // Clean previous output
    if (fs.existsSync(BASE_DIR)) fs.rmSync(BASE_DIR, { recursive: true });
    for (const folder of ['auth', 'user', 'admin']) {
      ensureDir(path.join(BASE_DIR, folder));
    }
  });

  test('Capture every route in the application', async ({ page }) => {
    screenshotCount = 0;

    // ── Public pages ────────────────────────────────────────────────
    console.log('\n📸 === AUTH PAGES ===');
    for (const route of ROUTES.filter(r => r.folder === 'auth')) {
      await nav(page, route.path);
      await screenshot(page, 'auth', route.label);
    }

    // ── Login ───────────────────────────────────────────────────────
    await login(page);

    // ── User pages ──────────────────────────────────────────────────
    console.log('\n📸 === USER PAGES ===');
    for (const route of ROUTES.filter(r => r.folder === 'user')) {
      await nav(page, route.path);
      if (!isRealPage(page)) {
        console.log(`  ⚠ ${route.path} redirected to login (skipped)`);
        continue;
      }
      await screenshot(page, 'user', route.label);
    }

    // ── Admin pages ─────────────────────────────────────────────────
    console.log('\n📸 === ADMIN PAGES ===');
    for (const route of ROUTES.filter(r => r.folder === 'admin')) {
      await nav(page, route.path);
      if (!isRealPage(page)) {
        console.log(`  ⚠ ${route.path} redirected to login (skipped)`);
        continue;
      }
      await screenshot(page, 'admin', route.label);
    }

    // ── ALL servers with ALL tabs ──────────────────────────────────
    console.log('\n📸 === SERVER DETAILS ===');

    const serverIds = await resolveAllEntityIds(page, '/servers', '/servers/');
    console.log(`  Found ${serverIds.length} server(s)`);

    if (serverIds.length === 0) {
      console.log('  ⚠ No servers found — skipping server screenshots');
    }

    for (let si = 0; si < serverIds.length; si++) {
      const serverId = serverIds[si];
      await nav(page, '/servers');
      const serverLink = page.locator(`a[href*="/servers/${serverId}"]`).first();
      let serverName = serverId;
      try {
        const linkText = await serverLink.innerText({ timeout: 3_000 });
        if (linkText.trim()) serverName = linkText.trim();
      } catch { /* fall back to ID */ }

      const prefix = serverIds.length === 1
        ? 'server'
        : `server-${si + 1}-${slugify(serverName)}`;

      console.log(`\n  🖥️  Server: ${serverName} (${serverId})`);

      for (const tab of SERVER_TABS) {
        await nav(page, `/servers/${serverId}/${tab}`);
        if (!isRealPage(page)) {
          console.log(`    ⚠ tab "${tab}" redirected (skipped)`);
          continue;
        }
        await screenshot(page, 'user', `${prefix}-${tab}`);
      }
    }

    // ── ALL nodes ──────────────────────────────────────────────────
    console.log('\n📸 === NODE DETAILS ===');

    const nodeIds = await resolveAllEntityIds(page, '/admin/nodes', '/admin/nodes/');
    console.log(`  Found ${nodeIds.length} node(s)`);

    for (let ni = 0; ni < nodeIds.length; ni++) {
      const nodeId = nodeIds[ni];
      const prefix = nodeIds.length === 1 ? 'node' : `node-${ni + 1}`;

      await nav(page, `/admin/nodes/${nodeId}`);
      if (!isRealPage(page)) continue;
      await screenshot(page, 'admin', `${prefix}-details`);

      await nav(page, `/admin/nodes/${nodeId}/allocations`);
      if (!isRealPage(page)) continue;
      await screenshot(page, 'admin', `${prefix}-allocations`);
    }

    if (nodeIds.length === 0) {
      console.log('  ⚠ No nodes found — skipping node screenshots');
    }

    // ── ALL templates ──────────────────────────────────────────────
    console.log('\n📸 === TEMPLATE DETAILS ===');

    const templateIds = await resolveAllEntityIds(page, '/admin/templates', '/admin/templates/');
    console.log(`  Found ${templateIds.length} template(s)`);

    for (let ti = 0; ti < templateIds.length; ti++) {
      const templateId = templateIds[ti];
      const prefix = templateIds.length === 1 ? 'template' : `template-${ti + 1}`;

      await nav(page, `/admin/templates/${templateId}`);
      if (!isRealPage(page)) continue;
      await screenshot(page, 'admin', `${prefix}-details`);
    }

    if (templateIds.length === 0) {
      console.log('  ⚠ No templates found — skipping template screenshots');
    }

    // ── Summary ─────────────────────────────────────────────────────
    console.log(`\n✅ Done! ${screenshotCount} screenshots → docs/screenshots/`);
    console.log('🖥️  Resolution: 1920×1080 (1080p)');
  });
});
