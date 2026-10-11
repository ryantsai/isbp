import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from './fixtures';
import { overflowing, settle } from './helpers';

/**
 * Administration → Database connections against the seeded demo: the reachable Contoso connections on the
 * platform's Postgres and the unreachable SQL Server / Oracle / MySQL ones. Runs as the seeded admin.
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

/** The platform's own Postgres as the API sees it (dev: embedded on localhost; CI: service container). */
const PG = { host: 'localhost', port: '5432', database: 'isbp_demo', user: 'isbp', password: 'isbp' };

test.describe.configure({ mode: 'serial' });

test('lists the demo connections with their engine, use and status', async ({ page }) => {
  await page.goto('/admin/databases');
  await expect(page.getByRole('heading', { name: 'Database connections', level: 1 })).toBeVisible();
  const erp = page.getByRole('row').filter({ hasText: 'Contoso ERP (reporting)' });
  await expect(erp).toContainText('PostgreSQL');
  await expect(erp).toContainText('Read-only');
  await expect(erp).toContainText('Connected');
  const hr = page.getByRole('row').filter({ hasText: 'HR (SQL Server)' });
  await expect(hr).toContainText('Failed');
  await expect(
    page.getByRole('row').filter({ hasText: 'Contoso ERP – account administration' }),
  ).toContainText('Account admin');
});

test('browses the catalog of a connection', async ({ page }) => {
  await page.goto('/admin/databases');
  await page.getByRole('button', { name: 'More actions for Contoso ERP (reporting)' }).click();
  await page.getByRole('menuitem', { name: 'Browse catalog' }).click();
  const sheet = page.getByRole('dialog', { name: 'Catalog: Contoso ERP (reporting)' });
  await expect(sheet.getByText('erp.customers')).toBeVisible();
  await sheet.getByRole('searchbox').fill('sales_by');
  await expect(sheet.getByText(/erp\.sales_by_region\(from_date, to_date\)/)).toBeVisible();
  await expect(sheet.getByText('erp.customers')).toBeHidden();
  await expectAccessible(page, 'catalog sheet');
});

test('adds a connection after testing it, disables it, then deletes it', async ({ page }) => {
  await page.goto('/admin/databases');
  await page.getByRole('button', { name: 'Add connection' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Add a database connection' });
  await sheet.getByRole('textbox', { name: /^Name/ }).fill('E2E reporting copy');
  await expect(sheet.getByRole('textbox', { name: 'Key' })).toHaveValue('e2e-reporting-copy');
  await sheet.getByRole('combobox', { name: 'Engine' }).click();
  await page.getByRole('option', { name: 'PostgreSQL' }).click();
  await sheet.getByRole('textbox', { name: 'Host' }).fill(PG.host);
  await sheet.getByRole('textbox', { name: 'Port' }).fill(PG.port);
  await sheet.getByRole('textbox', { name: /^Database/ }).fill(PG.database);
  await sheet.getByRole('button', { name: /^More details/ }).click();
  await sheet.getByRole('combobox', { name: 'Encryption' }).click();
  await page.getByRole('option', { name: 'Off' }).click();
  await sheet.getByRole('textbox', { name: 'User name' }).fill(PG.user);

  await sheet.getByLabel('Password', { exact: true }).fill('not-the-password');
  await sheet.getByRole('button', { name: 'Test connection' }).click();
  await expect(sheet.getByRole('alert')).toContainText("Couldn't connect");
  await expect(sheet.getByRole('alert')).toContainText('28P01');

  await sheet.getByLabel('Password', { exact: true }).fill(PG.password);
  await sheet.getByRole('button', { name: 'Test connection' }).click();
  await expect(sheet.getByText(/Connected in \d+ ms/)).toBeVisible();
  await expectAccessible(page, 'connection form');
  await sheet.getByRole('button', { name: 'Add connection' }).click();
  await expect(sheet).toBeHidden();

  const row = page.getByRole('row').filter({ hasText: 'E2E reporting copy' });
  await expect(row).toContainText('Not tested');
  await page.getByRole('button', { name: 'More actions for E2E reporting copy' }).click();
  await page.getByRole('menuitem', { name: 'Test' }).click();
  await expect(row).toContainText('Connected');

  await row.click();
  const edit = page.getByRole('dialog', { name: 'Edit E2E reporting copy' });
  await expect(edit.getByLabel('Password', { exact: true })).toHaveAttribute('placeholder', /Stored/);
  await edit.getByRole('switch', { name: 'Enabled' }).click();
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit).toBeHidden();
  await expect(row).toContainText('Disabled');

  await page.getByRole('button', { name: 'More actions for E2E reporting copy' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Delete E2E reporting copy?' });
  await confirm.getByRole('button', { name: 'Delete connection' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'E2E reporting copy' })).toHaveCount(0);
});

test('the page has no accessibility violations (light and dark) and fits a phone', async ({ page }) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.goto('/admin/databases');
    await page.evaluate((s) => localStorage.setItem('theme', s), scheme);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectAccessible(page, `${scheme} list`);
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/admin/databases');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await settle(page);
  const { overflow, offenders } = await overflowing(page);
  expect(overflow, offenders.join('\n')).toBeLessThanOrEqual(1);
});
