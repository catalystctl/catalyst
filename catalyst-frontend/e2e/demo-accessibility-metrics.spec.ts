import { expect, test } from '@playwright/test';

// Run against Vite with VITE_DEMO_MODE=true.
test('profile API key management is one link', async ({ page }) => {
  await page.goto('/profile');
  const link = page.getByRole('link', { name: 'Manage API Keys' });
  await expect(link).toHaveAttribute('href', '/admin/api-keys');
  await expect(link.locator('button, a')).toHaveCount(0);
  await link.click();
  await expect(page).toHaveURL(/\/admin\/api-keys/);
});

test('file selection has a name and exposes its state', async ({ page }) => {
  await page.goto('/servers/demo-server-1/files');
  const all = page.getByRole('checkbox', { name: 'Select all files' });
  await expect(all).toHaveAttribute('aria-checked', 'false');
  await all.click();
  await expect(all).toHaveAttribute('aria-checked', 'true');
  await all.click();
  await expect(all).toHaveAttribute('aria-checked', 'false');
});

test('demo metrics use realistic history rates and light alert text has contrast', async ({ page }) => {
  await page.goto('/servers/demo-server-1/metrics');
  await expect(page.getByText('0.18 MB/s', { exact: true })).toBeVisible();
  await page.goto('/dashboard');
  const lightMode = page.getByRole('button', { name: 'Light mode' });
  if (await lightMode.isVisible()) await lightMode.click();
  const alert = page.getByText('1 unacknowledged alert', { exact: true });
  await expect(alert).toBeVisible();
  const colors = await alert.evaluate((el) => {
    const s = getComputedStyle(el);
    return { foreground: s.color, background: getComputedStyle(document.body).backgroundColor };
  });
  expect(colors.foreground).not.toBe(colors.background);
  await expect(alert).toHaveClass(/text-foreground/);
});
