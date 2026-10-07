import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { settle } from './helpers';

async function expectAccessible(page: Page, label?: string) {
  await settle(page);
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    label,
  ).toEqual([]);
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, page.url()).toBeLessThanOrEqual(1);
}

/** The seeded core switch: losing it impacts most business services. */
async function coreSwitch(request: APIRequestContext) {
  const res = (await (await request.get('/api/v1/cmdb/cis?q=tpe-sw-core-01')).json()) as {
    items: { id: string; name: string }[];
  };
  return res.items.find((c) => c.name === 'tpe-sw-core-01')!;
}

test.describe.configure({ mode: 'serial' });

test('CI list: quick views and search', async ({ page }) => {
  await page.goto('/cmdb');
  await expect(page.getByRole('heading', { name: 'Configuration items', level: 1 })).toBeVisible();
  await page.getByRole('tab', { name: 'Business services' }).click();
  await expect(page).toHaveURL(/view=services/);
  await expect(page.getByRole('link', { name: 'Email & Calendar' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'tpe-sw-core-01' })).toHaveCount(0);
});

test('CI detail: overview, relationships and the impact of an outage', async ({ page, request }) => {
  const ci = await coreSwitch(request);
  await page.goto(`/cmdb/${ci.id}`);
  await expect(page.getByRole('heading', { name: 'tpe-sw-core-01' })).toBeVisible();
  await expect(page.getByText('If this fails')).toBeVisible();

  await page.getByRole('tab', { name: /Relationships/ }).click();
  await expect(page.getByRole('tabpanel')).toContainText('tpe-fw-01');

  await page.getByRole('tab', { name: 'Impact' }).click();
  const panel = page.getByRole('tabpanel');
  await expect(panel.getByText(/business services? impacted/)).toBeVisible();
  await expect(panel.getByRole('link', { name: /Email & Calendar/ }).first()).toBeVisible();
  // The same analysis as an accessible list.
  await panel
    .getByRole('radio', { name: 'List' })
    .or(panel.getByRole('button', { name: 'List' }))
    .click();
  await expect(panel.getByText('Impacted if it fails').first()).toBeVisible();
});

test('CMDB pages have no accessibility violations (light and dark)', async ({ page, request }) => {
  test.setTimeout(150_000);
  const ci = await coreSwitch(request);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    for (const path of ['/cmdb', '/cmdb?view=infrastructure', '/cmdb/classes']) {
      await page.goto(path);
      await page.evaluate((s) => localStorage.setItem('theme', s), scheme);
      await page.reload();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectAccessible(page, `${scheme} ${path}`);
    }
    await page.goto(`/cmdb/${ci.id}`);
    await expect(page.getByRole('heading', { name: 'tpe-sw-core-01' })).toBeVisible();
    await expectAccessible(page, `${scheme} detail overview`);
    for (const tab of [/Relationships/, /^Impact$/]) {
      await page.getByRole('tab', { name: tab }).click();
      await expectAccessible(page, `${scheme} detail ${tab}`);
    }
  }
});

test('CMDB pages fit a 375px screen', async ({ page, request }) => {
  const ci = await coreSwitch(request);
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of ['/cmdb', '/cmdb/classes', `/cmdb/${ci.id}`]) {
    await page.goto(path);
    await settle(page);
    await expectNoHorizontalScroll(page);
  }
  await page.getByRole('tab', { name: 'Impact' }).click();
  await settle(page);
  await expectNoHorizontalScroll(page);
});
