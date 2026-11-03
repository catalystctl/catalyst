import { expect, test } from '@playwright/test';

// Run against a demo-mode Vite server (VITE_DEMO_MODE=true), without a backend.
test.describe('navigation layout', () => {
  test('sections dialog scrolls on a short viewport and selects only the deepest destination', async ({ page }) => {
    await page.goto('/admin/plugins/marketplace');
    await page.getByRole('button', { name: 'Collapse navigation' }).click();
    await page.getByRole('button', { name: 'All sections' }).click();
    await page.setViewportSize({ width: 320, height: 400 });

    const dialog = page.getByRole('dialog', { name: 'All sections' });
    await expect(dialog.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(dialog.getByRole('link', { name: 'Marketplace' })).toHaveAttribute('aria-current', 'page');
    const body = dialog.locator('.overflow-y-auto');
    const dimensions = await body.evaluate((el) => ({ height: el.clientHeight, scrollHeight: el.scrollHeight }));
    expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.height);
    const lastLink = dialog.getByRole('link').last();
    await lastLink.scrollIntoViewIfNeeded();
    const [bodyBox, lastBox, dialogBox] = await Promise.all([body.boundingBox(), lastLink.boundingBox(), dialog.boundingBox()]);
    expect(bodyBox).not.toBeNull();
    expect(lastBox).not.toBeNull();
    expect(dialogBox).not.toBeNull();
    expect(lastBox!.y + lastBox!.height).toBeLessThanOrEqual(bodyBox!.y + bodyBox!.height + 1);
    expect(dialogBox!.y).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(400);
  });

  test('narrow breadcrumbs do not overlap and remain scrollable', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 400 });
    await page.goto('/admin/plugins/marketplace');
    const nav = page.getByRole('navigation', { name: 'Breadcrumb' });
    const layout = await nav.evaluate((el) => ({
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
      boxes: Array.from(el.children, (child) => {
        const rect = child.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      }),
    }));
    expect(layout.scrollWidth).toBeGreaterThan(layout.clientWidth);
    for (let i = 1; i < layout.boxes.length; i++) {
      expect(layout.boxes[i].left).toBeGreaterThanOrEqual(layout.boxes[i - 1].right);
    }
    await nav.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
    expect(await nav.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  });
});
