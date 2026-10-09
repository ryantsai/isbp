import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from './fixtures';
import { settle } from './helpers';

/**
 * Data APIs & ETL against the seeded demo (database `isbp_demo`, connections `contoso-erp` and
 * `contoso-dw`): the Data APIs list, the test console, building and publishing a new endpoint from SQL, its
 * docs, running the "Customer dimension" pipeline for real, and the call log. Runs as the seeded admin.
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

/** The id-based URL of a seeded pipeline (found through the list). */
async function pipelineUrl(page: Page, name: string) {
  await page.goto('/etl/pipelines');
  const link = page.getByRole('link', { name, exact: true });
  await expect(link).toBeVisible();
  return (await link.getAttribute('href'))!;
}

test.describe.configure({ mode: 'serial' });

test('Data APIs list: seeded endpoints with status tabs', async ({ page }) => {
  await page.goto('/etl');
  await expect(page.getByRole('heading', { name: 'Data APIs', level: 1 })).toBeVisible();
  for (const name of [
    'Customers by region',
    'Orders of a customer',
    'Sales by region',
    'Product search',
    'HR headcount',
  ])
    await expect(page.getByRole('link', { name, exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Draft' }).click();
  await expect(page).toHaveURL(/view=draft/);
  await expect(page.getByRole('link', { name: 'Open invoices' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Product search' })).toHaveCount(0);

  await page.getByRole('tab', { name: 'All' }).click();
  // Each tab renders its own table and search box: type into the new one, not the one being replaced.
  await expect(page).not.toHaveURL(/view=/);
  await expect(page.getByRole('link', { name: 'Customers by region' })).toBeVisible();
  await page.getByPlaceholder('Search by name or slug…').fill('product');
  await expect(page.getByRole('link', { name: 'Product search' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Customers by region' })).toHaveCount(0);
});

test('customers-by-region: overview, versions and the test console', async ({ page }) => {
  await page.goto('/etl/endpoints/customers-by-region');
  await expect(page.getByRole('heading', { name: 'Customers by region', level: 1 })).toBeVisible();
  await expect(page.getByText('/api/v1/etl/data/customers-by-region').first()).toBeVisible();
  await expect(page.getByText('Calls over time')).toBeVisible();
  // The chart's table twin.
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: 'Response time (95% of calls)' })).toBeVisible();

  await page.getByRole('tab', { name: 'Versions' }).click();
  const versions = page.getByRole('list', { name: 'Versions' });
  await expect(versions).toContainText('v2');
  await expect(versions).toContainText('Deprecated');

  await page.getByRole('tab', { name: 'Test' }).click();
  await expect(page).toHaveURL(/tab=test/);
  await page.getByRole('combobox', { name: 'region' }).click();
  await page.getByRole('option', { name: 'north', exact: true }).click();
  await page.getByRole('button', { name: 'Run test' }).click();
  await expect(page.getByText(/\d+ rows · /)).toBeVisible();
  await expect(page.getByText('Bound SQL (values travel separately)')).toBeVisible();
  const results = page.getByRole('region', { name: 'Results' });
  await expect(results.getByRole('columnheader', { name: /^code/ })).toBeVisible();
  await expect(results).toContainText('north');
});

test('a new Data API from SQL: detect the parameter, test, publish v1, read the docs', async ({ page }) => {
  const name = `E2E products ${Date.now().toString(36)}`;
  await page.goto('/etl');
  await expect(page.getByRole('link', { name: 'Customers by region' })).toBeVisible();
  const dialog = page.getByRole('dialog', { name: 'New Data API' });
  // The dev server may still be hydrating the page: click until the dialog opens.
  await expect(async () => {
    await page.getByRole('button', { name: 'New Data API' }).first().click();
    await expect(dialog).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await expect(dialog.getByLabel('URL slug')).toHaveValue(/^e2e-products-/);
  await dialog.getByRole('combobox', { name: 'Connection' }).click();
  await page.getByRole('option', { name: /Contoso ERP \(reporting\)/ }).click();
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/etl\/endpoints\/e2e-products-.+tab=definition/);
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();

  const sql = page.getByRole('textbox', { name: 'SQL' });
  await sql.click();
  await page.keyboard.insertText(
    'SELECT sku, name, unit_price FROM erp.products WHERE category = :category ORDER BY sku',
  );
  await expect(page.getByText('Parameters in the SQL:')).toBeVisible();
  await page.getByRole('button', { name: 'Add 1 missing parameter' }).click();
  await expect(page.getByRole('list', { name: 'Parameters' }).getByLabel('Name')).toHaveValue('category');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved')).toBeVisible();

  await page.getByRole('tab', { name: 'Test' }).click();
  await page.getByRole('textbox', { name: 'category' }).fill('hardware');
  await page.getByRole('button', { name: 'Run test' }).click();
  await expect(page.getByText(/\d+ rows · /)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Results' })).toContainText('P-');

  await page.getByRole('button', { name: 'Publish this draft' }).click();
  const publish = page.getByRole('dialog', { name: 'Publish version 1' });
  await publish.getByLabel('Change note').fill('First version from the e2e run');
  await publish.getByRole('button', { name: 'Publish v1' }).click();
  await expect(page.getByText('Version 1 published')).toBeVisible();

  await page.getByRole('tab', { name: 'Docs' }).click();
  const curl = page.getByRole('textbox', { name: 'Example request' });
  await expect(curl).toContainText('curl');
  await expect(curl).toContainText('Authorization: Bearer <your API key>');
  await expect(curl).toContainText('category=');
  await expect(page.getByRole('textbox', { name: 'Example response' })).toContainText('"unit_price"');
  await expect(page.getByRole('link', { name: 'Download OpenAPI' })).toHaveAttribute(
    'href',
    '/api/v1/etl/endpoints/openapi.json',
  );
});

test('the Customer dimension pipeline runs and writes rows', async ({ page }) => {
  test.setTimeout(120_000);
  const url = await pipelineUrl(page, 'Customer dimension');
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'Customer dimension', level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Column mapping' })).toContainText('customer_code');
  await page.getByRole('button', { name: 'Run now' }).click();
  await expect(page).toHaveURL(/\/runs\//);
  await expect(page.getByRole('heading', { name: 'Run of Customer dimension', level: 1 })).toBeVisible();
  await expect(page.getByText('Succeeded', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(
    page.locator('dl[aria-label="Progress"] > div').filter({ hasText: 'Rows written' }),
  ).toContainText('400');
  await expect(page.getByRole('log', { name: 'Log' })).toContainText('Committed: 400 read, 400 written');
  await expect(page.getByRole('button', { name: 'Run again' })).toBeVisible();
});

test('call log: filter by outcome and Data API', async ({ page }) => {
  await page.goto('/etl/logs');
  await expect(page.getByRole('heading', { name: 'Data APIs', level: 1 })).toBeVisible();
  // Data APIs | Call log are the sections of one page.
  await expect(
    page.getByRole('navigation', { name: 'Data API sections' }).getByRole('link', { name: 'Call log' }),
  ).toHaveAttribute('aria-current', 'page');
  await page.getByRole('combobox', { name: 'Status' }).click();
  await page.getByRole('option', { name: 'Errors' }).click();
  await expect(page).toHaveURL(/status=error/);
  await page.getByRole('combobox', { name: 'Data API' }).click();
  await page.getByRole('option', { name: 'HR headcount' }).click();
  await expect(page).toHaveURL(/endpoint=/);
  const table = page.getByRole('table');
  await expect(table).toContainText('DATABASE_ERROR');
  await table.getByRole('row').nth(1).click();
  const sheet = page.getByRole('dialog', { name: 'Call' });
  await expect(sheet).toContainText('ENOTFOUND');
  await expect(sheet).toContainText('Request id');
});

test('Data APIs & ETL pages have no accessibility violations (light and dark)', async ({ page }) => {
  test.setTimeout(240_000);
  const pipeline = await pipelineUrl(page, 'Daily sales to warehouse');
  await page.goto(pipeline);
  const runLink = page.getByRole('link', { name: /ago|now/ }).first();
  await expect(runLink).toBeVisible();
  const run = (await runLink.getAttribute('href'))!;
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    for (const path of [
      '/etl',
      '/etl?view=draft',
      '/etl/logs',
      '/etl/pipelines',
      '/etl/pipelines/new',
      pipeline,
      run,
    ]) {
      await page.goto(path);
      await page.evaluate((s) => localStorage.setItem('theme', s), scheme);
      await page.reload();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectAccessible(page, `${scheme} ${path}`);
    }
    await page.goto(`${pipeline}?tab=definition`);
    await expect(page.getByRole('tabpanel')).toBeVisible();
    await expectAccessible(page, `${scheme} pipeline definition`);

    await page.goto('/etl/endpoints/customers-by-region');
    await expect(page.getByRole('heading', { name: 'Customers by region' })).toBeVisible();
    await expectAccessible(page, `${scheme} endpoint overview`);
    for (const tab of ['Definition', 'Test', 'Versions', 'Docs', 'Links & files']) {
      await page.getByRole('tab', { name: tab }).click();
      await expect(page.getByRole('tabpanel')).toBeVisible();
      await expectAccessible(page, `${scheme} endpoint ${tab}`);
    }
  }
});

test('Data APIs & ETL pages fit a 375px screen', async ({ page }) => {
  const pipeline = await pipelineUrl(page, 'Daily sales to warehouse');
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of [
    '/etl',
    '/etl/logs',
    '/etl/pipelines',
    '/etl/pipelines/new',
    pipeline,
    `${pipeline}?tab=definition`,
    '/etl/endpoints/customers-by-region',
    '/etl/endpoints/customers-by-region?tab=definition',
    '/etl/endpoints/customers-by-region?tab=test',
    '/etl/endpoints/customers-by-region?tab=versions',
    '/etl/endpoints/customers-by-region?tab=docs',
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await settle(page);
    await expectNoHorizontalScroll(page);
  }
});
