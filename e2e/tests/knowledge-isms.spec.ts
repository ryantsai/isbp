import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, expect, type Page, test } from './fixtures';
import { overflowing, settle } from './helpers';

/**
 * Knowledge classification labels and attachments against the seeded demo: the agent article "Known error: VPN
 * client 5.2 crashes on macOS 15" is Confidential and has the VPN gateway diagram attached; internal articles are
 * Internal Use Only.
 */

async function expectAccessible(page: Page, label: string) {
  await settle(page);
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    label,
  ).toEqual([]);
}

async function knownError(request: APIRequestContext) {
  const res = await request.get(
    '/api/v1/knowledge/articles?q=VPN%20client%205.2&classification=confidential',
  );
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { items: { reference: string; title: string }[] };
  expect(body.items.length).toBeGreaterThan(0);
  return body.items[0]!;
}

test.describe.configure({ mode: 'serial' });

test('a classified article shows its label, the handling banner and its attachments', async ({
  page,
  request,
}) => {
  const article = await knownError(request);
  await page.goto(`/knowledge/${article.reference}`);
  await expect(page.getByRole('heading', { name: article.title, level: 1 })).toBeVisible();
  // The label names itself for screen readers ("Classification: Confidential"), with an icon and the tone.
  await expect(page.getByText('Classification: Confidential', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /Classified Confidential/ })).toBeVisible();
  const files = page.getByRole('region', { name: /Attachments/ });
  await expect(files.getByRole('link', { name: 'VPN-gateway-diagram.pdf', exact: true })).toBeVisible();
  // Editors may add files here.
  await expect(files.locator('input[type=file]')).toBeAttached();
});

test('the editor sets the classification and the workspace filters by it', async ({ page }) => {
  await page.goto('/knowledge/new');
  await page.getByLabel('Title').fill(`E2E classified ${Date.now() % 100000}`);
  // Classification is one of the editor's rarer settings, under "More settings". Let the section finish opening, as a
  // person scrolling down to it would (its height animation restores the scroll position it started from).
  await page.getByRole('button', { name: /More settings/ }).click();
  await settle(page);
  await page.getByRole('combobox', { name: 'Classification' }).click();
  await page.getByRole('option', { name: 'Internal Use Only' }).click();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Internal Use Only').first()).toBeVisible();

  await page.goto('/knowledge/manage?tab=published');
  // The rarer filters wait behind "Filters".
  await page.getByRole('button', { name: 'Filters' }).click();
  await page.getByRole('combobox', { name: 'Classification' }).click();
  await page.getByRole('option', { name: 'Confidential', exact: true }).click();
  await expect(page.getByRole('link', { name: /VPN client 5\.2/ }).first()).toBeVisible();
});

test('classification and attachment screens are accessible (light and dark) and fit 375px', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const article = await knownError(request);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    for (const path of [
      `/knowledge/${article.reference}`,
      '/knowledge/manage?tab=published&classification=none',
    ]) {
      await page.goto(path);
      await page.evaluate((s) => localStorage.setItem('theme', s), scheme);
      await page.reload();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectAccessible(page, `${scheme} ${path}`);
    }
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/knowledge/${article.reference}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await settle(page);
  const { overflow, offenders } = await overflowing(page);
  expect(overflow, offenders.join(' | ')).toBeLessThanOrEqual(1);
});
