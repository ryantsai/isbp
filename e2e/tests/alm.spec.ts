import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from './fixtures';
import { settle } from './helpers';

/**
 * Applications (ALM) against the seeded demo portfolio: the inventory, an application page with its
 * environment pipeline and delivery metrics, release readiness, recording deployments and the change
 * policy's explanation. Runs as the seeded admin (who may record and override).
 */

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

/** Opens "Record deployment" and picks an environment. */
async function openDeployDialog(page: Page, environment: string) {
  await page.getByRole('button', { name: 'Record deployment' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Record deployment' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Environment' }).click();
  await page.getByRole('option', { name: environment, exact: true }).click();
  return dialog;
}

test.describe.configure({ mode: 'serial' });

test('inventory: Finance ERP is listed, quick tabs filter by stage', async ({ page }) => {
  await page.goto('/alm');
  await expect(page.getByRole('heading', { name: 'Applications', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Finance ERP' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Portfolio summary' })).toBeVisible();

  await page.getByRole('tab', { name: 'Sunsetting & retired' }).click();
  await expect(page).toHaveURL(/view=sunset/);
  await expect(page.getByRole('link', { name: 'Intranet' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Finance ERP' })).toHaveCount(0);

  await page.getByRole('tab', { name: 'All' }).click();
  await expect(page).not.toHaveURL(/view=/);
  await page.getByPlaceholder('Search by code or name…').fill('hr-portal');
  await expect(page.getByRole('link', { name: 'HR Portal' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Finance ERP' })).toHaveCount(0);
});

test('application page: environment pipeline, delivery metrics and tabs', async ({ page }) => {
  await page.goto('/alm/erp');
  await expect(page.getByRole('heading', { name: 'Finance ERP', level: 1 })).toBeVisible();

  const pipeline = page.getByRole('list', { name: 'Environment pipeline' });
  await expect(pipeline.getByRole('listitem')).toHaveCount(5);
  for (const env of ['Development', 'Test', 'Staging', 'Production', 'Disaster Recovery'])
    await expect(pipeline).toContainText(env);

  for (const tile of [
    'Deployment frequency',
    'Change failure rate',
    'Lead time for changes',
    'Time to restore',
  ])
    await expect(page.getByText(tile, { exact: true })).toBeVisible();
  // The chart's table twin.
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: 'Week of' })).toBeVisible();

  await page.getByRole('tab', { name: /Releases/ }).click();
  await expect(page).toHaveURL(/tab=releases/);
  await expect(page.getByRole('link', { name: '12.1.0' })).toBeVisible();

  await page.getByRole('tab', { name: /Deployments/ }).click();
  await expect(page.getByRole('tabpanel')).toContainText('Production');
});

test('release page: erp 12.1.0 shows its readiness checklist and pipeline', async ({ page }) => {
  await page.goto('/alm/erp/releases/12.1.0');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('12.1.0');
  await expect(page.getByText('Readiness for production')).toBeVisible();
  for (const check of [
    'An authorized change is linked',
    'Succeeded in test or staging',
    'Release notes are written',
    'No failed production deployment',
  ])
    await expect(page.getByText(check)).toBeVisible();
  await expect(page.getByRole('list', { name: 'Release lifecycle' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Environments this version reached' })).toContainText(
    'Staging',
  );
});

test('recording a test deployment works', async ({ page }) => {
  await page.goto('/alm/erp/releases/12.1.0');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('12.1.0');
  const dialog = await openDeployDialog(page, 'Test');
  await expect(dialog.getByText('Test is not production: no change is needed.')).toBeVisible();
  await dialog.getByLabel('Notes').fill('Smoke test after the e2e run');
  await dialog.getByRole('button', { name: 'Record deployment' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Recorded 12.1.0 on Test')).toBeVisible();
});

test('a production deployment without a change explains the policy', async ({ page }) => {
  // The planned website release has no change linked.
  await page.goto('/alm/corp-web/releases/2026.10');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('2026.10');
  const dialog = await openDeployDialog(page, 'Production');
  await expect(dialog.getByText('No authorized change: name one or link it to the release.')).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Raise a change' })).toHaveAttribute(
    'href',
    /\/itsm\/changes\?new=1&title=.+&link=alm\.release:/,
  );
  await expect(dialog.getByRole('button', { name: 'Record deployment' })).toBeDisabled();
  // The admin may override; the option asks for a reason first.
  await dialog.getByRole('button', { name: 'Override with reason' }).click();
  await expect(dialog.getByLabel('Why must this deploy without an authorized change?')).toBeVisible();
  await expectAccessible(page, 'deployment dialog');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('Applications pages have no accessibility violations (light and dark)', async ({ page }) => {
  test.setTimeout(180_000);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    for (const path of ['/alm', '/alm?view=mine', '/alm/releases', '/alm/releases?view=month']) {
      await page.goto(path);
      await page.evaluate((s) => localStorage.setItem('theme', s), scheme);
      await page.reload();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectAccessible(page, `${scheme} ${path}`);
    }
    await page.goto('/alm/erp');
    await expect(page.getByRole('heading', { name: 'Finance ERP' })).toBeVisible();
    await expectAccessible(page, `${scheme} application overview`);
    for (const tab of [/Releases/, /Deployments/, /^Settings$/]) {
      await page.getByRole('tab', { name: tab }).click();
      await expect(page.getByRole('tabpanel')).toBeVisible();
      await expectAccessible(page, `${scheme} application ${tab}`);
    }
    await page.goto('/alm/erp/releases/12.1.0');
    await expect(page.getByText('Readiness for production')).toBeVisible();
    await expectAccessible(page, `${scheme} release page`);
  }
});

test('Applications pages fit a 375px screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of [
    '/alm',
    '/alm/erp',
    '/alm/erp?tab=deployments',
    '/alm/erp?tab=settings',
    '/alm/erp/releases/12.1.0',
    '/alm/releases',
    '/alm/releases?view=month',
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await settle(page);
    await expectNoHorizontalScroll(page);
  }
});
