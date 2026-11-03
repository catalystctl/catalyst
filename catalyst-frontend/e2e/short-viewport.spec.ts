import { expect, test } from '@playwright/test';

// Run against the demo build (VITE_DEMO_MODE=true) without a backend.
test.describe('short viewport layouts', () => {
  test.use({ viewport: { width: 320, height: 400 }, reducedMotion: 'reduce' });

  test('create user dialog keeps its title and actions visible and its form scrollable', async ({ page }) => {
    await page.goto('/admin/users');
    await page.getByRole('button', { name: 'Create user' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create user' });
    await expect(dialog.getByRole('heading', { name: 'Create user' })).toBeInViewport();
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeInViewport();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeInViewport();
    const bounds = await dialog.boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(400);
    const body = dialog.locator('.overflow-y-auto').first();
    expect(await body.evaluate(el => el.clientHeight)).toBeGreaterThan(100);
    await body.evaluate(el => { el.scrollTop = el.scrollHeight; });
    expect(await body.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
  });

  test('server details provides a usable tab area without clipping the header', async ({ page }) => {
    await page.goto('/servers/demo-server-1/metrics');
    const heading = page.getByRole('heading', { name: 'Metrics' });
    await expect(heading).toBeAttached();
    const sizes = await heading.evaluate(el => {
      const tab = el.closest('.overflow-y-auto')!;
      const workspace = tab.parentElement!;
      const header = workspace.firstElementChild!;
      return { tab: tab.clientHeight, header: header.clientHeight, headerScroll: header.scrollHeight,
        workspace: workspace.clientHeight, workspaceScroll: workspace.scrollHeight };
    });
    expect(sizes.tab).toBeGreaterThanOrEqual(320);
    expect(sizes.header).toBeGreaterThanOrEqual(sizes.headerScroll);
    expect(sizes.workspaceScroll).toBeGreaterThan(sizes.workspace);
    await heading.scrollIntoViewIfNeeded();
    await expect(heading).toBeInViewport();
  });
});
