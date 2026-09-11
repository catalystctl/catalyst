import { test, expect } from '@playwright/test';

/**
 * Locale behaviour of the panel shell.
 *
 * These specs only need the sign-in screen, so they run without an
 * authenticated session. The backend is still expected to be reachable
 * because the login page waits for the setup status check.
 */

const LOCALE_STORAGE_KEY = 'catalyst-language';

test.describe('interface language', () => {
  test('switches language, persists it and restores it on reload', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    await page.getByRole('button', { name: 'Language' }).click();
    await page.getByRole('menuitem', { name: '简体中文' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');

    const stored = await page.evaluate((key) => window.localStorage.getItem(key), LOCALE_STORAGE_KEY);
    expect(stored).toBe('zh-CN');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.getByRole('button', { name: '语言' })).toBeVisible();

    await page.getByRole('button', { name: '语言' }).click();
    await page.getByRole('menuitem', { name: 'English' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('detects the browser language on first visit', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'zh-CN' });
    const page = await context.newPage();
    await page.goto('/login');

    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.getByRole('button', { name: '语言' })).toBeVisible();

    await context.close();
  });

  test('switches to French, persists it and restores it on reload', async ({ page }) => {
    await page.goto('/login');

    await page.getByRole('button', { name: 'Language' }).click();
    await page.getByRole('menuitem', { name: 'Français' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');

    const stored = await page.evaluate((key) => window.localStorage.getItem(key), LOCALE_STORAGE_KEY);
    expect(stored).toBe('fr');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.getByRole('button', { name: 'Langue' })).toBeVisible();
  });
});
