import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, expect, type Page, test } from './fixtures';
import { settle } from './helpers';

/**
 * Assets (module `itam`) against the seeded demo: the admin holds AST-00001, a MacBook Pro 14 (M4);
 * "Adobe Acrobat Pro" is over-deployed and the "Dell ProSupport" contract renews within 30 days.
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

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, page.url()).toBeLessThanOrEqual(1);
}

interface Found {
  items: {
    id: string;
    reference?: string;
    tag?: string;
    title?: string;
    product?: string;
    status?: string;
  }[];
}

async function first(request: APIRequestContext, path: string) {
  const res = await request.get(`/api/v1/itam${path}`);
  expect(res.ok(), path).toBeTruthy();
  const body = (await res.json()) as Found;
  expect(body.items.length, path).toBeGreaterThan(0);
  return body.items[0]!;
}

const acrobat = (request: APIRequestContext) => first(request, '/licenses?q=Adobe%20Acrobat%20Pro');
const dellSupport = (request: APIRequestContext) => first(request, '/contracts?q=Dell%20ProSupport&view=all');
const adminLaptop = (request: APIRequestContext) => first(request, '/assets?q=AST-00001');

test.describe.configure({ mode: 'serial' });

test('the overview shows KPIs, charts with table twins and what needs attention', async ({ page }) => {
  await page.goto('/itam');
  await expect(page.getByRole('heading', { name: 'Assets', level: 1 })).toBeVisible();
  await expect(page.getByText('Book value', { exact: true })).toBeVisible();
  await expect(page.getByText('Non-compliant licences', { exact: true }).first()).toBeVisible();
  const byCategory = page.getByRole('region', { name: 'Assets by category and status' });
  await expect(byCategory.getByRole('list', { name: 'Assets by category and status' })).toBeVisible();
  await byCategory.getByRole('button', { name: 'Table' }).click();
  await expect(byCategory.getByRole('columnheader', { name: 'Deployed' })).toBeVisible();
  await expect(byCategory.getByRole('rowheader', { name: 'Laptop' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Spend by vendor' })).toContainText('Dell Technologies');
  await expect(page.getByRole('heading', { name: 'Needs attention' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Adobe Acrobat Pro' }).first()).toBeVisible();
});

test('assign an in-stock laptop to someone, then take it back', async ({ page }) => {
  await page.goto('/itam/hardware?view=in_stock&category=laptop');
  await expect(page.getByRole('heading', { name: 'Hardware', level: 1 })).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'In stock' }).first();
  await row.getByRole('link').first().click();
  await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible();
  await expect(page.getByText('In stock').first()).toBeVisible();

  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  // The person picker's popover is a dialog too: address the assign dialog by name.
  const dialog = page.getByRole('dialog', { name: /^Assign / });
  await dialog.getByRole('combobox', { name: 'Person' }).click();
  await page.keyboard.type('Olivia');
  await page.getByRole('option', { name: /Olivia Bennett/ }).click();
  await dialog.getByRole('textbox', { name: 'Note (optional)' }).fill('e2e: loaner for the audit week');
  await dialog.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Deployed').first()).toBeVisible();
  await expect(page.getByText('Olivia Bennett').first()).toBeVisible();

  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page.getByRole('tabpanel')).toContainText('Assigned to Olivia Bennett');

  await page.getByRole('button', { name: 'Return', exact: true }).click();
  const back = page.getByRole('dialog', { name: /^Return / });
  await back.getByRole('button', { name: 'Return', exact: true }).click();
  await expect(back).toBeHidden();
  await expect(page.getByText('Not assigned to anyone').or(page.getByText('In stock').first())).toBeVisible();
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page.getByRole('tabpanel')).toContainText('Returned by Olivia Bennett');
});

test('the licence page shows entitlement against usage', async ({ page, request }) => {
  const lic = await acrobat(request);
  await page.goto(`/itam/software/${lic.reference}`);
  await expect(page.getByRole('heading', { name: 'Adobe Acrobat Pro', level: 1 })).toBeVisible();
  const meter = page.getByRole('meter', { name: 'Seats in use' }).first();
  await expect(meter).toBeVisible();
  await expect(meter).toHaveAttribute('aria-valuetext', /\/ 40 used/);
  await expect(page.getByText('Over-deployed').first()).toBeVisible();
  await page.getByRole('tab', { name: /Installations/ }).click();
  await expect(page.getByRole('tabpanel').getByText('Unlicensed').first()).toBeVisible();

  await page.goto('/itam/software');
  await expect(page.getByRole('heading', { name: 'Software', level: 1 })).toBeVisible();
  await expect(page.getByRole('meter', { name: 'Seats in use' }).first()).toBeVisible();
});

test('the contract page shows the renewal timeline', async ({ page, request }) => {
  const contract = await dellSupport(request);
  await page.goto(`/itam/contracts/${contract.reference}`);
  await expect(page.getByRole('heading', { name: 'Dell ProSupport', level: 1 })).toBeVisible();
  const timeline = page.getByRole('figure', { name: 'Renewal timeline' });
  await expect(timeline).toBeVisible();
  await expect(timeline).toContainText('Notice date');
  await expect(timeline).toContainText('in the notice period');
  await page.getByRole('tab', { name: /Covered items/ }).click();
  await expect(page.getByRole('tabpanel')).toContainText('erp-db-01');
  await page.getByRole('tab', { name: 'Links & files' }).click();
  await expect(page.getByRole('tabpanel')).toContainText('Dell-ProSupport-Plus-signed.pdf');
});

test('My devices lists the admin’s MacBook with a way to report a problem', async ({ page }) => {
  await page.goto('/itam/mine');
  await expect(page.getByRole('heading', { name: 'My devices', level: 1 })).toBeVisible();
  await expect(page.getByText('AST-00001')).toBeVisible();
  await expect(page.getByText('MacBook Pro 14 (M4)').first()).toBeVisible();
  const report = page.getByRole('link', { name: /Report a problem with/ }).first();
  await expect(report).toHaveAttribute('href', /\/itsm\/report\?link=itam\.asset%3A/);
});

test('Discovery: map a discovered title to a licence, undo it, and import an inventory CSV', async ({
  page,
}) => {
  await page.goto('/itam/discovery');
  await expect(page.getByRole('heading', { name: 'Software', level: 1 })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Software sections' })).toContainText('Installed');
  // The seed leaves an old Microsoft 365 title on a few devices; 7-Zip is ignored (free).
  const title = 'Microsoft Office 365 ProPlus';
  await expect(page.getByRole('row').filter({ hasText: title })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: '7-Zip' })).toHaveCount(0);
  await page.getByRole('button', { name: `Map ${title} to a licence` }).click();
  const dialog = page.getByRole('dialog', { name: `Map “${title}” to a licence` });
  await dialog.getByRole('combobox', { name: 'Licence' }).click();
  await page.keyboard.type('Microsoft 365 E3');
  await page.getByRole('option', { name: /Microsoft 365 E3/ }).click();
  await dialog.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('row').filter({ hasText: title })).toHaveCount(0);

  await page.getByRole('tab', { name: 'Mapped & ignored' }).click();
  const rule = page.getByRole('row').filter({ hasText: title });
  await expect(rule).toContainText('Microsoft 365 E3');
  await expect(page.getByRole('row').filter({ hasText: '7-Zip' })).toContainText('Ignored');
  await page.getByRole('button', { name: `Remove the rule for ${title}` }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
  await expect(rule).toHaveCount(0);
  await page.getByRole('tab', { name: 'No licence' }).click();
  await expect(page.getByRole('row').filter({ hasText: title })).toBeVisible();

  // A device the platform doesn't know changes nothing and is listed as not registered.
  await page.getByRole('button', { name: 'Import CSV' }).click();
  const importer = page.getByRole('dialog', { name: 'Import an inventory CSV' });
  await expect(importer.getByRole('cell', { name: 'serial_number' })).toBeVisible();
  await importer.getByLabel('CSV file').setInputFiles({
    name: 'e2e-inventory.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Serial Number,Product,Publisher\nE2E-UNKNOWN-1,Google Chrome,Google\n,Orphan,\n'),
  });
  await expect(importer.getByRole('status')).toContainText('2 rows for 1 device');
  await expect(importer.getByRole('status')).toContainText('Line 3: no serial number or asset tag');
  await importer.getByRole('button', { name: 'Import 1 device' }).click();
  // The button (and its "Loading" status) goes once the import is done.
  await expect(importer.getByRole('button', { name: /Import 1 device/ })).toBeHidden();
  await expect(importer.getByRole('status')).toContainText('1 device is not registered in Assets');
  await expect(importer.getByRole('status')).toContainText('E2E-UNKNOWN-1');
  await importer.getByRole('button', { name: 'Close' }).first().click();
  await expect(importer).toBeHidden();
});

test('Assets pages have no accessibility violations (light and dark)', async ({ page, request }) => {
  test.setTimeout(240_000);
  const [lic, contract, laptop] = await Promise.all([
    acrobat(request),
    dellSupport(request),
    adminLaptop(request),
  ]);
  const pages = [
    '/itam',
    '/itam/hardware',
    '/itam/hardware?view=deployed',
    `/itam/hardware/${laptop.tag}`,
    '/itam/software',
    `/itam/software/${lic.reference}`,
    '/itam/contracts',
    `/itam/contracts/${contract.reference}`,
    '/itam/vendors',
    '/itam/mine',
    '/itam/settings',
    '/itam/discovery',
    '/itam/discovery?tab=reports',
    '/itam/discovery?tab=rules',
  ];
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    for (const path of pages) {
      await page.goto(path);
      await page.evaluate((s) => localStorage.setItem('theme', s), scheme);
      await page.reload();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectAccessible(page, `${scheme} ${path}`);
    }
    await page.goto(`/itam/hardware/${laptop.tag}`);
    for (const tab of ['Software', 'History']) {
      await page.getByRole('tab', { name: tab }).click();
      // The tab is kept in the URL: wait for that navigation (and the page title it re-renders) to land.
      await expect(page).toHaveURL(new RegExp(`tab=${tab.toLowerCase()}`));
      await expect(page).toHaveTitle(/\S/);
      await expectAccessible(page, `${scheme} asset ${tab}`);
    }
    await page.goto('/itam/vendors');
    await page.getByRole('button', { name: 'Dell Technologies' }).click();
    await expect(page.getByRole('dialog')).toContainText('Contracts');
    await expectAccessible(page, `${scheme} vendor sheet`);
    await page.goto('/itam/discovery');
    await page.getByRole('button', { name: 'Import CSV' }).click();
    await expect(page.getByRole('dialog', { name: 'Import an inventory CSV' })).toBeVisible();
    await expectAccessible(page, `${scheme} discovery import dialog`);
    await page.keyboard.press('Escape');
    await page
      .getByRole('button', { name: /^Map .* to a licence$/ })
      .first()
      .click();
    await expect(page.getByRole('dialog', { name: /to a licence$/ })).toBeVisible();
    await expectAccessible(page, `${scheme} discovery map dialog`);
    await page.keyboard.press('Escape');
  }
});

test('Assets pages fit a 375px screen', async ({ page, request }) => {
  test.setTimeout(120_000);
  const [lic, contract, laptop] = await Promise.all([
    acrobat(request),
    dellSupport(request),
    adminLaptop(request),
  ]);
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of [
    '/itam',
    '/itam/hardware',
    `/itam/hardware/${laptop.tag}`,
    '/itam/software',
    `/itam/software/${lic.reference}`,
    '/itam/contracts',
    `/itam/contracts/${contract.reference}`,
    '/itam/vendors',
    '/itam/mine',
    '/itam/settings',
    '/itam/discovery',
    '/itam/discovery?tab=reports',
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await settle(page);
    await expectNoHorizontalScroll(page);
  }
});
