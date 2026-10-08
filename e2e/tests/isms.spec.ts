import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from './fixtures';
import { overflowing, settle } from './helpers';

/**
 * Information security (module `isms`) against the seeded demo: assets of every class, the "Yearly asset stocktake"
 * in progress, the shared accounts svc-backup (password change due) and report_reader, and the account review of the
 * core firewall management console. The admin holds every isms permission.
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

async function inBothThemes(page: Page, label: string) {
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.evaluate((theme) => localStorage.setItem('theme', theme), colorScheme);
    await page.reload();
    await expectAccessible(page, `${label} (${colorScheme})`);
  }
}

test.describe.configure({ mode: 'serial' });

test('the register lists assets with their value and filters by class and value', async ({ page }) => {
  await page.goto('/isms');
  await expect(page.getByRole('heading', { name: 'Information assets', level: 1 })).toBeVisible();
  const table = page.getByRole('table', { name: 'Information assets' });
  await expect(table.getByRole('link', { name: 'Core firewall' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Minimum value' }).click();
  await page.getByRole('option', { name: 'Value 4 or more' }).click();
  await expect(page).toHaveURL(/minValue=4/);
  await expect(table.getByRole('link', { name: 'Customer order database' })).toBeVisible();
  await expect(table.getByRole('link', { name: 'Office productivity suite' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Export CSV' })).toHaveAttribute(
    'href',
    /export\.csv\?.*minValue=4/,
  );
  await inBothThemes(page, 'register');
});

test('register an asset, scoring C/I/A with the class guidance; the value is the highest score', async ({
  page,
}) => {
  const name = `e2e firewall ${Date.now()}`;
  await page.goto('/isms');
  await page.getByRole('button', { name: 'Register an asset' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Register an information asset' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('textbox', { name: 'Asset name' }).fill(name);
  await sheet.getByRole('combobox', { name: 'Class', exact: true }).click();
  await page.getByRole('option', { name: /^HW · Hardware/ }).click();
  // The class's guidance shows next to every score while choosing.
  const confidentiality = sheet.getByRole('group', { name: 'Confidentiality' });
  await expect(confidentiality).toContainText('seriously affect security controls');
  await sheet.getByRole('combobox', { name: 'Site' }).click();
  await page.getByRole('option', { name: /^HQ01/ }).click();
  await confidentiality.getByRole('radio', { name: /Score 3/ }).check();
  await sheet
    .getByRole('group', { name: 'Availability' })
    .getByRole('radio', { name: /Score 4/ })
    .check();
  await expect(sheet.getByText('Value 4')).toBeVisible();
  await expectAccessible(page, 'asset sheet');
  await sheet.getByRole('button', { name: 'Register', exact: true }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  await expect(page.getByText(/^HQ01HW\d{4}$/).first()).toBeVisible();
  await expect(page.getByText('Value 4').first()).toBeVisible();
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page.getByText('Registered')).toBeVisible();
  await inBothThemes(page, 'asset page');
});

test('check an item of the stocktake in progress', async ({ page }) => {
  await page.goto('/isms/stocktakes');
  await expect(page.getByRole('heading', { name: 'Stocktakes', level: 1 })).toBeVisible();
  await page
    .getByRole('link', { name: /Yearly asset stocktake/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: /Yearly asset stocktake/, level: 1 })).toBeVisible();
  await page.getByRole('tab', { name: 'To check' }).click();
  const row = page
    .getByRole('row')
    .filter({ has: page.getByRole('button', { name: /^Check / }) })
    .first();
  const number = (await row.getByRole('cell').first().innerText()).trim();
  await row.getByRole('button', { name: /^Check / }).click();
  const dialog = page.getByRole('dialog', { name: `Check ${number}` });
  await dialog.getByRole('radio', { name: /Confirmed/ }).check();
  await expectAccessible(page, 'record dialog');
  await dialog.getByRole('button', { name: 'Record' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('tab', { name: 'Confirmed' }).click();
  await expect(page.getByRole('row').filter({ hasText: number })).toContainText('Confirmed');
  await inBothThemes(page, 'stocktake page');
});

test('the custodian records the password change of a shared account whose member left the list', async ({
  page,
}) => {
  await page.goto('/isms/accounts?view=password');
  await expect(page.getByRole('heading', { name: 'Shared accounts', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'svc-backup' }).click();
  await expect(page.getByRole('heading', { name: 'svc-backup', level: 1 })).toBeVisible();
  await expect(page.getByText('Change the password today')).toBeVisible();
  await page.getByRole('button', { name: 'Password changed' }).click();
  const dialog = page.getByRole('dialog', { name: /Password of svc-backup changed/ });
  await expectAccessible(page, 'password dialog');
  await dialog.getByRole('button', { name: 'Record' }).click();
  await expect(page.getByText('Change the password today')).toBeHidden();
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page.getByText(/Password changed on/)).toBeVisible();
  await inBothThemes(page, 'shared account page');
});

test('the account review, its decisions and the settings pages pass axe', async ({ page }) => {
  await page.goto('/isms/reviews');
  await expect(page.getByRole('heading', { name: 'Account reviews', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Core firewall management console' }).first().click();
  await expect(
    page.getByRole('heading', { name: 'Core firewall management console', level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole('table', { name: 'Accounts' })).toContainText('temp-vendor');
  await inBothThemes(page, 'review page');
  await page.goto('/isms/settings');
  await expect(page.getByRole('heading', { name: 'Information security settings', level: 1 })).toBeVisible();
  await expect(page.getByText('HW', { exact: true })).toBeVisible();
  await inBothThemes(page, 'settings');
});

test('every page works at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of ['/isms', '/isms/stocktakes', '/isms/accounts', '/isms/reviews', '/isms/settings']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const result = await overflowing(page);
    expect(result.overflow, `${path}: ${result.offenders.join('; ')}`).toBeLessThanOrEqual(1);
  }
});
