#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  Catalyst Full-Surface Screenshot Crawler  (capture-all.mjs)
 * ─────────────────────────────────────────────────────────────────────────────
 *  A standalone crawler that captures EVERY page and EVERY modal of the panel.
 *  It is a fresh implementation — it does not reuse e2e/screenshot-crawl.spec.ts.
 *
 *    1. Every static route      — manifest in code, verified at runtime
 *    2. Every entity            — ALL servers / nodes / templates (via API)
 *    3. Every tab               — radix [role=tab] states, server tab bar
 *                                 (incl. the "More" overflow menu), URL tabs
 *    4. Every modal             — no caps: dialogs, confirm dialogs, dropdown
 *                                 menu items, search palette, invite page…
 *
 *  Output:  docs/screenshots/{auth,user,admin}/  (+ modals/ subfolders)
 *           docs/screenshots/manifest.json  +  index.html gallery
 *
 *  Usage (from catalyst-frontend/):
 *      node scripts/screenshots/capture-all.mjs [--headed] [--keep-user]
 *          [--out DIR] [--frontend URL] [--backend URL] [--only auth|user|admin]
 *          [--max-entity N]
 *
 *  --max-entity caps how many instances of each entity type (servers, nodes,
 *  templates) get detail pages; 0 = unlimited. Default 3 — dev databases tend
 *  to accumulate hundreds of test templates.
 *
 *  Requires the dev stack running (backend :3000, frontend :5173).
 *  Creates a dedicated "Screenshot Bot" admin user and removes it afterwards.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { chromium } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { hashPassword } from 'better-auth/crypto';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Configuration ───────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const optValue = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

const FRONTEND_URL = optValue('frontend', process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const BACKEND_URL = optValue('backend', process.env.BACKEND_URL || 'http://localhost:3000').replace(/\/$/, '');
const ONLY = optValue('only', null); // auth | user | admin
const DEBUG_PAGE = optValue('debug-page', null); // crawl only this path, verbosely
const MAX_ENTITY = Number(optValue('max-entity', 3)); // 0 = unlimited
const HEADLESS = !flag('headed');
const KEEP_USER = flag('keep-user');
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const REPO_ROOT = path.resolve(FRONTEND_ROOT, '..');
const OUT_DIR = path.resolve(optValue('out', path.join(REPO_ROOT, 'docs', 'screenshots')));

const VIEWPORT = { width: 1920, height: 1080 };
const BOT = {
  email: 'shotbot@catalyst.test',
  username: 'shotbot',
  name: 'Screenshot Bot',
  password: 'ShotBot-Trusted-Pass-1!',
};
const NAV_TIMEOUT = 20_000;
const PAGE_SETTLE_MS = 700;
const DIALOG_WAIT_MS = 700;
const PAGE_INTERACTION_BUDGET_MS = 180_000; // safety net per page state

// ─── Small utilities ─────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slugify = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 90) || 'x';
const randToken = (bytes = 24) => crypto.randomBytes(bytes).toString('hex');
const log = (m) => console.log(m);
const warn = (m) => console.warn(`  ⚠ ${m}`);

// ─── Database helpers ────────────────────────────────────────────────────────

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.join(REPO_ROOT, 'catalyst-backend', '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
      const m = line.match(/^\s*DATABASE_URL\s*=\s*"?([^"\n#]+)"?/);
      if (m) return m[1].trim();
    }
  }
  return 'postgresql://catalyst:catalyst@localhost:5432/catalyst';
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: resolveDatabaseUrl() }),
  log: [],
});

/**
 * Create (or refresh) the dedicated Screenshot Bot admin user.
 * Registration is disabled on most instances, so the user is written directly
 * with the same shape better-auth produces (user + credential account).
 */
async function ensureBotUser() {
  const adminRole = await prisma.role.upsert({
    where: { name: 'Administrator' },
    update: { permissions: ['*'] },
    create: { name: 'Administrator', description: 'Full system access', permissions: ['*'] },
  });

  const passwordHash = await hashPassword(BOT.password);
  let user = await prisma.user.findUnique({ where: { email: BOT.email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: BOT.email,
        name: BOT.name,
        username: BOT.username,
        emailVerified: true,
        role: 'administrator',
      },
    });
  }
  await prisma.user.update({
    where: { id: user.id },
    data: {
      name: BOT.name,
      emailVerified: true,
      role: 'administrator',
      banned: false,
      banReason: null,
      banExpires: null,
      roles: { connect: { id: adminRole.id } },
    },
  });
  const account = await prisma.account.findFirst({
    where: { userId: user.id, providerId: 'credential' },
  });
  if (account) {
    await prisma.account.update({ where: { id: account.id }, data: { password: passwordHash } });
  } else {
    await prisma.account.create({
      data: { accountId: user.id, providerId: 'credential', userId: user.id, password: passwordHash },
    });
  }
  log(`  ✓ Bot admin ready: ${BOT.email}`);
  return user;
}

