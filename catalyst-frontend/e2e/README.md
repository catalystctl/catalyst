# Screenshot Crawl Test

Automated Playwright test that captures screenshots of **every page** in the Catalyst frontend at 1080p.

## How It Works

The route map at the top of `screenshot-crawl.spec.ts` is the **single source of truth**. When you add a new `<Route>` in `App.tsx`, add a corresponding entry to the `STATIC_ROUTES` array (or `PUBLIC_ROUTES` for unauthenticated pages). The crawl logic handles navigation, error recovery, and screenshot naming automatically.

Entity pages (servers, nodes, templates) are **discovered at runtime** — the test resolves the first entity ID from the list page, then walks through every tab/sub-page. No hardcoding of entity IDs.

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

Screenshots land in `screenshots/` as sequentially numbered PNGs:

```
screenshots/
  001-login.png
  002-register.png
  003-forgot-password.png
  004-dashboard.png
  005-profile.png
  006-servers.png
  ...
  020-server-console.png
  021-server-files.png
  022-server-sftp.png
  ...
```

## Adding a New Page

1. Add the `<Route>` in `App.tsx`.
2. Add a matching entry to `STATIC_ROUTES` (or `PUBLIC_ROUTES`) in `screenshot-crawl.spec.ts`:

```ts
{ path: '/my-new-page', label: 'my-new-page' },
```

3. Re-run the test. Done.

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
