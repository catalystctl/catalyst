# Screenshot Crawl Test

Automated Playwright test that **dynamically discovers** and captures screenshots of **every page, tab, and modal** in the Catalyst frontend at 1080p.

## How It Works (Fully Dynamic)

### 1. Route Discovery (Zero Manual Maintenance)
The crawler **parses your source code at test time** to find all routes:
- **`src/App.tsx`** — extracts every `<Route path="...">`
- **`src/components/layout/Sidebar.tsx`** — extracts every `to: '/...'` navigation link

When you add a new page, it is **automatically discovered** — no edits to this test needed.

### 2. Tab Discovery (Detail Pages)
On every page, the crawler scans the DOM for `[role="tab"]` elements:
- **Link-based tabs** (e.g., `/servers/123/files`) → navigates to each URL and screenshots it
- **Button-based tabs** (React state tabs) → clicks each tab, screenshots, then reverts

When you add a new tab to a detail page, it is **automatically screenshotted**.

### 3. Modal Discovery (Dialogs)
On every page, the crawler finds buttons that look like modal triggers (text containing "Create", "New", "Edit", "Configure", etc.), clicks them, and screenshots any dialog that appears:
- Supports Radix Dialog (`[role="dialog"]`)
- Supports Radix AlertDialog (`[role="alertdialog"]`)
- Supports custom `ModalPortal` components
- Automatically closes modals after screenshot (Escape → Cancel → Close button)
- Skips destructive actions (Delete, Remove, Destroy) to avoid unwanted side effects
- Detects navigation vs. modal opening (clicks that change the URL are treated as navigation, not modals)

When you add a new modal, it is **automatically discovered and screenshotted**.

### 4. Entity Detail Pages
The crawler visits list pages (`/servers`, `/admin/nodes`, `/admin/templates`), discovers the first entity ID dynamically, then adds the detail page to the crawl queue. All tabs on that detail page are also discovered automatically.

### 5. Link Following
After screenshotting each page, the crawler collects all internal `<a href="/...">` links and queues any unseen ones. This catches routes that might not be in App.tsx or Sidebar.tsx (e.g., plugin routes).

## Running

```bash
# Headless (default — for CI / automation)
bun run test:screenshots

# Watch the browser live
bun run test:screenshots:headed

# Against an already-running dev server (skip Playwright's built-in server)
SKIP_WEB_SERVER=1 bun run test:screenshots
```

## Output

Screenshots are saved to `docs/screenshots/` organized by category:

```
docs/screenshots/
  auth/
    login.png
    register.png
    forgot-password.png
    ...
  user/
    dashboard.png
    servers.png
    server-myserver-tab-console.png
    server-myserver-tab-files.png
    ...
    modals/
      server-myserver-modal-create-backup.png
      ...
  admin/
    admin-dashboard.png
    admin-users.png
    node-mynode-tab-allocations.png
    ...
    modals/
      admin-users-modal-invite-user.png
      ...
```

## Architecture

Three Playwright workers run in parallel:
1. **Auth worker** — no login needed, screenshots public pages
2. **User worker** — logs in once, crawls all user routes + tabs + modals + entities
3. **Admin worker** — logs in once, crawls all admin routes + tabs + modals + entities

## Prerequisites

- **Stack running**: `docker compose up -d` (or `bun run dev` for backend + frontend)
- **DB seeded**: `docker compose exec backend bun run db:seed`
- **Playwright browsers**: `bunx playwright install`

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Pages redirect to `/login` | Ensure `admin@example.com` / `admin123` exists in DB |
| "No servers/nodes/templates found" | Seed the DB with sample data before running |
| Blank screenshots | Increase `waitForTimeout` or check that the page has content |
| Timeout errors | Run with `SKIP_WEB_SERVER=1` if you manage the dev server yourself |
| Missing modal screenshots | Check that the modal trigger button text matches known keywords (see `discoverModalTriggers`) |
