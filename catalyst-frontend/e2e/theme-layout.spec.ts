import { expect, test } from '@playwright/test';

// Guards two Theme settings layout regressions that were invisible in code
// review but obvious on screen:
//  - the Brand tab's Theme Mode grid was left unclosed, so the whole CPU
//    Display section became a grid *cell* and rendered at half width;
//  - the Colors tab's hex inputs could not shrink, so the panel scrolled
//    horizontally below ~1340px.
//
// Run against the demo build (VITE_DEMO_MODE=true) without a backend:
//   VITE_DEMO_MODE=true pnpm exec playwright test e2e/theme-layout.spec.ts --project=chromium

test.describe('theme settings layout', () => {
  test('cpu display section spans the panel instead of one grid cell', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/admin/theme-settings');
    await page.getByRole('button', { name: 'Brand', exact: true }).click();

    const geometry = await page.evaluate(() => {
      const select = document.querySelector('#cpu-display-format') as HTMLElement | null;
      if (!select) return null;
      const cell = select.closest('.grid') as HTMLElement | null;
      // The panel body is the column container that holds the section's grid.
      const panel = cell?.parentElement as HTMLElement | null;
      return {
        cellWidth: cell ? Math.round(cell.getBoundingClientRect().width) : 0,
        panelWidth: panel ? Math.round(panel.getBoundingClientRect().width) : 0,
      };
    });

    expect(geometry, 'CPU display select should be rendered on the Brand tab').not.toBeNull();
    expect(geometry!.panelWidth).toBeGreaterThan(0);
    // Nested in another grid cell this was ~50% of the panel width.
    expect(geometry!.cellWidth).toBeGreaterThanOrEqual(geometry!.panelWidth * 0.95);
  });

  test('colors tab does not scroll horizontally at narrow desktop widths', async ({ page }) => {
    for (const width of [1024, 1280]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto('/admin/theme-settings');
      await page.getByRole('button', { name: 'Colors', exact: true }).click();

      const overflow = await page.evaluate(() => {
        let worst = 0;
        for (const el of document.querySelectorAll<HTMLElement>('div')) {
          const style = getComputedStyle(el);
          if (style.overflowX !== 'auto' && style.overflowX !== 'hidden') continue;
          worst = Math.max(worst, el.scrollWidth - el.clientWidth);
        }
        return Math.round(worst);
      });

      expect(overflow, `colors panel overflows horizontally at ${width}px`).toBeLessThanOrEqual(1);
    }
  });

  test('live preview swatches keep an even gap in every group', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/admin/theme-settings');
    await expect(page.getByText(/live preview/i).first()).toBeVisible();

    // Brand, Semantic and Surfaces sit side by side in the Live Preview card.
    // Surfaces once used a 2px gap plus an *outer* ring per swatch, so the rings
    // met and the row read as one continuous bar while its neighbours were spaced.
    const groups = await page.evaluate(() => {
      const swatchRows = [...document.querySelectorAll<HTMLElement>('div')].filter((row) => {
        const swatches = [...row.children].filter(
          (c): c is HTMLElement => c.tagName === 'DIV' && c.className.includes('h-5') && c.className.includes('flex-1')
        );
        return swatches.length >= 3;
      });
      // The preview card is the nearest common ancestor holding all three rows.
      let card: HTMLElement | null = swatchRows[0]?.parentElement ?? null;
      while (card && !swatchRows.every((r) => card!.contains(r))) card = card.parentElement;
      if (!card || !/live preview/i.test(card.textContent || '')) return null;

      const out: { label: string; gaps: number[]; ringsOuter: boolean }[] = [];
      for (const row of swatchRows.filter((r) => card!.contains(r))) {
        const swatches = [...row.children].filter(
          (c): c is HTMLElement => c.tagName === 'DIV' && c.className.includes('h-5') && c.className.includes('flex-1')
        );
        const rects = swatches.map((s) => s.getBoundingClientRect());
        const gaps: number[] = [];
        for (let i = 1; i < rects.length; i += 1) {
          gaps.push(Math.round((rects[i].left - rects[i - 1].right) * 100) / 100);
        }
        // A ring drawn outside the box paints into the gap; an inset one does not.
        const shadow = getComputedStyle(swatches[0]).boxShadow;
        const ringsOuter = shadow.includes('0px 0px 0px 1px') && !shadow.includes('inset');
        out.push({ label: row.parentElement?.textContent?.slice(0, 20) ?? '', gaps, ringsOuter });
      }
      return out;
    });

    expect(groups, 'Live Preview strip should render its three swatch groups').not.toBeNull();
    expect(groups!.length).toBeGreaterThanOrEqual(3);

    for (const group of groups!) {
      for (const gap of group.gaps) {
        expect(gap, `"${group.label}" swatches must be separated, not touching`).toBeGreaterThanOrEqual(3);
      }
      expect(group.ringsOuter, `"${group.label}" must not draw its ring into the gap`).toBe(false);
    }

    const allGaps = groups!.flatMap((g) => g.gaps);
    expect(Math.max(...allGaps) - Math.min(...allGaps), 'every group should use the same gutter').toBeLessThanOrEqual(1);
  });
});