/** Ensure the bot owns a server (so it can mint a real invite) and create one. */
async function ensureBotServerAndInvite(botUser) {
  let server = await prisma.server.findFirst({ where: { ownerId: botUser.id } });
  if (!server) {
    const [node, template, location] = await Promise.all([
      prisma.node.findFirst(),
      prisma.serverTemplate.findFirst(),
      prisma.location.findFirst(),
    ]);
    if (!node || !template || !location) {
      warn('No node/template/location in DB — skipping invite-server creation.');
      return { inviteToken: null };
    }
    server = await prisma.server.create({
      data: {
        uuid: crypto.randomUUID(),
        name: 'Shotbot Test Server',
        description: 'Ephemeral server used by the screenshot crawler',
        templateId: template.id,
        nodeId: node.id,
        locationId: location.id,
        ownerId: botUser.id,
        primaryPort: 25567,
        allocatedMemoryMb: 1024,
        allocatedCpuCores: 1,
      },
    });
    log('  ✓ Bot-owned server created for invite capture');
  }
  let invite = await prisma.serverAccessInvite.findFirst({ where: { serverId: server.id } });
  if (!invite) {
    invite = await prisma.serverAccessInvite.create({
      data: {
        serverId: server.id,
        email: 'invited-friend@catalyst.test',
        token: randToken(),
        permissions: ['server.read', 'console.read'],
        invitedByUserId: botUser.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
    });
  }
  return { inviteToken: invite.token };
}

async function cleanupBotData(botUser) {
  try {
    // All idempotent — a stale concurrent run may have removed these already.
    await prisma.serverAccessInvite.deleteMany({ where: { invitedByUserId: botUser.id } });
    await prisma.server.deleteMany({ where: { ownerId: botUser.id } });
    if (!KEEP_USER) {
      const gone = await prisma.user.deleteMany({ where: { email: BOT.email } });
      log(gone.count ? '  ✓ Bot user and bot-owned data removed' : '  ⚠ Bot user already gone (another run cleaned up?)');
    } else {
      log(`  ⚠ Kept bot user (--keep-user): ${BOT.email}`);
    }
  } catch (e) {
    warn(`Cleanup failed: ${e.message}`);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

// ─── Output helpers ──────────────────────────────────────────────────────────

const SECTIONS = ['auth', 'user', 'admin'];
function ensureDirs() {
  for (const s of SECTIONS) fs.mkdirSync(path.join(OUT_DIR, s, 'modals'), { recursive: true });
}
function cleanPrevious() {
  for (const s of SECTIONS) {
    const dir = path.join(OUT_DIR, s);
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) {
        for (const g of fs.readdirSync(p)) if (g.endsWith('.png')) fs.unlinkSync(path.join(p, g));
      } else if (f.endsWith('.png')) {
        fs.unlinkSync(p);
      }
    }
  }
  for (const f of ['manifest.json', 'index.html']) {
    const p = path.join(OUT_DIR, f);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

const manifest = { generatedAt: null, frontendUrl: FRONTEND_URL, captures: [], failures: [], skipped: [] };
/** Dedupe of captured page states: pathname for URL states, pathname#tab for tab states. */
const seenStates = new Set();

async function shootPage(page, section, name, meta = {}) {
  const file = `${slugify(name)}.png`;
  await page.screenshot({ path: path.join(OUT_DIR, section, file), fullPage: true, animations: 'disabled' });
  manifest.captures.push({ type: 'page', section, file, url: page.url(), name, ...meta });
  log(`  📄 ${section}/${file}`);
}

/** shootPage with state dedupe; returns false when this state was already captured. */
async function shootPageOnce(page, section, name, dedupeKey, meta = {}) {
  const key = dedupeKey ?? new URL(page.url()).pathname;
  if (seenStates.has(key)) return false;
  seenStates.add(key);
  await shootPage(page, section, name, meta);
  return true;
}

async function shootModal(page, section, name, meta = {}) {
  const file = `${slugify(name)}.png`;
  await page.screenshot({ path: path.join(OUT_DIR, section, 'modals', file), animations: 'disabled' });
  manifest.captures.push({ type: 'modal', section, file: `modals/${file}`, url: page.url(), name, ...meta });
  log(`    🪟 ${section}/modals/${file}`);
}

// ─── Browser helpers ─────────────────────────────────────────────────────────

async function gotoSettled(page, url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: attempt === 0 ? NAV_TIMEOUT : 30_000 });
    } catch (e) {
      if (attempt === 0) {
        warn(`navigation to ${url} failed (${String(e.message).split('\n')[0]}) — retrying once`);
        await sleep(2_000);
        continue;
      }
      lastNavError = String(e.message).split('\n')[0];
      return false;
    }
    break;
  }
  await settle(page);
  return true;
}

let lastNavError = null;

/**
 * Remove the "new version is available" banner. It mounts asynchronously after
 * page load as a fixed overlay on top of page-header buttons — every click in
 * that region would be silently intercepted. Runs cheaply, call it often.
 */
async function removeOverlayBanner(page) {
  await page
    .evaluate(() => {
      const leaf = Array.from(document.querySelectorAll('span, div')).find(
        (el) => !el.children.length && /new version is available/i.test(el.textContent || ''),
      );
      if (leaf) {
        let p = leaf;
        while (p.parentElement && getComputedStyle(p).position !== 'fixed') p = p.parentElement;
        p.remove();
      }
    })
    .catch(() => {});
}

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 2_500 }).catch(() => {});
  await page
    .evaluate(async () => {
      await document.fonts?.ready?.catch?.(() => {});
      const devtools = document.querySelector('button[aria-label="Open Tanstack query devtools"]');
      if (devtools) devtools.style.display = 'none';
      document
        .querySelectorAll('[data-sonner-toast], [data-radix-toast-announce]')
        .forEach((el) => el.remove());
    })
    .catch(() => {});
  await removeOverlayBanner(page);
  await sleep(PAGE_SETTLE_MS);
  const stuck = await page
    .waitForFunction(
      () => {
        const t = (document.body?.innerText || '').trim();
        return t !== 'Loading...' && t !== '';
      },
      { timeout: 5_000 },
    )
    .then(() => false)
    .catch(() => true);
  if (stuck) warn(`still showing loading splash at ${page.url()}`);
}

async function hideToasts(page) {
  await page
    .evaluate(() => {
      document.querySelectorAll('[data-sonner-toast], [data-radix-toast-announce]').forEach((el) => el.remove());
    })
    .catch(() => {});
}

