import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { settle } from './helpers';

const nav = (page: Page) => page.getByRole('navigation', { name: 'Main navigation' });

async function expectAccessible(page: Page, label: string) {
  // The page's title streams in after its content.
  await expect(page).toHaveTitle(/\S/, { timeout: 30_000 });
  await settle(page);
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
    label,
  ).toEqual([]);
}

test('Home is a personal start page: what needs you, quick actions, no platform figures', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Platform Admin');
  await expect(page.getByRole('link', { name: /Request something/ })).toBeVisible();
  await expect(page.getByText('Needs you')).toBeVisible();
  // Directory figures moved to the Administration hub.
  await expect(page.getByText('Active people')).toHaveCount(0);
});

test('the sidebar groups an area’s pages and highlights the current one', async ({ page }) => {
  await page.goto('/');
  const group = nav(page).getByRole('button', { name: 'Service desk' });
  // Groups remember whether the person keeps them open: start from closed.
  if ((await group.getAttribute('aria-expanded')) === 'true') await group.click();
  await expect(group).toHaveAttribute('aria-expanded', 'false');
  await group.click();
  await expect(group).toHaveAttribute('aria-expanded', 'true');
  await nav(page).getByRole('link', { name: 'Problems' }).click();
  await expect(page).toHaveURL(/\/itsm\/problems/);
  await expect(nav(page).getByRole('link', { name: 'Problems' })).toHaveAttribute('aria-current', 'page');
  // A problem's own page keeps Problems highlighted (not Tickets).
  const first = page
    .getByRole('main')
    .getByRole('link', { name: /PRB-\d{5}/ })
    .first();
  await first.click();
  await expect(page).toHaveURL(/\/itsm\/tickets\/PRB-/);
  await expect(nav(page).getByRole('link', { name: 'Problems' })).toHaveAttribute('aria-current', 'page');
});

test('Administration opens the hub of every setting, and stays highlighted on its pages', async ({
  page,
}) => {
  await page.goto('/');
  await nav(page).getByRole('link', { name: 'Administration' }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { name: 'Administration', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'People & access' })).toBeVisible();
  await expect(page.getByText('Active people')).toBeVisible();
  await page.getByPlaceholder('Find a setting…').fill('SLA');
  await expect(page.getByRole('link', { name: /Service desk settings/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /^People/ })).toHaveCount(0);
  await page.getByPlaceholder('Find a setting…').fill('');
  await page.getByRole('link', { name: /^People/ }).click();
  await expect(page).toHaveURL(/\/admin\/users/);
  await expect(nav(page).getByRole('link', { name: 'Administration' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expectAccessible(page, 'admin hub');
});

test('My work lists what waits for the person and opens a decision directly', async ({ page }) => {
  await page.goto('/my-work');
  await expect(page.getByRole('heading', { name: 'My work', level: 1 })).toBeVisible();
  const decide = page.getByRole('region', { name: 'To decide' });
  await expect(decide).toBeVisible();
  await decide
    .getByRole('link', { name: /REQ-|CHG-/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/approvals\?task=[0-9a-f-]{36}/, { timeout: 30_000 });
  await expect(page.getByRole('dialog')).toBeVisible();
  // Back closes the decision instead of leaving the inbox.
  await page.goBack();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page).toHaveURL(/\/(approvals|my-work)/);
});

test('command palette: grouped, translated results, references and a knowledge fallback', async ({
  page,
}) => {
  await page.goto('/');
  await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // Nothing typed: suggestions, not every page.
  await expect(dialog.getByText('Suggested')).toBeVisible();
  await dialog.getByRole('combobox').fill('maintenance');
  await expect(dialog.getByText('Announcements', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Planned maintenance: core network switches')).toBeVisible();
  await expect(dialog.getByText(/Search the knowledge base for/)).toBeVisible();
  await dialog.getByText('Planned maintenance: core network switches').click();
  await expect(page).toHaveURL(/\/announcements\/[0-9a-f-]+$/);

  await page.keyboard.press('ControlOrMeta+k');
  await dialog.getByRole('combobox').fill('REQ-01020');
  await expect(dialog.getByText('Requests', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/REQ-01020 ·/)).toBeVisible();
});

test('language and theme live in the user menu and re-render the UI', async ({ page }) => {
  await page.goto('/');
  const menu = async (label: RegExp) => {
    await page.getByRole('button', { name: label }).click();
  };
  await menu(/^Account menu/);
  await page.getByRole('menuitem', { name: /Language/ }).click();
  await page.getByRole('menuitemradio', { name: '繁體中文（台灣）' }).click();
  await expect(
    page.getByRole('navigation', { name: '主要導覽' }).getByRole('link', { name: '首頁' }),
  ).toBeVisible({
    timeout: 15_000,
  });
  await menu(/^帳戶選單/);
  await page.getByRole('menuitem', { name: /語言/ }).click();
  await page.getByRole('menuitemradio', { name: '日本語' }).click();
  await expect(
    page.getByRole('navigation', { name: 'メイン ナビゲーション' }).getByRole('link', { name: 'ホーム' }),
  ).toBeVisible({
    timeout: 15_000,
  });
  await menu(/^アカウント メニュー/);
  await page.getByRole('menuitem', { name: /言語/ }).click();
  await page.getByRole('menuitemradio', { name: 'English' }).click();
  await expect(nav(page).getByRole('link', { name: 'Home' })).toBeVisible({ timeout: 15_000 });
});

test('on a phone the navigation drawer scrolls to its last entry', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 640 });
  await page.goto('/');
  await page.getByRole('button', { name: /^Open navigation/ }).click();
  const drawer = page.getByRole('dialog');
  const last = drawer.getByRole('link', { name: 'Administration' });
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  await last.click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(drawer).toBeHidden();
});

test('Home, My work and the hub have no serious accessibility violations (light and dark)', async ({
  page,
}) => {
  test.setTimeout(180_000);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.goto('/');
    await page.evaluate((s) => localStorage.setItem('theme', s), scheme);
    for (const path of ['/', '/my-work', '/admin']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectAccessible(page, `${path} ${scheme}`);
    }
  }
});
