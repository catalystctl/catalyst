import { expect, test } from '@playwright/test';

// Guards the "text touching the border" class of defect: a hand-rolled
// <textarea> that copies the deck field chrome but drops its vertical padding,
// or that sets a fixed h-* (which silently overrides the intrinsic `rows`
// height and collapses a multi-line editor to one line).
//
// Run against the demo build (VITE_DEMO_MODE=true) without a backend:
//   VITE_DEMO_MODE=true pnpm exec playwright test e2e/form-field-padding.spec.ts --project=chromium

type BoxMetrics = {
  rows: number;
  height: number;
  paddingTop: number;
  paddingBottom: number;
  paddingLeft: number;
};

const MIN_VERTICAL_PADDING = 6;

async function metrics(locator: import('@playwright/test').Locator): Promise<BoxMetrics> {
  return locator.evaluate((el) => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return {
      rows: (el as HTMLTextAreaElement).rows,
      height: rect.height,
      paddingTop: parseFloat(style.paddingTop),
      paddingBottom: parseFloat(style.paddingBottom),
      paddingLeft: parseFloat(style.paddingLeft),
    };
  });
}

function expectComfortablePadding(box: BoxMetrics, label: string) {
  expect(box.paddingTop, `${label} must not sit against the top border`).toBeGreaterThanOrEqual(
    MIN_VERTICAL_PADDING
  );
  expect(box.paddingBottom, `${label} must not sit against the bottom border`).toBeGreaterThanOrEqual(
    MIN_VERTICAL_PADDING
  );
  expect(box.paddingLeft, `${label} must not sit against the left border`).toBeGreaterThanOrEqual(8);
}

test.describe('form field padding', () => {
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

  test('custom CSS editor is padded and honours its row count', async ({ page }) => {
    await page.goto('/admin/theme-settings');
    await page.getByRole('button', { name: 'Advanced', exact: true }).click();

    const editor = page.getByRole('textbox', { name: 'Custom CSS' });
    await expect(editor).toBeVisible();

    const box = await metrics(editor);
    expectComfortablePadding(box, 'Custom CSS');
    expect(box.rows).toBe(14);
    // A fixed h-8 would pin this to 32px no matter what `rows` says.
    expect(box.height, 'Custom CSS must not be collapsed to a single line').toBeGreaterThan(150);
  });

  test('import theme field is padded and honours its row count', async ({ page }) => {
    await page.goto('/admin/theme-settings');
    await page.getByRole('button', { name: 'Share', exact: true }).click();

    const field = page.getByRole('textbox', { name: 'Import Theme' });
    await expect(field).toBeVisible();

    const box = await metrics(field);
    expectComfortablePadding(box, 'Import Theme');
    expect(box.rows).toBe(8);
    expect(box.height, 'Import Theme must not be collapsed to a single line').toBeGreaterThan(100);
  });

  test('template editor textareas are padded', async ({ page }) => {
    await page.goto('/admin/templates');
    await page.getByRole('button', { name: 'New Template' }).click();

    const dialog = page.getByRole('dialog', { name: 'Create template' });
    await expect(dialog).toBeVisible();

    const textareas = dialog.locator('textarea');
    const count = await textareas.count();
    expect(count, 'Create template should expose its multi-line fields').toBeGreaterThanOrEqual(3);

    for (let index = 0; index < count; index += 1) {
      const field = textareas.nth(index);
      const label = (await field.getAttribute('aria-label')) ?? `textarea[${index}]`;
      expectComfortablePadding(await metrics(field), label);
      expect(
        await field.evaluate((el) => (el as HTMLTextAreaElement).rows),
        `${label} must keep at least two rows`
      ).toBeGreaterThanOrEqual(2);
    }
  });
});