async function dialogOpen(page) {
  return page
    .evaluate(() => {
      for (const el of document.querySelectorAll('[role="dialog"], [role="alertdialog"]')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return true;
      }
      return false;
    })
    .catch(() => false);
}

/** Close any open dialog via Escape, then Cancel/X buttons; hard-nav as last resort. */
async function closeAnyDialog(page) {
  for (let attempt = 0; attempt < 3 && (await dialogOpen(page)); attempt++) {
    await page.keyboard.press('Escape');
    await sleep(280);
    if (await dialogOpen(page)) {
      await page
        .evaluate(() => {
          const dlg = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]')).find(
            (el) => el.getBoundingClientRect().height > 0,
          );
          if (!dlg) return;
          const buttons = Array.from(dlg.querySelectorAll('button'));
          const cancel = buttons.find((b) => /^(cancel|close|dismiss|no)$/i.test((b.textContent || '').trim()));
          const x = buttons.find((b) => /close/i.test(b.getAttribute('aria-label') || ''));
          (cancel || x)?.click();
        })
        .catch(() => {});
      await sleep(350);
    }
  }
  if (await dialogOpen(page)) {
    warn(`dialog refuses to close at ${page.url()} — hard navigating`);
    await gotoSettled(page, page.url());
    return false;
  }
  return true;
}

// ─── Trigger discovery & interaction ─────────────────────────────────────────

const ACTION_KEYWORDS =
  /(create|new|add|edit|update|manage|configure|settings|invite|assign|transfer|clone|deploy|install|reinstall|rebuild|import|export|generate|schedule|run now|backup|restore|rollback|connect|preview|change|upload|download|view|details|api|token|webhook|key|location|allocation|variable|startup|docker|java|egg|nest|suspend|unsuspend|restrict|ban|unban|reset|rotate|regenerate|copy|share|move|rename|duplicate|convert|verify|enable|disable|test|unlock|impersonate|delete|remove|destroy|wipe|purge|revoke|kill|force)/i;

// Buttons that act immediately (no dialog) — power actions we must not trigger.
const IMMEDIATE_ACTION =
  /^(start|stop|restart|kill|pause|resume|accept|decline|agree|sign in|sign up|register|log in|log out|logout|sign out|continue|next|back|previous|submit|save|save changes|confirm|refresh|retry|skip)$/i;

/** Enumerate interesting visible buttons on the page. */
async function findTriggers(page) {
  const found = await page
    .evaluate(() => {
      // NOTE: this runs in the browser — no Node-scope references allowed here.
      const ACTION =
        /(create|new|add|edit|update|manage|configure|settings|invite|assign|transfer|clone|deploy|install|reinstall|rebuild|import|export|generate|schedule|run now|backup|restore|rollback|connect|preview|change|upload|download|view|details|api|token|webhook|key|location|allocation|variable|startup|docker|java|egg|nest|suspend|unsuspend|restrict|ban|unban|reset|rotate|regenerate|copy|share|move|rename|duplicate|convert|verify|enable|disable|test|unlock|impersonate|delete|remove|destroy|wipe|purge|revoke|kill|force)/i;
      const nameOf = (el) =>
        (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '')
          .replace(/\s+/g, ' ')
          .trim();
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
      };
      const out = [];
      const seen = new Set();
      for (const el of document.querySelectorAll('button, [role="button"]')) {
        if (!visible(el)) continue;
        if (el.closest('[role="dialog"], [role="alertdialog"], [role="menu"]')) continue;
        const n = nameOf(el);
        if (!n || n.length > 70) continue;
        const key = `${el.getAttribute('aria-haspopup') === 'menu' ? 'menu' : 'btn'}:${n.toLowerCase()}`;
        if (seen.has(key)) continue;
        if (el.getAttribute('role') === 'tab') continue; // handled by the tab pass
        if (el.closest('form') && el.getAttribute('type') === 'submit') continue;
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
        if (el.getAttribute('aria-haspopup') === 'menu') {
          seen.add(key);
          out.push({ name: n, kind: 'menu' });
          continue;
        }
        if (ACTION.test(n)) {
          seen.add(key);
          out.push({ name: n, kind: 'button' });
        }
      }
      // Normal actions first, destructive last (tidier flow, same coverage)
      const danger = /delete|remove|destroy|wipe|purge|revoke|kill|force|suspend|ban|reset|reinstall|restore|rebuild/i;
      out.sort((a, b) => Number(danger.test(b.name)) - Number(danger.test(a.name)));
      return out;
    })
    .catch(() => []);
  if (DEBUG_PAGE) log(`    [debug] triggers(${found.length}): ${found.map((t) => t.kind[0] + ':' + t.name).join(' | ')}`);
  return found;
}

async function clickableHandle(page, trigger) {
  const handle = await page
    .evaluateHandle(
      ({ name, kind }) => {
        const nameOf = (el) =>
          (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '')
            .replace(/\s+/g, ' ')
            .trim();
        const visible = (el) => {
          const r = el.getBoundingClientRect();
          const st = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
        };
        const matches = Array.from(document.querySelectorAll('button, [role="button"]')).filter(
          (el) =>
            visible(el) &&
            !el.closest('[role="dialog"], [role="alertdialog"], [role="menu"]') &&
            nameOf(el) === name &&
            (kind === 'menu' ? el.getAttribute('aria-haspopup') === 'menu' : true),
        );
        return matches[0] ?? null;
      },
      { name: trigger.name, kind: trigger.kind },
    )
    .catch(() => null);
  if (!handle || !(await handle.evaluate((el) => Boolean(el)).catch(() => false))) return null;
  return handle;
}

