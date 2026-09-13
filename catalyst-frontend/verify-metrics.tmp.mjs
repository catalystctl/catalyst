import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1562, height: 900 } });
page.on('pageerror', (err) => console.log('PAGEERROR:', String(err).split('\n')[0]));

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('#email', 'admin@example.com');
await page.fill('#password', 'admin123');
await page.click('button[type="submit"]');
await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20000 });

const serverId = await page.evaluate(async () => {
  const res = await fetch('/api/servers?limit=5');
  if (!res.ok) return `servers-api:${res.status}`;
  const data = await res.json();
  const list = Array.isArray(data) ? data : data.servers ?? data.data ?? [];
  return list[0]?.id ?? 'none';
});
console.log('server:', serverId);

await page.goto(`${BASE}/servers/${serverId}/metrics`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/metrics-1-tab.png' });

// Open the time-range dropdown
const trigger = page.getByRole('button', { name: /1 hour/i });
await trigger.click();
await page.waitForTimeout(500);
const menuBox = await page.evaluate(() => {
  const popover = document.querySelector('[data-radix-popper-content-wrapper]');
  if (!popover) return 'NO-POPOVER';
  const card = popover.querySelector('[role="dialog"]');
  const r = (card ?? popover).getBoundingClientRect();
  const header = document.evaluate(
    "string(//h2[contains(., 'Metrics')]/ancestor::div[contains(@class,'rounded-lg')][1]/@class)",
    document, null, XPathResult.STRING_TYPE, null,
  ).stringValue;
  return `menu:x=${Math.round(r.x)} y=${Math.round(r.y)} w=${Math.round(r.width)} h=${Math.round(r.height)} inBody=${popover.parentElement === document.body}`;
});
console.log('menu:', menuBox);
await page.screenshot({ path: '/tmp/metrics-2-menu-open.png' });

// Select 24 hours preset, verify label + menu closes
await page.getByRole('button', { name: /24 hours/i }).click();
await page.waitForTimeout(500);
console.log('trigger after pick:', await page.getByRole('button', { name: /hours/i }).first().textContent());
const menuGone = await page.evaluate(() => !document.querySelector('[data-radix-popper-content-wrapper]'));
console.log('menu closed after pick:', menuGone);
await page.screenshot({ path: '/tmp/metrics-3-picked.png' });

// Reopen, then outside-click closes
await page.getByRole('button', { name: /24 hours/i }).click();
await page.waitForTimeout(400);
await page.mouse.click(400, 500);
await page.waitForTimeout(400);
const menuGone2 = await page.evaluate(() => !document.querySelector('[data-radix-popper-content-wrapper]'));
console.log('menu closed on outside click:', menuGone2);

await browser.close();
console.log('DONE');
