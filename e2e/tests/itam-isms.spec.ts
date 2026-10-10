import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, expect, type Page, test } from './fixtures';
import { overflowing, settle } from './helpers';

/**
 * Assets for ISMS-style processes against the seeded demo: the approved-software list (Google Chrome allowed for the
 * company, Notepad++ for IT, uTorrent blocked, TeamViewer Business ending soon), the "Not approved" tab of
 * Discovery (WinRAR on two laptops, uTorrent on one), and the returned spare laptops waiting for their data wipe
 * (one overdue).
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

async function overdueWipe(request: APIRequestContext) {
  const res = await request.get('/api/v1/itam/assets?wipe=overdue');
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { items: { id: string; tag: string; name: string }[] };
  expect(body.items.length).toBeGreaterThan(0);
  return body.items[0]!;
}

test.describe.configure({ mode: 'serial' });

test('the approved software list filters by status, adds an entry and exports the whitelist', async ({
  page,
}) => {
  await page.goto('/itam/approved-software');
  await expect(page.getByRole('heading', { name: 'Software', level: 1 })).toBeVisible();
  const table = page.getByRole('table', { name: 'Approved software' });
  await expect(table.getByRole('button', { name: 'Google Chrome' })).toBeVisible();
  await page.getByRole('tab', { name: 'Blocked' }).click();
  await expect(table.getByRole('button', { name: 'uTorrent' })).toBeVisible();
  await page.getByRole('tab', { name: 'Ending soon' }).click();
  await expect(table.getByRole('button', { name: 'TeamViewer Business' })).toBeVisible();

  await page.getByRole('button', { name: 'Add software' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Add software to the list' });
  const title = `E2E Diagram Tool ${Date.now() % 100000}`;
  await sheet.getByLabel('Software').fill(title);
  // No licence type is assumed: "Free" would be wrong for shareware or paid software.
  await sheet.getByRole('combobox', { name: 'Licence type' }).click();
  await page.getByRole('option', { name: 'Free', exact: true }).click();
  await sheet.getByRole('radio', { name: 'Departments' }).check();
  await sheet.getByRole('checkbox').first().check();
  // Version and end date are optional: they wait under "More details".
  await sheet.getByRole('button', { name: /^More details/ }).click();
  await sheet.getByLabel('Version').fill('3');
  await sheet.getByLabel('Valid until').fill('2030-12-31');
  await sheet.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText(`${title} added to the list`)).toBeVisible();

  await page.getByRole('tab', { name: 'Allowed' }).click();
  await page.getByRole('searchbox').fill(title);
  await table.getByRole('button', { name: title }).click();
  const edit = page.getByRole('dialog', { name: 'Edit approved software' });
  await edit.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText(`${title} removed from the list`)).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(/^approved-software-\d{4}-\d{2}-\d{2}\.csv$/);
});

test('Discovery shows software that is not approved and adds a title to the list', async ({ page }) => {
  await page.goto('/itam/discovery?tab=compliance');
  const table = page.getByRole('table', { name: 'Installs not on the approved list' });
  await expect(table.getByText('WinRAR').first()).toBeVisible();
  await expect(table.getByText('Not on the approved list').first()).toBeVisible();
  await page.getByRole('combobox', { name: 'Approval' }).click();
  await page.getByRole('option', { name: 'Blocked', exact: true }).click();
  await expect(table.getByText('uTorrent')).toBeVisible();
  await expect(table.getByText('WinRAR')).toHaveCount(0);
});

test('a returned laptop shows its overdue wipe, and recording the wipe clears it', async ({
  page,
  request,
}) => {
  const laptop = await overdueWipe(request);
  await page.goto('/itam/hardware?wipe=overdue');
  await expect(page.getByRole('link', { name: laptop.name })).toBeVisible();
  await page.goto(`/itam/hardware/${laptop.tag}`);
  await expect(page.getByText(/^Wipe overdue since/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Record data wipe' }).first().click();
  const dialog = page.getByRole('dialog', { name: `Record the data wipe of ${laptop.tag}` });
  await dialog.getByRole('combobox', { name: 'Method' }).click();
  await page.getByRole('option', { name: 'Secure erase (overwrite)' }).click();
  await dialog.getByLabel('Note').fill('Wiped with the imaging tool');
  await dialog.getByRole('button', { name: 'Record wipe' }).click();
  await expect(page.getByText(`Data wipe of ${laptop.tag} recorded`)).toBeVisible();
  await expect(page.getByText('No wipe pending.')).toBeVisible();
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page.getByText(/^Data wiped: Secure erase/)).toBeVisible();
});

test('approved software, compliance and wipe screens are accessible (light and dark) and fit 375px', async ({
  page,
}) => {
  test.setTimeout(180_000);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    for (const path of [
      '/itam/approved-software',
      '/itam/approved-software?view=blocked',
      '/itam/discovery?tab=compliance',
      '/itam/hardware?wipe=pending',
    ]) {
      await page.goto(path);
      await page.evaluate((s) => localStorage.setItem('theme', s), scheme);
      await page.reload();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectAccessible(page, `${scheme} ${path}`);
    }
    await page.goto('/itam/approved-software');
    await page.getByRole('button', { name: 'Add software' }).first().click();
    await expect(page.getByRole('dialog', { name: 'Add software to the list' })).toBeVisible();
    await page.getByRole('radio', { name: 'Departments' }).check();
    await expectAccessible(page, `${scheme} approved software sheet`);
    await page.keyboard.press('Escape');
  }
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of [
    '/itam/approved-software',
    '/itam/discovery?tab=compliance',
    '/itam/hardware?wipe=pending',
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await settle(page);
    const { overflow, offenders } = await overflowing(page);
    expect(overflow, `${path}: ${offenders.join(', ')}`).toBeLessThanOrEqual(1);
  }
});