async function openAndShootDialog(page, section, baseName, triggerLabel) {
  const opened = await page
    .waitForFunction(
      () => {
        for (const el of document.querySelectorAll('[role="dialog"], [role="alertdialog"]')) {
          if (el.getBoundingClientRect().height > 0) return true;
        }
        return false;
      },
      { timeout: DIALOG_WAIT_MS },
    )
    .then(() => true)
    .catch(() => false);
  if (DEBUG_PAGE) log(`    [debug] dialog for '${triggerLabel}': ${opened ? 'OPEN' : 'did not open'}`);
  if (!opened) return false;
  await sleep(350); // entrance animation
  await hideToasts(page);
  await shootModal(page, section, `${baseName}-modal-${triggerLabel}`, { trigger: triggerLabel });
  await closeAnyDialog(page);
  await hideToasts(page);
  return true;
}

/**
 * Interaction pass over the current page state:
 *  - clicks every discovered trigger,
 *  - screenshots dialogs ("modals"),
 *  - explores dropdown menus and their dialog-opening items,
 *  - follows in-page sub-path navigations with a full nested capture.
 */
async function interactionPass(page, section, baseName, depth = 0, budget = PAGE_INTERACTION_BUDGET_MS) {
  const startedAt = Date.now();
  const basePath = new URL(page.url()).pathname;
  const done = new Set();
  await removeOverlayBanner(page); // the banner mounts late and blocks header buttons

  const triggers = await findTriggers(page);
  let count = 0;
  for (const trigger of triggers) {
    if (Date.now() - startedAt > budget) {
      warn(`interaction budget exhausted on ${baseName} — remaining triggers skipped`);
      break;
    }
    if (IMMEDIATE_ACTION.test(trigger.name)) continue;
    const sig = `${trigger.kind}:${trigger.name.toLowerCase()}`;
    if (done.has(sig)) continue;
    done.add(sig);

    if (await dialogOpen(page)) await closeAnyDialog(page);

    const urlBefore = page.url();
    const handle = await clickableHandle(page, trigger);
    if (!handle) continue;
    const clicked = await handle.click({ timeout: 3_000 }).then(() => true).catch(() => false);
    await handle.dispose().catch(() => {});
    if (!clicked) continue;
    await sleep(450);

    const gotDialog = await dialogOpen(page);
    const gotMenu = await page.evaluate(() => Boolean(document.querySelector('[role="menu"]'))).catch(() => false);
    const urlChanged = page.url() !== urlBefore;
    if (DEBUG_PAGE) log(`    [debug] clicked '${trigger.name}' → dialog=${gotDialog} menu=${gotMenu} urlChanged=${urlChanged}`);

    // Case 1: a dialog opened → capture it.
    if (gotDialog && (await openAndShootDialog(page, section, baseName, trigger.name))) {
      count += 1;
      continue;
    }

    // Case 2: a dropdown menu opened → explore its items.
    if (gotMenu) {
      count += await exploreMenu(page, section, baseName, trigger, Math.max(30_000, budget - (Date.now() - startedAt)));
      continue;
    }

    // Case 3: navigation to a sub-path of the current page → treat as URL tab.
    const afterPath = new URL(page.url()).pathname;
    if (page.url() !== urlBefore) {
      if (depth < 1 && afterPath.startsWith(basePath.replace(/\/$/, '') + '/') && afterPath !== basePath) {
        await settle(page);
        const tabName = `${baseName}-tab-${slugify(trigger.name)}`;
        if (await shootPageOnce(page, section, tabName, afterPath, { parent: baseName, tab: trigger.name })) {
          await nestedPasses(page, section, tabName, Math.max(30_000, budget / 3));
          count += 1;
        }
        await gotoSettled(page, urlBefore);
      } else {
        await gotoSettled(page, urlBefore); // navigated elsewhere — go back
      }
    }
    await hideToasts(page);
  }
  return count;
}

/** Open a [role=menu] and try every interesting menu item. */
async function exploreMenu(page, section, baseName, trigger, budgetMs) {
  let count = 0;
  const startedAt = Date.now();
  const items = await page
    .evaluate(() =>
      Array.from(document.querySelectorAll('[role="menu"] [role="menuitem"]'))
        .filter((el) => el.getBoundingClientRect().height > 0)
        .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
        .filter((n) => n && n.length <= 60),
    )
    .catch(() => []);

  for (const item of [...new Set(items)]) {
    if (Date.now() - startedAt > budgetMs) break;
    if (IMMEDIATE_ACTION.test(item) || !ACTION_KEYWORDS.test(item)) continue;

    // Reopen the menu if it closed after the previous item.
    if (!(await page.evaluate(() => Boolean(document.querySelector('[role="menu"]'))).catch(() => false))) {
      const handle = await clickableHandle(page, trigger);
      if (!handle) break;
      await handle.click({ timeout: 2_000 }).catch(() => {});
      await handle.dispose().catch(() => {});
      await sleep(280);
      if (!(await page.evaluate(() => Boolean(document.querySelector('[role="menu"]'))).catch(() => false))) break;
    }

    const itemHandle = await page
      .evaluateHandle(
        (label) =>
          Array.from(document.querySelectorAll('[role="menu"] [role="menuitem"]')).find(
            (el) => (el.textContent || '').replace(/\s+/g, ' ').trim() === label,
          ) ?? null,
        item,
      )
      .catch(() => null);
    const itemEl = itemHandle?.asElement?.() ?? null;
    if (!itemEl) {
      await itemHandle?.dispose().catch(() => {});
      continue;
    }
    const urlBefore = page.url();
    const clicked = await itemEl.click({ timeout: 2_000 }).then(() => true).catch(() => false);
    await itemEl.dispose().catch(() => {});
    if (!clicked) continue;
    await sleep(450);

    if (await openAndShootDialog(page, section, baseName, `${slugify(trigger.name)}-menu-${item}`)) {
      count += 1;
    } else if (page.url() !== urlBefore) {
      await gotoSettled(page, urlBefore);
    }
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(150);
    await hideToasts(page);
  }
  return count;
}

