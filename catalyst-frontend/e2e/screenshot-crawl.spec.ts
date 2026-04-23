import { test, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';

/**
 * DYNAMIC SCREENSHOT CRAWLER
 *
 * Automatically discovers and screenshots:
 *   1. Every route      — parsed from App.tsx + Sidebar.tsx
 *   2. Every entity     — ALL servers, ALL nodes, ALL templates (not just one)
 *   3. Every tab        — discovered from DOM [role="tab"]
 *   4. Every modal      — discovered by clicking trigger buttons
 *
 * Output: docs/screenshots/{auth,user,admin}/ + docs/screenshots/{auth,user,admin}/modals/
 */

const BASE_DIR = path.resolve(process.cwd(), '../docs/screenshots');
const CREDS = { email: 'admin@example.com', password: 'admin123' };
const RESOLUTION = { width: 1920, height: 1080 };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80);
}

async function navAndWait(page: Page, pathStr: string): Promise<boolean> {
  try {
    const resp = await page.goto(pathStr, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    if (!resp) return false;
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(600);
    return true;
  } catch {
    return false;
  }
}

async function login(page: Page) {
  await navAndWait(page, '/login');
  await page.locator('input[id="email"]').waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('input[id="password"]').waitFor({ state: 'visible', timeout: 5_000 });
  await page.locator('input[id="email"]').fill(CREDS.email);
  await page.locator('input[id="password"]').fill(CREDS.password);
  await page.locator('button:has-text("Sign in")').first().click();
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15_000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
  await page.waitForTimeout(500);
}

function isAuthed(page: Page) {
  const url = page.url();
  return !url.includes('/login') && !url.includes('/register') && !url.includes('/forgot-password');
}

async function screenshotPage(page: Page, folder: string, name: string) {
  const file = `${slugify(name)}.png`;
  const dir = path.join(BASE_DIR, folder);
  ensureDir(dir);
  await page.screenshot({ path: path.join(dir, file), fullPage: true });
  console.log(`  ✓ ${folder}/${file}`);
}

async function screenshotModal(page: Page, folder: string, name: string) {
  const file = `${slugify(name)}.png`;
  const dir = path.join(BASE_DIR, folder);
  ensureDir(dir);
  await page.screenshot({ path: path.join(dir, file), fullPage: false });
  console.log(`  ✓ ${folder}/${file}  (modal)`);
}

async function hideDevtoolsAndSettle(page: Page) {
  await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="Open Tanstack query devtools"]') as HTMLElement | null;
    if (btn) btn.style.display = 'none';
  }).catch(() => {});
  await page.waitForTimeout(200);
}

/** Skip pages that are still showing "Loading..." */
async function isStuckOnLoading(page: Page): Promise<boolean> {
  const text = await page.locator('body').textContent({ timeout: 2_000 }).catch(() => '');
  return text.trim() === 'Loading...' || text.trim() === '';
}

// ─── Route Discovery ─────────────────────────────────────────────────────────

