import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';
import { overflowing, settle } from './helpers';

test('hardware keeps the device list in view and its filters usable on phones', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/itam/hardware?view=in_stock');
  const table = page.getByRole('table', { name: 'Hardware' });
  const firstDevice = table.getByRole('row').nth(1);
  await expect(firstDevice.getByRole('link')).toBeVisible();
  expect((await firstDevice.boundingBox())!.y).toBeLessThan(420);
  await expect(firstDevice).toContainText(/AST-\d+/);
  await expect(table.getByRole('columnheader', { name: 'Status', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  const filters = page.getByRole('dialog', { name: 'Filters', exact: true });
  await expect(filters.getByRole('combobox')).toHaveCount(7);
  await filters.getByRole('combobox', { name: 'Category', exact: true }).click();
  await page.getByRole('option', { name: 'Laptop', exact: true }).click();
  await expect(page).toHaveURL(/category=laptop/);
  await filters.getByRole('button', { name: 'Show results', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove Category: Laptop', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Remove Category: Laptop', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Filters (1 applied)', exact: true }).click();
  await filters.getByRole('button', { name: 'Clear all', exact: true }).click();
  await expect(page).not.toHaveURL(/category=/);
  await expect(page).toHaveURL(/view=in_stock/);
  await filters.getByRole('button', { name: 'Show results', exact: true }).click();
  await expect(firstDevice.getByRole('link')).toBeVisible();
});

test('hardware columns and filter panels fit in both themes with accessible controls', async ({ page }) => {
  for (const theme of ['light', 'dark']) {
    await page.goto('/itam/hardware');
    await page.evaluate((value) => localStorage.setItem('theme', value), theme);
    await page.reload();
    const table = page.getByRole('table', { name: 'Hardware' });
    await expect(table.getByRole('link').first()).toBeVisible();
    for (const width of [1680, 1280, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(() =>
          table.evaluate((el) => el.getBoundingClientRect().width <= el.parentElement!.clientWidth + 1),
        )
        .toBe(true);
      expect((await overflowing(page)).overflow).toBeLessThanOrEqual(1);
      await expect(table.getByRole('columnheader', { name: 'Status', exact: true })).toBeVisible();
      if (width > 375) {
        const tag = table.getByRole('columnheader').getByText('Tag', { exact: true });
        await expect(tag).toBeVisible();
        expect(await tag.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      }
    }
    await page.screenshot({ path: test.info().outputPath(`hardware-${theme}-375.png`) });
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Filters', exact: true })).toBeVisible();
    await settle(page);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual([]);
    await page.getByRole('button', { name: 'Show results', exact: true }).click();
  }
});
