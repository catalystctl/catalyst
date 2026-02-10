# Screenshot Crawl Test

A comprehensive Playwright test that crawls through the entire Catalyst frontend and automatically captures screenshots of all pages, tabs, and sections.

## Overview

This test suite automatically:
1. **Logs in** as the seeded admin user (`admin@example.com` / `admin123`)
2. **Crawls all main pages** (Dashboard, Servers, Nodes, Templates, Tasks, Alerts)
3. **Navigates through details pages** for servers, nodes, and templates
4. **Captures tabs** like Console, Files, Metrics
5. **Visits admin panels** (Users, System, Audit Logs, etc.)
6. **Tests responsive design** with multiple viewport sizes (Desktop, Tablet, Mobile)

## Running the Tests

### Automatic (Playwright launches the dev server)
```bash
bun run test:screenshots
```

### Headed Mode (See the browser in action)
```bash
bun run test:screenshots:headed
```

### Manual (If you already have the dev server running on port 5173)
```bash
bun run test:e2e -- screenshot-crawl
```

### Run all E2E tests
```bash
bun run test:e2e
```

## Output

Screenshots are automatically saved to the `screenshots/` directory with sequential numbering:
- `screenshots/01-login-page.png`
- `screenshots/02-dashboard-overview.png`
- `screenshots/03-servers-list.png`
- `screenshots/04-server-details.png`
- ... and more

Responsive screenshots are saved as:
- `screenshots/responsive-dashboard-desktop.png`
- `screenshots/responsive-dashboard-tablet.png`
- `screenshots/responsive-dashboard-mobile.png`

## Prerequisites

1. **Database seeded** with admin user
   ```bash
   cd catalyst-backend
   bun run db:seed
   ```

2. **Frontend dev server running** (or configured in playwright.config.ts)
   ```bash
   bun run dev
   ```

3. **Backend API running** (for proper functionality)
   ```bash
   cd ../catalyst-backend
   bun run dev
   ```

4. **Playwright browsers installed**
   ```bash
   bunx playwright install
   ```

## Test Scenarios

### Test 1: Full Frontend Crawl
Systematically visits every page in the application and captures screenshots in order:
- Authentication
- Dashboard overview
- Servers list and details
- Server console and files
- Nodes list and details
- Node metrics
- Templates list and details
- Tasks
- Alerts
- Admin panels (Users, Servers, Templates, Audit Logs, System, Nodes)

**Duration**: ~2-3 minutes  
**Screenshot Count**: 15-20+ screenshots

### Test 2: Responsive Dashboard Snapshots
Captures the dashboard at multiple viewport sizes to verify responsive design:
- Desktop (1920×1080)
- Tablet (1280×720)
- Mobile (414×896)

## Troubleshooting

### "Timeout waiting for database connection"
Ensure PostgreSQL is running:
```bash
docker-compose up -d
```

### "404 Not Found" errors for admin pages
Some admin pages may not exist in your version. The test gracefully handles missing pages with try-catch blocks.

### Screenshots are blank or truncated
Increase `waitForLoadState('networkidle')` timeouts if you have slow network or heavy API calls. Modify in `screenshot-crawl.spec.ts`.

### "Cannot find module '@playwright/test'"
Install Playwright:
```bash
bun install
bunx playwright install
```

## Customization

### Adjust selectors
If your frontend uses different navigation labels, update the selectors in `screenshot-crawl.spec.ts`:
```typescript
// Change these to match your UI
await page.click('a:has-text("Servers")');
await page.click('button:has-text("Console")');
```

### Add more pages
Add new `await page.goto(...)` calls and `takeScreenshot()` calls to capture additional pages:
```typescript
await page.goto('/custom-page');
await takeScreenshot('20-custom-page');
```

### Change screenshot naming
Modify the `takeScreenshot()` function to use custom naming conventions or directories.

## CI/CD Integration

For continuous integration, you can run this in your CI pipeline:
```yaml
# GitHub Actions example
- name: Run screenshot tests
  run: |
    bun install
    cd catalyst-backend && bun run db:seed
    cd ../catalyst-frontend
    bun run test:screenshots
```

Then upload the `screenshots/` directory as artifacts.

## Performance Tips

1. Run with `fullyParallel: false` in playwright.config.ts (already configured) to avoid rate limiting
2. Screenshots are slower than regular tests due to full-page capture—this is expected
3. Use `--headed` mode only for debugging; headless is faster for CI/CD

## Notes

- The `admin@example.com` / `admin123` credentials must exist in your seeded database
- Screenshots are taken **after** `waitForLoadState('networkidle')` for accuracy
- Failed tests will also save a screenshot to `test-results/` for debugging
- The test respects the `.gitignore` file (screenshots/ is typically ignored)