function discoverRoutesFromAppTsx(): string[] {
  const appPath = path.resolve(process.cwd(), 'src/App.tsx');
  if (!fs.existsSync(appPath)) return [];
  const content = fs.readFileSync(appPath, 'utf-8');
  const routes = new Set<string>();
  const re = /path\s*=\s*(?:"([^"]+)"|'([^']+)'|\{[`"']([^`"']+)[`"']\})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const p = m[1] || m[2] || m[3];
    if (p && !p.includes('*') && !p.includes(':')) routes.add(p);
  }
  return Array.from(routes);
}

function discoverRoutesFromSidebar(): string[] {
  const sidebarPath = path.resolve(process.cwd(), 'src/components/layout/Sidebar.tsx');
  if (!fs.existsSync(sidebarPath)) return [];
  const content = fs.readFileSync(sidebarPath, 'utf-8');
  const routes = new Set<string>();
  const re = /to:\s*(?:'([^']+)'|"([^"]+)")/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const p = m[1] || m[2];
    if (p && !p.includes('*') && !p.includes(':')) routes.add(p);
  }
  return Array.from(routes);
}

function classifyRoute(pathStr: string): 'auth' | 'user' | 'admin' {
  const p = pathStr.startsWith('/') ? pathStr : '/' + pathStr;
  if (p === '/setup') return 'auth';
  if (
    p.startsWith('/login') ||
    p.startsWith('/register') ||
    p.startsWith('/forgot-password') ||
    p.startsWith('/reset-password') ||
    p.startsWith('/two-factor') ||
    p.startsWith('/invites')
  )
    return 'auth';
  if (p.startsWith('/admin')) return 'admin';
  return 'user';
}

interface DiscoveredRoute {
  path: string;
  label: string;
  folder: 'auth' | 'user' | 'admin';
}

function discoverAllRoutes(): DiscoveredRoute[] {
  const raw = new Set([...discoverRoutesFromAppTsx(), ...discoverRoutesFromSidebar()]);
  const routes: DiscoveredRoute[] = [];
  for (const p of raw) {
    const normalized = p.startsWith('/') ? p : '/' + p;
    routes.push({
      path: normalized,
      label: slugify(normalized.replace(/^\//, '').replace(/\//g, '-')),
      folder: classifyRoute(normalized),
    });
  }
  routes.sort((a, b) => a.path.localeCompare(b.path));
  return routes;
}

// ─── Entity Discovery (ALL, not just first) ──────────────────────────────────

interface Entity {
  id: string;
  name: string;
}

async function discoverFirstEntity(
  page: Page,
  listPath: string,
  linkPattern: string,
): Promise<Entity | null> {
  const ok = await navAndWait(page, listPath);
  if (!ok) return null;

  const links = page.locator(`a[href*="${linkPattern}"]`);
  const count = await links.count({ timeout: 10_000 }).catch(() => 0);
  if (count === 0) return null;

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

// ─── Tab Discovery ───────────────────────────────────────────────────────────

async function discoverTabs(page: Page): Promise<Array<{ label: string; href?: string }>> {
  return page.evaluate(() => {
    const tabs: Array<{ label: string; href?: string }> = [];
    const seen = new Set<string>();

    document.querySelectorAll('a[role="tab"]').forEach((el) => {
      const text = el.textContent?.trim() || '';
      const href = (el as HTMLAnchorElement).href;
      if (text && !seen.has(text)) {
        seen.add(text);
        tabs.push({ label: text, href });
      }
    });

    document.querySelectorAll('button[role="tab"]').forEach((el) => {
      const text = el.textContent?.trim() || '';
      if (text && !seen.has(text)) {
        seen.add(text);
        tabs.push({ label: text });
      }
    });

    return tabs;
  });
}

// ─── Modal Discovery ─────────────────────────────────────────────────────────

async function discoverModalTriggers(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const keywords = [
      'create', 'new', 'add', 'edit', 'manage', 'configure', 'settings',
      'transfer', 'deploy', 'reinstall', 'upgrade', 'downgrade',
      'suspend', 'unsuspend', 'restart', 'stop', 'start', 'kill',
    ];
    const dangerous = ['delete', 'remove', 'destroy', 'wipe', 'purge'];

    const buttons = Array.from(document.querySelectorAll('button'));
    const seen = new Set<string>();
    const results: string[] = [];

    for (const btn of buttons) {
      const text = (btn.textContent || '').trim();
      if (!text || text.length > 60 || seen.has(text)) continue;
      if (btn.closest('nav')) continue;
      if (btn.getAttribute('role') === 'tab') continue;
      if (btn.getAttribute('href')?.startsWith('/')) continue;

      const lower = text.toLowerCase();
      const aria = (btn.getAttribute('aria-haspopup') || '').toLowerCase();

      const isTrigger = aria === 'dialog' || aria === 'true' || keywords.some((kw) => lower.includes(kw));
      const isDangerous = dangerous.some((d) => lower.includes(d));

      if (isTrigger && !isDangerous) {
        seen.add(text);
        results.push(text);
      }
    }
    return results;
  });
}

async function tryScreenshotModal(
  page: Page,
  buttonText: string,
  pageLabel: string,
  folder: string,
): Promise<boolean> {
  // Find the button
  let btn = page.getByRole('button', { name: buttonText, exact: false }).first();
  if ((await btn.count()) === 0) {
    btn = page.locator('button').filter({ hasText: new RegExp(buttonText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first();
  }
  if ((await btn.count()) === 0) return false;
  if (!(await btn.isVisible().catch(() => false))) return false;

  // Skip if inside an already-open dialog
  const inDialog = await btn.evaluate((el) => el.closest('[role="dialog"], [role="alertdialog"]') !== null);
  if (inDialog) return false;

  const urlBefore = page.url();
  await btn.click({ timeout: 3_000 }).catch(() => {});
  await page.waitForTimeout(600);

  // If URL changed, it was navigation — go back
  if (page.url() !== urlBefore) {
    await navAndWait(page, urlBefore);
    return false;
  }

  // Check for dialog
  const hasDialog = await page.evaluate(() => {
    return !!(document.querySelector('[role="dialog"]') || document.querySelector('[role="alertdialog"]'));
  });

  if (!hasDialog) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    return false;
  }

  await hideDevtoolsAndSettle(page);
  const modalName = `${pageLabel}-modal-${slugify(buttonText)}`;
  await screenshotModal(page, `${folder}/modals`, modalName);

  // Close modal
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  const stillOpen = await page.evaluate(() => {
    return !!(document.querySelector('[role="dialog"]') || document.querySelector('[role="alertdialog"]'));
  });

  if (stillOpen) {
    await page.locator('button:has-text("Cancel"), [aria-label="Close"]').first().click({ timeout: 2_000 }).catch(() => {});
    await page.waitForTimeout(300);
  }

  // One more Escape just in case
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  return true;
}

// ─── Main Crawl Engine ───────────────────────────────────────────────────────

async function screenshotRoute(
  page: Page,
  route: DiscoveredRoute,
  visited: Set<string>,
  modalSigs: Set<string>,
) {
  if (visited.has(route.path)) return;
  visited.add(route.path);

  console.log(`  📄 ${route.path}`);

  const ok = await navAndWait(page, route.path);
  if (!ok) {
    console.log(`  ✗ ${route.path} — navigation failed`);
    return;
  }

  if (await isStuckOnLoading(page)) {
    console.log(`  ⚠ ${route.path} — stuck on Loading..., skipping`);
    return;
  }

  await hideDevtoolsAndSettle(page);
  await screenshotPage(page, route.folder, route.label);

  // ── Tabs (link-based) ──
  const tabs = await discoverTabs(page);
  for (const tab of tabs) {
    if (!tab.href) continue; // button-based tabs handled per-entity below
    const tabPath = new URL(tab.href).pathname;
    if (visited.has(tabPath)) continue;
    visited.add(tabPath);

    const tabOk = await navAndWait(page, tabPath);
    if (!tabOk) continue;
    if (await isStuckOnLoading(page)) continue;

    await hideDevtoolsAndSettle(page);
    await screenshotPage(page, route.folder, `${route.label}-tab-${slugify(tab.label)}`);
  }

  // ── Modals ──
  await navAndWait(page, route.path);
  await hideDevtoolsAndSettle(page);

  const triggers = await discoverModalTriggers(page);
  // Cap at 8 triggers per page to keep runtime reasonable
  for (const text of triggers.slice(0, 8)) {
    const sig = `${route.path}|${text}`;
    if (modalSigs.has(sig)) continue;

    // Don't re-navigate between triggers — close modal and try next
    const opened = await tryScreenshotModal(page, text, route.label, route.folder);
    if (opened) {
      modalSigs.add(sig);
      console.log(`    🪟 modal: "${text}"`);
    }
  }
}

async function screenshotEntityDetail(
  page: Page,
  entity: Entity,
  basePath: string,
  folder: 'user' | 'admin',
  labelPrefix: string,
  visited: Set<string>,
  modalSigs: Set<string>,
) {
  const detailPath = `${basePath}${encodeURIComponent(entity.id)}`;
  if (visited.has(detailPath)) return;
  visited.add(detailPath);

  console.log(`  📄 ${detailPath} (${entity.name})`);

  const ok = await navAndWait(page, detailPath);
  if (!ok) return;
  if (await isStuckOnLoading(page)) {
    console.log(`  ⚠ ${detailPath} — stuck on Loading..., skipping`);
    return;
  }

  const pageLabel = `${labelPrefix}-${slugify(entity.name)}`;
  await hideDevtoolsAndSettle(page);
  await screenshotPage(page, folder, pageLabel);

  // Discover tabs on the detail page
  const tabs = await discoverTabs(page);
  for (const tab of tabs) {
    if (tab.href) {
      const tabPath = new URL(tab.href).pathname;
      if (visited.has(tabPath)) continue;
      visited.add(tabPath);
      const tabOk = await navAndWait(page, tabPath);
      if (!tabOk || await isStuckOnLoading(page)) continue;
      await hideDevtoolsAndSettle(page);
      await screenshotPage(page, folder, `${pageLabel}-tab-${slugify(tab.label)}`);
    } else {
      // Button-based tab
      const tabBtn = page.locator('button[role="tab"]').filter({ hasText: new RegExp(`^${tab.label}$`, 'i') }).first();
      if (await tabBtn.isVisible().catch(() => false)) {
        await tabBtn.click();
        await page.waitForTimeout(500);
        await hideDevtoolsAndSettle(page);
        await screenshotPage(page, folder, `${pageLabel}-tab-${slugify(tab.label)}`);
        // Revert to detail page
        await navAndWait(page, detailPath);
      }
    }
  }

  // Modals on detail page
  await navAndWait(page, detailPath);
  await hideDevtoolsAndSettle(page);

  const triggers = await discoverModalTriggers(page);
  for (const text of triggers.slice(0, 6)) {
    const sig = `${detailPath}|${text}`;
    if (modalSigs.has(sig)) continue;
    const opened = await tryScreenshotModal(page, text, pageLabel, folder);
    if (opened) {
      modalSigs.add(sig);
      console.log(`    🪟 modal: "${text}"`);
    }
  }
}

async function crawlWorker(
  page: Page,
  routes: DiscoveredRoute[],
  folder: 'auth' | 'user' | 'admin',
  options: {
    discoverEntities?: boolean;
  } = {},
) {
  const visited = new Set<string>();
  const modalSigs = new Set<string>();

  // Screenshot static routes
  for (const route of routes) {
    if (classifyRoute(route.path) !== folder && classifyRoute(route.path) !== 'auth') continue;
    await screenshotRoute(page, route, visited, modalSigs);
  }

  // Discover and screenshot ONE entity per type
  if (options.discoverEntities && folder === 'user') {
    const server = await discoverFirstEntity(page, '/servers', '/servers/');
    if (server) {
      console.log(`\n  🖥️  Server: ${server.name}`);
      await screenshotEntityDetail(page, server, '/servers/', 'user', 'server', visited, modalSigs);
    }
  }

  if (options.discoverEntities && folder === 'admin') {
    const node = await discoverFirstEntity(page, '/admin/nodes', '/admin/nodes/');
    if (node) {
      console.log(`\n  🖥️  Node: ${node.name}`);
      await screenshotEntityDetail(page, node, '/admin/nodes/', 'admin', 'node', visited, modalSigs);
    }

    const template = await discoverFirstEntity(page, '/admin/templates', '/admin/templates/');
    if (template) {
      console.log(`\n  🖥️  Template: ${template.name}`);
      await screenshotEntityDetail(page, template, '/admin/templates/', 'admin', 'template', visited, modalSigs);
    }
  }

  console.log(`\n  ✅ ${folder}: ${visited.size} pages, ${modalSigs.size} modals`);
}

// ─── Setup ───────────────────────────────────────────────────────────────────

async function setupScreenshots() {
  for (const folder of ['auth', 'user', 'admin']) {
    const dir = path.join(BASE_DIR, folder);
    ensureDir(dir);
    for (const file of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        fs.rmSync(fullPath, { recursive: true });
      } else {
        fs.unlinkSync(fullPath);
      }
    }
  }
}

// ─── Route discovery at parse time ───────────────────────────────────────────

const ALL_ROUTES = discoverAllRoutes();
const AUTH_ROUTES = ALL_ROUTES.filter((r) => r.folder === 'auth');
const USER_ROUTES = ALL_ROUTES.filter((r) => r.folder === 'user');
const ADMIN_ROUTES = ALL_ROUTES.filter((r) => r.folder === 'admin');

console.log(`\n📋 Discovered ${ALL_ROUTES.length} routes from source:`);
console.log(`   Auth:  ${AUTH_ROUTES.length}`);
console.log(`   User:  ${USER_ROUTES.length}`);
console.log(`   Admin: ${ADMIN_ROUTES.length}`);

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('📸 Auth Pages', () => {
  test.setTimeout(2 * 60 * 1000);

  test.beforeAll(async () => {
    await setupScreenshots();
  });

  test('crawl auth routes', async ({ page }) => {
    await page.setViewportSize(RESOLUTION);
    for (const route of AUTH_ROUTES) {
      const ok = await navAndWait(page, route.path);
      if (!ok) {
        console.log(`  ⚠ ${route.path} — skipped`);
        continue;
      }
      await hideDevtoolsAndSettle(page);
      await screenshotPage(page, route.folder, route.label);
    }
  });
});

test.describe('📸 User Pages', () => {
  test.setTimeout(10 * 60 * 1000);

  test('crawl user routes + all servers + tabs + modals', async ({ page }) => {
    await page.setViewportSize(RESOLUTION);
    await login(page);
    if (!isAuthed(page)) {
      console.log('  ⚠ Login failed — skipping user crawl');
      return;
    }
    await crawlWorker(page, USER_ROUTES, 'user', { discoverEntities: true });
  });
});

test.describe('📸 Admin Pages', () => {
  test.setTimeout(15 * 60 * 1000);

  test('crawl admin routes + all entities + tabs + modals', async ({ page }) => {
    await page.setViewportSize(RESOLUTION);
    await login(page);
    if (!isAuthed(page)) {
      console.log('  ⚠ Login failed — skipping admin crawl');
      return;
    }
    await crawlWorker(page, ADMIN_ROUTES, 'admin', { discoverEntities: true });
  });
});
