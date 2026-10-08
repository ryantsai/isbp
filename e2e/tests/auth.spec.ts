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

test.describe('required password change', () => {
  test('asks for a new password right after sign-in, then goes on to the requested page', async ({
    request,
    browser,
    baseURL,
  }) => {
    // As the admin: a local account created with an initial password must choose a new one at first sign-in.
    const { csrfToken } = (await (await request.get('/api/v1/auth/session')).json()) as { csrfToken: string };
    const headers = { 'x-csrf-token': csrfToken };
    const username = `e2e-password-${Date.now()}`;
    const initial = 'Initial-pass-2026';
    const created = await request.post('/api/v1/users', {
      data: { email: `${username}@example.test`, username, displayName: 'E2E Password', password: initial },
      headers,
    });
    expect(created.ok()).toBeTruthy();
    const { id } = (await created.json()) as { id: string };

    const context = await browser.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
      locale: 'en-US',
    });
    try {
      const page = await context.newPage();
      const hydrated = () => page.waitForFunction(() => document.documentElement.dataset.hydrated === '1');
      await page.goto('/login?next=%2Frequests');
      await hydrated();
      await page.getByLabel('Email or username').fill(username);
      await page.getByLabel('Password').fill(initial);
      await page.getByRole('button', { name: 'Sign in' }).click();

      await expect(page).toHaveURL(/\/settings\?password=required&next=%2Frequests$/);
      await hydrated();
      await expect(page.getByRole('alert').filter({ hasText: 'Choose a new password' })).toBeVisible();
      await expect(page.getByLabel('Current password')).toBeFocused();
      await settle(page);
      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);

      await page.getByLabel('Current password').fill(initial);
      await page.getByLabel('New password', { exact: true }).fill('Brand-new-pass-2026');
      await page.getByLabel('Confirm new password').fill('Brand-new-pass-2026');
      await page.getByRole('button', { name: 'Change password' }).click();
      await expect(page).toHaveURL(/\/requests$/);
      await expect(page.getByText('Your administrator asked you to choose a new password.')).toHaveCount(0);
    } finally {
      await context.close();
      await request.post(`/api/v1/users/${id}/offboard`, { data: {}, headers });
    }
  });
});