// ─── Tab passes ──────────────────────────────────────────────────────────────

/** Nested captures after arriving at a new page state. */
async function nestedPasses(page, section, stateName, budget) {
  await radixTabPass(page, section, stateName, budget);
  await linkTabPass(page, section, stateName, budget);
  await interactionPass(page, section, stateName, 1, budget);
}

/** Radix-style tabs: click each [role=tab] button, capture the panel state. */
async function radixTabPass(page, section, baseName, budget = PAGE_INTERACTION_BUDGET_MS) {
  const startedAt = Date.now();
  const labels = await page
    .evaluate(() => {
      const nameOf = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
      return [...new Set(
        Array.from(document.querySelectorAll('button[role="tab"]'))
          .filter((el) => el.getBoundingClientRect().height > 0)
          .map(nameOf),
      )];
    })
    .catch(() => []);

  const captured = new Set();
  for (const label of labels) {
    if (captured.has(label) || Date.now() - startedAt > budget) continue;
    captured.add(label);
    const handle = await page
      .evaluateHandle(
        (l) =>
          Array.from(document.querySelectorAll('button[role="tab"]')).find(
            (el) => (el.textContent || '').replace(/\s+/g, ' ').trim() === l && el.getBoundingClientRect().height > 0,
          ) ?? null,
        label,
      )
      .catch(() => null);
    const el = handle?.asElement?.() ?? null;
    if (!el) {
      await handle?.dispose().catch(() => {});
      continue;
    }
    const ok = await el.click({ timeout: 3_000 }).then(() => true).catch(() => false);
    await el.dispose().catch(() => {});
    if (!ok) continue;
    await settle(page);
    const stateKey = `${new URL(page.url()).pathname}#${label}`;
    const tabName = `${baseName}-tab-${slugify(label)}`;
    if (await shootPageOnce(page, section, tabName, stateKey, { tab: label })) {
      await interactionPass(page, section, tabName, 1, Math.min(60_000, budget / 2));
    }
  }
}

/** Link-based tabs: a[role=tab][href] → navigate, capture, come back. */
async function linkTabPass(page, section, baseName, budget = PAGE_INTERACTION_BUDGET_MS) {
  const startedAt = Date.now();
  const tabs = await page
    .evaluate(() =>
      Array.from(document.querySelectorAll('a[role="tab"][href]'))
        .filter((el) => el.getBoundingClientRect().height > 0)
        .map((el) => ({ label: (el.textContent || '').replace(/\s+/g, ' ').trim(), href: el.href })),
    )
    .catch(() => []);
  const seen = new Set();
  for (const t of tabs) {
    if (seen.has(t.href) || Date.now() - startedAt > budget) continue;
    seen.add(t.href);
    const before = page.url();
    if (!(await gotoSettled(page, t.href))) continue;
    const pathKey = new URL(page.url()).pathname;
    const tabName = `${baseName}-tab-${slugify(t.label) || 'tab'}`;
    if (await shootPageOnce(page, section, tabName, pathKey, { tab: t.label })) {
      await interactionPass(page, section, tabName, 1, Math.min(60_000, budget / 2));
    }
    await gotoSettled(page, before);
  }
}

/**
 * The server tab bar (ServerTabBar) renders plain buttons (no role=tab), plus a
 * "More" overflow dropdown. All tab names exist in a hidden measurement area
 * ([data-measure-tab]) — use them, then click the visible button or the menu item.
 */
async function serverTabBarPass(page, section, baseName) {
  const names = await page
    .evaluate(() =>
      Array.from(document.querySelectorAll('[data-measure-tab] button'))
        .map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim())
        .filter((n) => n && !/^more$/i.test(n)),
    )
    .catch(() => []);
  const basePath = new URL(page.url()).pathname;

  for (const name of [...new Set(names)]) {
    const before = page.url();
    let clicked = false;

    // Prefer a visible tab button with this exact label.
    const btn = await page
      .evaluateHandle(
        (label) =>
          Array.from(document.querySelectorAll('button'))
            .filter(
              (el) =>
                el.getBoundingClientRect().height > 0 &&
                (el.textContent || '').replace(/\s+/g, ' ').trim() === label &&
                !el.closest('[role="dialog"], [role="menu"], [data-measure-tab]'),
            )
            .find((el) => !el.getAttribute('aria-haspopup')) ?? null,
        name,
      )
      .catch(() => null);
    if (btn && (await btn.evaluate((el) => Boolean(el)).catch(() => false))) {
      clicked = await btn.click({ timeout: 3_000 }).then(() => true).catch(() => false);
      await btn.dispose().catch(() => {});
    }

    // Overflow tab: open the "More" dropdown and click the menu item.
    if (!clicked) {
      const more = page.locator('button[aria-label="More server pages"]').first();
      if (await more.isVisible().catch(() => false)) {
        await more.click({ timeout: 2_000 }).catch(() => {});
        await sleep(300);
        const item = await page
          .evaluateHandle(
            (label) =>
              Array.from(document.querySelectorAll('[role="menu"] [role="menuitem"]')).find(
                (el) => (el.textContent || '').replace(/\s+/g, ' ').trim() === label,
              ) ?? null,
            name,
          )
          .catch(() => null);
        if (item && (await item.evaluate((el) => Boolean(el)).catch(() => false))) {
          clicked = await item.click({ timeout: 3_000 }).then(() => true).catch(() => false);
        }
        await item?.dispose().catch(() => {});
        if (!clicked) await page.keyboard.press('Escape').catch(() => {});
      }
    }
    if (!clicked) continue;
    await sleep(500);

    const afterPath = new URL(page.url()).pathname;
    if (afterPath !== basePath && afterPath.startsWith(basePath.replace(/\/$/, '') + '/')) {
      await settle(page);
      const tabName = `${baseName}-tab-${slugify(name)}`;
      if (await shootPageOnce(page, section, tabName, afterPath, { tab: name })) {
        await nestedPasses(page, section, tabName, 90_000);
      }
      await gotoSettled(page, before);
    }
  }
}

