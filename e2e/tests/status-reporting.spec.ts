import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from './fixtures';
import { settle } from './helpers';

/** Project status reporting (Phase 11): the status report, who sent their update, the PMO settings, drafting one. */

async function expectAccessible(page: Page, label?: string) {
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

const PAGES: [string, string][] = [
  ['/projects/status-report', 'executive report'],
  ['/projects/status-report?template=detailed', 'detailed report'],
  ['/projects/status-updates', 'who sent their update'],
  ['/projects/reporting', 'reporting settings'],
  ['/projects/NET?view=updates', 'project updates'],
];

test('the status report says how many updates came in and downloads as Markdown', async ({ page }) => {
  await page.goto('/projects/status-report');
  await expect(page.getByRole('heading', { name: 'Status report', level: 1 })).toBeVisible();
  await expect(page.getByText(/updates received/).first()).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download Markdown' }).click();
  expect((await download).suggestedFilename()).toMatch(/^status-report-.+\.md$/);

  await page.goto('/projects/status-report?template=detailed');
  await expect(page.getByRole('heading', { name: 'Decisions in meetings' })).toBeVisible();
});

test('the PMO page holds the schedule and the report templates', async ({ page }) => {
  await page.goto('/projects/reporting');
  await expect(page.getByRole('heading', { name: 'Project status reporting', level: 1 })).toBeVisible();
  await expect(page.getByText('Reporting schedule', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Executive summary', { exact: true }).first()).toBeVisible();
  await page.goto('/projects/status-updates');
  await expect(page.getByRole('heading', { name: 'Status updates', level: 1 })).toBeVisible();
});

test('a manager drafts an update from the period without sending it', async ({ page }) => {
  await page.goto('/projects/NET?view=updates');
  await expect(page.getByRole('heading', { name: 'Network refresh 2026', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: /^(Write your update|Edit your update)$/ }).click();
  const sheet = page.getByRole('dialog', { name: /status update for NET/i });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Draft for me' }).click();
  // Replacing text already there asks first.
  const replace = page.getByRole('alertdialog');
  if (await replace.isVisible().catch(() => false))
    await replace.getByRole('button', { name: 'Replace' }).click();
  await expect(sheet.getByRole('textbox', { name: 'Summary' })).not.toHaveValue('');
  await page.keyboard.press('Escape');
});

test('status reporting pages have no accessibility violations (light and dark)', async ({ page }) => {
  test.setTimeout(180_000);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    for (const [path, label] of PAGES) {
      await page.goto(path);
      await page.evaluate((s) => localStorage.setItem('theme', s), scheme);
      await page.reload();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectAccessible(page, `${scheme} ${label}`);
    }
  }
});

test('status reporting pages fit a 375px screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const [path] of PAGES) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await settle(page);
    await expectNoHorizontalScroll(page);
  }
});
