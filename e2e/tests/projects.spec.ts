import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, expect, type Page, test } from './fixtures';
import { settle } from './helpers';

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

/** The seeded core switch task of the network refresh (the lead's cross-module seed links it). */
async function coreSwitchTask(request: APIRequestContext) {
  const res = (await (
    await request.get('/api/v1/projects/tasks?project=NET&q=tpe-sw-core-01&pageSize=10')
  ).json()) as { items: { reference: string; title: string }[] };
  return res.items.find((t) => t.title === 'Replace core switch tpe-sw-core-01')!;
}

const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

test.describe.configure({ mode: 'serial' });

const title = `E2E cable audit ${Date.now()}`;

test('portfolio lists the network refresh', async ({ page }) => {
  await page.goto('/projects');
  await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Network refresh 2026' })).toBeVisible();
  await page.getByRole('tab', { name: 'Proposed' }).click();
  await expect(page).toHaveURL(/filter=proposed/);
  await expect(page.getByRole('link', { name: 'Kaohsiung office opening' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Network refresh 2026' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Projects' })).toBeVisible();
});

test('a proposal says who decides and by when; the approval path opens in a sheet', async ({ page }) => {
  await page.goto('/projects/KHH');
  await expect(page.getByRole('heading', { name: 'Kaohsiung office opening', level: 1 })).toBeVisible();
  await expect(page.getByText('Waiting for approval')).toBeVisible();
  await expect(page.getByText('Not assessed yet').first()).toBeVisible();
  await page.getByRole('button', { name: 'Show approval path' }).click();
  const sheet = page.getByRole('dialog', { name: 'Approval path' });
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});

test('board: quick-add, move with the keyboard and with "Move to…"', async ({ page }) => {
  await page.goto('/projects/NET?view=board');
  await expect(page.getByRole('heading', { name: 'Network refresh 2026', level: 1 })).toBeVisible();
  const todo = column(page, 'To do');
  await todo.getByRole('button', { name: 'Add task' }).click();
  await todo.getByRole('textbox', { name: 'New task title' }).fill(title);
  await todo.getByRole('button', { name: 'Add', exact: true }).click();
  const card = todo.getByRole('listitem').filter({ hasText: title });
  await expect(card).toBeVisible();
  const handle = card.getByRole('button', { name: /^Move NET-\d+$/ });
  const reference = (await handle.getAttribute('aria-label'))!.replace('Move ', '');

  // Keyboard drag: Space picks up, → moves to the next column, Space drops. The board refreshes once
  // after the quick-add, so wait for the screen-reader announcement before moving (retry the pick-up).
  // dnd-kit's live region names the card as soon as it is picked up ("NET-41 … is now position 1 of …").
  const live = page.locator('[id^="DndLiveRegion"]');
  await expect(async () => {
    await handle.focus();
    await page.keyboard.press('Space');
    await expect(live).toContainText(reference, { timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  // The sensor listens for arrow keys a frame after the pick-up: retry → until the card is over In progress.
  await expect(async () => {
    await page.keyboard.press('ArrowRight');
    await expect(live).toContainText('in In progress', { timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
  const moved = page.waitForResponse((r) => r.url().includes(`/tasks/${reference}/move`) && r.ok());
  await page.keyboard.press('Space');
  await moved;
  await page.reload();
  await expect(column(page, 'In progress').getByRole('listitem').filter({ hasText: title })).toBeVisible();

  // The non-drag alternative.
  const inProgress = column(page, 'In progress').getByRole('listitem').filter({ hasText: title });
  await inProgress.getByRole('button', { name: `Move ${reference} to…` }).click();
  const viaMenu = page.waitForResponse((r) => r.url().includes(`/tasks/${reference}/move`) && r.ok());
  await page.getByRole('menuitem', { name: 'In review' }).click();
  await viaMenu;
  await page.reload();
  await expect(column(page, 'In review').getByRole('listitem').filter({ hasText: title })).toBeVisible();
});

test('task sheet: open a card and comment', async ({ page }) => {
  await page.goto('/projects/NET?view=board');
  const card = column(page, 'In review').getByRole('listitem').filter({ hasText: title });
  await card.getByRole('button', { name: title }).click();
  await expect(page).toHaveURL(/task=NET-\d+/);
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: title, exact: true })).toBeVisible();
  const comment = `Checked the 8F patch panels ${Date.now()}`;
  await sheet.getByRole('textbox', { name: 'Add a comment' }).fill(comment);
  await sheet.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(sheet.getByText(comment)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/task=/);
});

test('timeline: bars, dependencies and the table view', async ({ page }) => {
  await page.goto('/projects/NET?view=timeline');
  await expect(
    page.getByRole('button', { name: /NET-\d+ Replace core switch tpe-sw-core-01/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Week', exact: true }).click();
  await expect(page).toHaveURL(/zoom=week/);
  await page.getByRole('button', { name: 'View as table' }).click();
  const table = page.getByRole('table', { name: 'Tasks with dates and dependencies' });
  await expect(table).toBeVisible();
  await expect(
    table.getByRole('row').filter({ hasText: 'Replace core switch tpe-sw-core-02' }),
  ).toContainText('NET-');
  await expect(page.getByRole('table', { name: 'Milestones' })).toContainText('Rollout Hsinchu');
});

test('workload: people by week with capacity', async ({ page }) => {
  await page.goto('/projects/NET?view=workload');
  const grid = page.getByRole('region', { name: /Workload by person and week/ });
  await expect(grid).toBeVisible();
  await expect(grid.getByRole('rowheader').first()).toBeVisible();
  await expect(grid.getByRole('rowheader', { name: 'Unassigned' })).toBeVisible();
});

test('Projects pages have no accessibility violations (light and dark)', async ({ page, request }) => {
  test.setTimeout(240_000);
  const task = await coreSwitchTask(request);
  const pages: [string, string][] = [
    ['/projects', 'portfolio'],
    ['/projects/NET', 'overview'],
    ['/projects/KHH', 'proposal'],
    ['/projects/NET?view=board', 'board'],
    ['/projects/NET?view=timeline', 'timeline'],
    ['/projects/NET?view=timeline&layout=table', 'timeline table'],
    ['/projects/NET?view=workload', 'workload'],
    [`/projects/tasks/${task.reference}`, 'task page'],
    ['/projects/my-tasks', 'my tasks'],
  ];
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    for (const [path, label] of pages) {
      await page.goto(path);
      await page.evaluate((s) => localStorage.setItem('theme', s), scheme);
      await page.reload();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectAccessible(page, `${scheme} ${label}`);
    }
  }
});

test('Projects pages fit a 375px screen', async ({ page, request }) => {
  const task = await coreSwitchTask(request);
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of [
    '/projects',
    '/projects/NET',
    '/projects/NET?view=board',
    '/projects/NET?view=list',
    '/projects/NET?view=timeline',
    '/projects/NET?view=workload',
    `/projects/tasks/${task.reference}`,
    '/projects/my-tasks',
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await settle(page);
    await expectNoHorizontalScroll(page);
  }
});