// ─── Route inventory ─────────────────────────────────────────────────────────

// Exact tab keys from ServerDetailsPage (URLs are /servers/:id/:key).
const SERVER_TAB_KEYS = [
  'console', 'files', 'sftp', 'backups', 'tasks', 'databases', 'metrics', 'alerts',
  'activity', 'modManager', 'pluginManager', 'configuration', 'users', 'settings', 'admin',
];

function staticInventory({ inviteToken }) {
  const auth = [
    { url: '/login', name: 'login' },
    { url: '/register', name: 'register' },
    { url: '/forgot-password', name: 'forgot-password' },
    { url: '/reset-password', name: 'reset-password' },
    { url: '/setup', name: 'setup' },
  ];
  if (inviteToken) auth.push({ url: `/invites/${inviteToken}`, name: 'invites-token' });

  const user = [
    { url: '/dashboard', name: 'dashboard' },
    { url: '/profile', name: 'profile' },
    { url: '/servers', name: 'servers' },
  ];
  const admin = [
    { url: '/admin', name: 'admin' },
    { url: '/admin/users', name: 'admin-users' },
    { url: '/admin/roles', name: 'admin-roles' },
    { url: '/admin/servers', name: 'admin-servers' },
    { url: '/admin/nodes', name: 'admin-nodes' },
    { url: '/admin/templates', name: 'admin-templates' },
    { url: '/admin/database', name: 'admin-database' },
    { url: '/admin/system', name: 'admin-system' },
    { url: '/admin/security', name: 'admin-security' },
    { url: '/admin/theme-settings', name: 'admin-theme-settings' },
    { url: '/admin/alerts', name: 'admin-alerts' },
    { url: '/admin/audit-logs', name: 'admin-audit-logs' },
    { url: '/admin/system-errors', name: 'admin-system-errors' },
    { url: '/admin/api-keys', name: 'admin-api-keys' },
    { url: '/admin/migration', name: 'admin-migration' },
    { url: '/admin/plugins', name: 'admin-plugins' },
  ];
  return { auth, user, admin };
}

async function apiList(page, apiPath) {
  const res = await page.request.get(`${FRONTEND_URL}${apiPath}`, { timeout: 10_000 }).catch(() => null);
  if (!res || !res.ok()) return [];
  const body = await res.json().catch(() => null);
  const data = body?.data ?? body;
  return Array.isArray(data) ? data : [];
}

