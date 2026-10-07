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
  await page.getByRole('link', { name: 'Announcements' }).first().click();
  await expect(page.getByText(title)).toBeVisible();
});
