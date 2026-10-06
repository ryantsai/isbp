import { expect, test } from '@playwright/test';

test('search and filter people (state is kept in the URL)', async ({ page }) => {
  await page.goto('/admin/users');
  await page.getByRole('searchbox').fill('admin');
  await expect(page).toHaveURL(/q=admin/);
  await expect(page.getByRole('link', { name: /Platform Admin/ })).toBeVisible();
});

test('create a pre-boarded person, then onboard them', async ({ page }) => {
  const unique = Date.now().toString(36);
  await page.goto('/admin/users');
  await page.getByRole('button', { name: 'Add person' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Work email').fill(`e2e.${unique}@isbp.example`);
  await sheet.getByLabel('Display name').fill(`E2E Person ${unique}`);
  await sheet.getByRole('radio', { name: /Pre-boarded/ }).click();
  await sheet.getByRole('button', { name: 'Create' }).click();

  await expect(page).toHaveURL(/\/admin\/users\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: `E2E Person ${unique}` })).toBeVisible();
  await expect(page.getByText('Pending').first()).toBeVisible();
  await page.getByRole('button', { name: 'Onboard' }).click();
  await expect(page.getByText('Active').first()).toBeVisible();
});