/** Entity detail pages + plugin routes, discovered from the live session. */
async function dynamicInventory(page, sidebarHrefs) {
  const inv = { user: [], admin: [] };
  const cap = (list, label) => {
    if (!MAX_ENTITY || list.length <= MAX_ENTITY) return list;
    warn(`${label}: ${list.length} found — capturing first ${MAX_ENTITY} (--max-entity to change)`);
    return list.slice(0, MAX_ENTITY);
  };

  for (const s of cap(await apiList(page, '/api/servers'), 'servers')) {
    inv.user.push({ url: `/servers/${s.id}`, name: `server-${s.name}` });
    for (const key of SERVER_TAB_KEYS) {
      inv.user.push({ url: `/servers/${s.id}/${key}`, name: `server-${s.name}-tab-${slugify(key)}` });
    }
  }

  for (const n of cap(await apiList(page, '/api/nodes'), 'nodes')) {
    inv.admin.push({ url: `/admin/nodes/${n.id}`, name: `node-${n.name}` });
    inv.admin.push({ url: `/admin/nodes/${n.id}/allocations`, name: `node-${n.name}-allocations` });
  }

  for (const t of cap(await apiList(page, '/api/templates'), 'templates')) {
    inv.admin.push({ url: `/admin/templates/${t.id}`, name: `template-${t.name}` });
  }

  // Plugin user pages: sidebar links that are not known static routes.
  const known = new Set([
    '/dashboard', '/profile', '/servers', '/tickets', '/admin', '/admin/users', '/admin/roles',
    '/admin/servers', '/admin/nodes', '/admin/templates', '/admin/database', '/admin/system',
    '/admin/security', '/admin/theme-settings', '/admin/alerts', '/admin/audit-logs',
    '/admin/system-errors', '/admin/api-keys', '/admin/migration', '/admin/plugins',
  ]);
  for (const href of sidebarHrefs) {
    const p = new URL(href, FRONTEND_URL).pathname;
    if (known.has(p) || p === '/') continue;
    if (p.startsWith('/servers/') || p.startsWith('/admin/nodes/') || p.startsWith('/admin/templates/')) continue;
    if (p.startsWith('/admin/plugin/')) {
      inv.admin.push({ url: p, name: `admin-plugin-${slugify(p.split('/')[3] ?? 'tab')}` });
      continue;
    }
    inv.user.push({ url: p, name: slugify(p.replace(/^\//, '')) });
  }

  inv.user.push({ url: '/tickets', name: 'tickets' });
  inv.user.push({ url: '/this-page-does-not-exist-404', name: '404-not-found' });
  return inv;
}

async function discoverSidebarHrefs(page) {
  return page
    .evaluate(() => {
      const hrefs = new Set();
      document.querySelectorAll('nav a[href^="/"], aside a[href^="/"]').forEach((a) => hrefs.add(a.getAttribute('href')));
      return [...hrefs];
    })
    .catch(() => []);
}

// ─── Capture pipelines ───────────────────────────────────────────────────────

/**
 * Server pages hold long-lived SSE/WebSocket connections; over dozens of
 * navigations they accumulate and eventually starve the browser's per-host
 * connection pool (new page loads stall → goto timeouts). Recycling the page
 * (same context, so the session cookie survives) clears all of its sockets.
 *
 * SSE endpoints are fulfilled with a "retry in 1h" event-stream stub: pages
 * show as live-connected, but no browser↔proxy socket is ever held open.
 */
const SSE_STUB = 'retry: 3600000\n\n';
const SSE_ROUTES = [
  '**/api/admin/events*',
  '**/api/servers/*/events*',
  '**/api/servers/*/metrics/stream*',
  '**/api/servers/*/console/stream*',
  '**/api/nodes/*/agent/logs/stream*',
];
async function makePage(context, oldPage) {
  if (oldPage) await oldPage.close().catch(() => {});
  const page = await context.newPage();
  page.setDefaultTimeout(NAV_TIMEOUT);
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  page.on('download', (d) => d.cancel().catch(() => {}));
  for (const pattern of SSE_ROUTES) {
    await context
      .route(pattern, (route) => route.fulfill({ status: 200, contentType: 'text/event-stream', body: SSE_STUB }))
      .catch(() => {});
  }
  return page;
}

let pagesRecycled = 0;
async function recyclePage(page) {
  pagesRecycled += 1;
  return makePage(page.context(), page);
}

async function captureUnauthed(page, routes) {
  log('\n🔒 Auth pages (unauthenticated)');
  for (const r of routes) {
    if (!(await gotoSettled(page, `${FRONTEND_URL}${r.url}`))) {
      manifest.failures.push({ url: r.url, reason: `navigation failed${lastNavError ? `: ${lastNavError}` : ''}` });
      continue;
    }
    const finalPath = new URL(page.url()).pathname;
    if (finalPath !== r.url.split('?')[0]) {
      manifest.skipped.push({ url: r.url, reason: `redirected to ${finalPath}` });
      warn(`${r.url} redirected to ${finalPath} — skipped`);
      continue;
    }
    await shootPageOnce(page, 'auth', r.name, `auth:${r.url}`);
    await interactionPass(page, 'auth', r.name, 0, 90_000);
  }
}

/** Returns the (possibly recycled) page so callers never hold a dead page. */
async function captureLoggedIn(page, inv) {
  let shotsSinceRecycle = 0;
  for (const [section, routes] of [['user', inv.user], ['admin', inv.admin]]) {
    if (ONLY && ONLY !== section) continue;
    log(`\n📁 ${section.toUpperCase()} pages (${routes.length} routes)`);
    for (const r of routes) {
      // Skip states we already captured without paying for a navigation.
      const wantedPath = new URL(r.url, FRONTEND_URL).pathname;
      if (seenStates.has(wantedPath)) {
        manifest.skipped.push({ url: r.url, reason: 'already captured' });
        continue;
      }
      try {
        if (!(await gotoSettled(page, `${FRONTEND_URL}${r.url}`))) {
          manifest.failures.push({ url: r.url, reason: `navigation failed${lastNavError ? `: ${lastNavError}` : ''}` });
          warn(`${r.url} — navigation failed, recycling page`);
          page = await recyclePage(page); // stale sockets stall new loads — start fresh
          continue;
        }
        // Proactively recycle: each server page leaks SSE sockets until reload.
        if (++shotsSinceRecycle >= 18) {
          page = await recyclePage(page);
          shotsSinceRecycle = 0;
        }
        const finalPath = new URL(page.url()).pathname;
        if (finalPath !== wantedPath) {
          if (finalPath === '/login') {
            warn(`${r.url} — session died (redirected to /login), re-authenticating`);
            await loginViaUi(page);
            await gotoSettled(page, `${FRONTEND_URL}${r.url}`);
            if (new URL(page.url()).pathname !== wantedPath) {
              manifest.skipped.push({ url: r.url, reason: `not accessible (landed on ${page.url()})` });
              continue;
            }
          } else {
            const parent = wantedPath.replace(/\/[^/]+$/, '');
            if (r.url.split('/').length > 2 && !finalPath.startsWith(parent)) {
              manifest.skipped.push({ url: r.url, reason: `redirected to ${finalPath} (not available)` });
              continue;
            }
          }
        }
        if (!(await shootPageOnce(page, section, r.name, finalPath))) {
          manifest.skipped.push({ url: r.url, reason: `state already captured (${finalPath})` });
          continue;
        }
        // Order matters: URL tab bars first, then radix tabs, then modal triggers.
        await serverTabBarPass(page, section, r.name);
        await radixTabPass(page, section, r.name);
        await linkTabPass(page, section, r.name);
        await interactionPass(page, section, r.name);
      } catch (e) {
        const reason = String(e?.message || e).split('\n')[0];
        manifest.failures.push({ url: r.url, reason: `capture error: ${reason}` });
        warn(`${r.url} — capture error: ${reason}, recycling page`);
        page = await recyclePage(page);
      }
    }
  }
  return page;
}

/** Special capture: the global search palette via Ctrl+K. */
async function captureSearchPalette(page) {
  if (ONLY && ONLY !== 'user') return;
  if (!(await gotoSettled(page, `${FRONTEND_URL}/dashboard`))) return;
  await page.keyboard.press('ControlOrMeta+k');
  await sleep(600);
  if (await dialogOpen(page)) {
    await shootModal(page, 'user', 'dashboard-modal-search-palette', { trigger: 'Ctrl+K' });
    await page.keyboard.press('Escape');
    await sleep(200);
  }
}

// ─── Login ───────────────────────────────────────────────────────────────────

async function loginViaUi(page) {
  await gotoSettled(page, `${FRONTEND_URL}/login`);
  await page.locator('input#email').fill(BOT.email);
  await page.locator('input#password').fill(BOT.password);
  await page.getByRole('button', { name: /sign in/i }).first().click();
  await page.waitForURL((u) => !String(u).includes('/login'), { timeout: 20_000 }).catch(() => {});
  if (page.url().includes('/login')) throw new Error('Login as bot user failed');
  log('  ✓ Logged in as bot admin');
}

// ─── Gallery (index.html) ────────────────────────────────────────────────────

function writeGallery() {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const bySection = {};
  for (const c of manifest.captures) (bySection[c.section] ??= []).push(c);
  const cards = Object.entries(bySection)
    .map(([section, caps]) => {
      const items = caps
        .map(
          (c) => `<figure>
            <a href="${esc(c.section)}/${esc(c.file)}" target="_blank">
              <img loading="lazy" src="${esc(c.section)}/${esc(c.file)}" alt="${esc(c.name)}" />
            </a>
            <figcaption>${esc(c.name)}${c.trigger ? ` <span class="trigger">modal: ${esc(c.trigger)}</span>` : ''}</figcaption>
          </figure>`,
        )
        .join('\n');
      return `<h2 id="${esc(section)}">${esc(section)} <small>${caps.length} captures</small></h2>\n<div class="grid">${items}</div>`;
    })
    .join('\n');
  const html = `<!doctype html>
<html><head><meta charset="utf-8" /><title>Catalyst screenshots — ${manifest.captures.length} captures</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0b0e14; color: #e6e6e6; margin: 2rem; }
  h1 small, h2 small { opacity: .5; font-weight: normal; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1rem; }
  figure { margin: 0; background: #12161f; border: 1px solid #232a37; border-radius: 10px; overflow: hidden; }
  figure img { width: 100%; height: 180px; object-fit: cover; object-position: top left; display: block; }
  figcaption { padding: .5rem .75rem; font-size: .8rem; word-break: break-all; }
  .trigger { opacity: .6; display: block; }
</style></head>
<body>
<h1>Catalyst screenshots <small>${manifest.captures.length} captures · ${new Date(manifest.generatedAt).toLocaleString()}</small></h1>
${cards}
</body></html>`;
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), html);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const startedAt = Date.now();
  log('📸 Catalyst full-surface screenshot crawler');
  log(`   frontend: ${FRONTEND_URL}\n   backend:  ${BACKEND_URL}\n   output:   ${OUT_DIR}`);

  ensureDirs();
  cleanPrevious();

  log('\n🛠  Preparing bot admin + invite data…');
  const botUser = await ensureBotUser();
  const { inviteToken } = await ensureBotServerAndInvite(botUser);
  if (inviteToken) log('  ✓ Invite token created for /invites capture');

  const browser = await chromium.launch({ headless: HEADLESS, slowMo: HEADLESS ? 0 : 80 });
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  let page = await makePage(context);

  try {
    const inv = staticInventory({ inviteToken });

    // Public pages (/register, /forgot-password, /invites/…) bounce to /login on
    // this build: the global 401 interceptor treats the anonymous /api/auth/me
    // probe as a dead session and redirects. Fulfill that one endpoint with 403
    // (which does not trigger the interceptor) so auth pages render normally.
    await context.route('**/api/auth/me', (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'anonymous (screenshot crawler)' }),
      }),
    );

    if (!ONLY || ONLY === 'auth') {
      await captureUnauthed(page, inv.auth);
    }

    await context.unroute('**/api/auth/me');

    log('\n🔐 Logging in…');
    await loginViaUi(page);
    await settle(page); // let the app shell finish before discovery

    const sidebarHrefs = await discoverSidebarHrefs(page);
    log(`  ↳ sidebar links discovered: ${sidebarHrefs.length}`);
    const dyn = await dynamicInventory(page, sidebarHrefs);
    log(`  ↳ routes: ${dyn.user.length} user, ${dyn.admin.length} admin`);
    inv.user.push(...dyn.user);
    inv.admin.push(...dyn.admin);

    if (DEBUG_PAGE) {
      log(`\n🐞 DEBUG crawl of ${DEBUG_PAGE}`);
      await gotoSettled(page, `${FRONTEND_URL}${DEBUG_PAGE}`);
      await shootPageOnce(page, 'user', 'debug-page', `debug:${DEBUG_PAGE}`);
      await serverTabBarPass(page, 'user', 'debug-page');
      await radixTabPass(page, 'user', 'debug-page');
      await linkTabPass(page, 'user', 'debug-page');
      await interactionPass(page, 'user', 'debug-page');
    } else {
      page = await captureLoggedIn(page, inv);
      await captureSearchPalette(page);
    }
  } finally {
    await browser.close().catch(() => {});
    log('\n🧹 Cleaning up bot data…');
    await cleanupBotData(botUser);
  }

  manifest.generatedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  writeGallery();

  const pages = manifest.captures.filter((c) => c.type === 'page').length;
  const modals = manifest.captures.filter((c) => c.type === 'modal').length;
  log('\n═══════════════════════════════════════════════');
  log(`✅ Done in ${((Date.now() - startedAt) / 1000).toFixed(0)}s`);
  log(`   pages:  ${pages}\n   modals: ${modals}\n   total:  ${manifest.captures.length}`);
  if (manifest.failures.length) {
    log(`   failures: ${manifest.failures.length}`);
    for (const f of manifest.failures) log(`     ✗ ${f.url} — ${f.reason}`);
  }
  if (manifest.skipped.length) log(`   skipped:  ${manifest.skipped.length} (see manifest.json)`);
  if (pagesRecycled) log(`   recycled: ${pagesRecycled} page(s) to dodge SSE socket exhaustion`);
  log(`   output:   ${OUT_DIR}`);
  log('   gallery:  docs/screenshots/index.html');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
