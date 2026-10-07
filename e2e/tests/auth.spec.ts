import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';
import { ADMIN } from '../global-setup';
import { settle } from './helpers';

test.describe('sign-in', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('redirects anonymous visitors to the login page', async ({ page }) => {
    await page.goto('/admin/users');
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Fusers/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('shows a friendly error for wrong credentials', async ({ page }) => {
    await page.goto('/login');
    // An unknown account: same generic error, and the real admin account never gets locked by test runs.
    await page.getByLabel('Email or username').fill('nobody-here');
    await page.getByLabel('Password').fill('definitely-wrong');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Incorrect username or password.')).toBeVisible();
  });

  test('signs in and lands on the requested page', async ({ page }) => {
    await page.goto('/login?next=%2Fadmin%2Fusers');
    await page.getByLabel('Email or username').fill(ADMIN.username);
    await page.getByLabel('Password').fill(ADMIN.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/admin\/users$/);
    await expect(page.getByRole('heading', { name: 'People' })).toBeVisible();
  });

  test('login page has no serious accessibility violations', async ({ page }) => {
    await page.goto('/login');
    await settle(page);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  });
});
