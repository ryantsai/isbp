import { expect, test } from './fixtures';

test('the announcements module (built with create-module) is served by the module host', async ({ page }) => {
  await page.goto('/announcements');
  await expect(page.getByRole('heading', { name: 'Announcements' })).toBeVisible();
  await expect(page.getByText('Planned maintenance: core network switches')).toBeVisible();
});

test('write and publish an announcement', async ({ page }) => {
  const title = `E2E notice ${Date.now().toString(36)}`;
  await page.goto('/announcements');
  await page.getByRole('button', { name: 'New announcement' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: /Incident/ }).click();
  await dialog.getByLabel('Title').fill(title);
  await dialog.getByLabel('Message').fill('Investigating elevated error rates.');
  await dialog.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await page.getByRole('main').getByRole('link', { name: 'Announcements' }).first().click();
  await expect(page.getByText(title)).toBeVisible();

  // Deleting asks first (it can't be undone) and goes back to the feed.
  await page.getByRole('link', { name: new RegExp(title) }).click();
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText(title);
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL(/\/announcements$/);
  await expect(page.getByText(title)).toHaveCount(0);
});

test('Administration → Modules: on/off and settings up front, the rest in Technical details', async ({
  page,
}) => {
  await page.goto('/admin/modules');
  await expect(page.getByRole('heading', { name: 'Modules', level: 1 })).toBeVisible();
  // No versions, event counts or developer notes on the page.
  await expect(page.getByText(/^v\d+\.\d+\.\d+$/)).toHaveCount(0);
  await expect(page.getByText('pnpm create-module')).toHaveCount(0);
  await page.getByRole('button', { name: 'View details of Service desk' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
  await sheet.getByRole('tab', { name: 'Technical details' }).click();
  await expect(sheet.getByText('itsm', { exact: true })).toBeVisible();
});
