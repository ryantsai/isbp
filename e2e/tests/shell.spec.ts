import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { settle } from './helpers';

test('dashboard shows live figures and recent activity', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Platform Admin');
  await expect(page.getByText('Active people')).toBeVisible();
  await expect(page.getByText('Recent activity')).toBeVisible();
});

test('sidebar navigation highlights the current page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation').getByRole('link', { name: 'People' }).click();
  await expect(page).toHaveURL(/\/admin\/users/);
  await expect(page.getByRole('navigation').getByRole('link', { name: 'People' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('command palette searches across modules (Ctrl/Cmd+K)', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox').fill('maintenance');
  await expect(dialog.getByText('Planned maintenance: core network switches')).toBeVisible();
  await dialog.getByText('Planned maintenance: core network switches').click();
  await expect(page).toHaveURL(/\/announcements\/[0-9a-f-]+$/);
});

test('switching language re-renders the UI in Traditional Chinese and Japanese', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Language' }).click();
  await page.getByRole('menuitemradio', { name: '繁體中文（台灣）' }).click();
  await expect(page.getByRole('navigation').getByRole('link', { name: '儀表板' })).toBeVisible();
  await page.getByRole('button', { name: '語言' }).click();
  await page.getByRole('menuitemradio', { name: '日本語' }).click();
  await expect(page.getByRole('navigation').getByRole('link', { name: 'ダッシュボード' })).toBeVisible();
  await page.getByRole('button', { name: '言語' }).click();
  await page.getByRole('menuitemradio', { name: 'English' }).click();
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Dashboard' })).toBeVisible();
});

test('dashboard has no serious accessibility violations (light and dark)', async ({ page }) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.goto('/');
    await page.evaluate((s) => localStorage.setItem('theme', s), scheme);
    await page.reload();
    await expect(page.getByText('Active people')).toBeVisible();
    await settle(page);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
      scheme,
    ).toEqual([]);
  }
});
