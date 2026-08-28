# Full-Surface Screenshot Crawler

`capture-all.mjs` is a standalone Playwright script that captures **every page
and every modal** of the Catalyst panel into `docs/screenshots/`. It is a fresh
implementation and shares nothing with `e2e/screenshot-crawl.spec.ts` (the old
screenshot automation, which is left untouched).

## What it captures

1. **Every static route** — auth pages (login, register, forgot/reset password,
   invite acceptance), setup, dashboard, profile, servers, and all 16 admin pages,
   plus the 404 page.
2. **Every entity** — detail pages for all servers (incl. every server tab:
   console, files, sftp, backups, tasks, databases, metrics, alerts, activity,
   mod manager, plugin manager, configuration, users, settings, admin), nodes
   (+ allocations), and templates.
3. **Every tab** — radix `[role=tab]` panel states, the server tab bar
   (including its "More" overflow menu), and URL-based tabs.
4. **Every modal** — no caps: create/edit/delete and other confirm dialogs,
   dropdown-menu actions, per-tab modals, the Ctrl+K search palette, and
   invite signup. Destructive actions are opened and screenshotted but never
   confirmed.
5. Output extras: `docs/screenshots/manifest.json` (every capture, skip and
   failure with reasons) and `index.html` (a visual gallery).

## How it works

- Creates a dedicated `shotbot@catalyst.test` admin directly in the database
  (registration is typically disabled), owns a temporary server so a real
  invite token exists for `/invites/:token`, and **deletes all of it afterwards**.
- Fulfills `/api/auth/me` with a 403 while unauthenticated so public pages
  render instead of being bounced to `/login` by the global 401 interceptor.
- Fulfills SSE endpoints (`*/events`, `*/stream`) with a "retry in 1h" stub so
  no browser↔proxy sockets are held open (long-lived SSE through the Vite proxy
  otherwise starves new page loads).
- Removes the fixed "new version is available" banner, which overlays
  page-header buttons and silently intercepts clicks.
- Recycles its browser page periodically to dodge leaked-socket stalls.

## Usage

Requires the dev stack running (backend `:3000`, frontend `:5173`).

```bash
# from catalyst-frontend/
pnpm screenshots:crawl              # headless, full run (~15 min)
pnpm screenshots:crawl:headed       # watch it work

node scripts/screenshots/capture-all.mjs --only admin          # one section
node scripts/screenshots/capture-all.mjs --debug-page /servers # verbose single page
node scripts/screenshots/capture-all.mjs --max-entity 0        # unlimited entities
node scripts/screenshots/capture-all.mjs --keep-user           # keep bot user for debugging
```

Flags: `--frontend URL`, `--backend URL`, `--out DIR`, `--only auth|user|admin`,
`--max-entity N` (detail pages per entity type; default 3 because dev databases
accumulate hundreds of test templates), `--headed`, `--keep-user`.
