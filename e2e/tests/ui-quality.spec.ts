import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';
import { overflowing, settle } from './helpers';

test('closed sheets defer their contents; opening a person form needs no server navigation', async ({
  page,
}) => {
  const assistantReads: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/assistant/status')) assistantReads.push(request.url());
  });
  await page.goto('/admin/users');
  await expect(page.getByRole('table', { name: 'People' }).getByRole('link').first()).toBeVisible();
  await expect(page.locator('[data-slot="sheet-content"]')).toHaveCount(0);
  expect(assistantReads).toEqual([]);
  const serverNavigations: string[] = [];
  page.on('request', (request) => {
    // Production also prefetches visible record/sidebar links; only the current list would be a form navigation.
    if (request.headers()['rsc'] === '1' && new URL(request.url()).pathname === '/admin/users')
      serverNavigations.push(request.url());
  });
  await page.getByRole('button', { name: 'Add person', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Add a person' })).toBeVisible();
  await expect(page).toHaveURL(/create=1/);
  expect(serverNavigations).toEqual([]);
});

test('error notifications stay above a sheet and its discard confirmation, with working dismiss controls', async ({
  page,
  request,
}) => {
  const { items } = (await (await request.get('/api/v1/users?q=helpdesk')).json()) as {
    items: { id: string; displayName: string }[];
  };
  const user = items[0]!;
  let loadGroups = () => {};
  const groupsReady = new Promise<void>((resolve) => {
    loadGroups = resolve;
  });
  await page.route('**/api/v1/groups?*', async (route) => {
    await groupsReady;
    await route.continue();
  });
  await page.route(`**/api/v1/users/${user.id}/groups`, async (route) => {
    await route.fulfill({
      status: 409,
      json: { error: { code: 'QUALITY_TEST_ERROR', message: 'Quality check failure' } },
    });
  });
  await page.goto(`/admin/users/${user.id}?tab=groups`);
  await page.getByRole('button', { name: 'Add to groups', exact: true }).click();
  const add = page.getByRole('dialog', { name: `Add ${user.displayName} to groups` });
  const groups = add.getByRole('combobox', { name: /groups/i });
  await expect(groups).toBeDisabled();
  loadGroups();
  await groups.fill('Network');
  await page.getByRole('option', { name: /Network Team/ }).click();
  await add.getByRole('button', { name: 'Add to 1 group' }).click();
  const host = page.locator('[data-slot="toast-host"]');
  await expect(host.getByText('Quality check failure', { exact: true })).toBeVisible();
  await expect(add.locator('[data-slot="toast-host"]')).toHaveCount(1);
  await host.getByRole('button').click({ trial: true });
  await add.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Move to another department', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: `Move ${user.displayName} to another department` });
  await sheet.getByRole('combobox', { name: /New department/ }).click();
  await page
    .getByRole('option', { name: /Infrastructure/ })
    .first()
    .click();
  await expect(sheet.locator('[data-slot="toast-host"]')).toHaveCount(1);
  const toastId = await host.locator('[data-toast-id]').getAttribute('data-toast-id');
  await sheet.getByRole('button', { name: 'Close', exact: true }).click();
  const confirmation = page.getByRole('alertdialog', { name: 'Discard changes?' });
  await expect(confirmation).toBeVisible();
  await expect(confirmation.locator('[data-slot="toast-host"]')).toHaveCount(1);
  await expect(host.locator('[data-toast-id]')).toHaveAttribute('data-toast-id', toastId!);
  // A high z-index alone would still be inert outside the modal: verify the real hit target and keyboard access.
  const dismiss = host.getByRole('button');
  await dismiss.click({ trial: true });
  await page.keyboard.press('F6');
  await expect(dismiss).toBeFocused();
  await confirmation.getByRole('button', { name: 'Keep editing' }).click();
  await expect(sheet.locator('[data-slot="toast-host"]')).toHaveCount(1);
  await sheet.getByRole('button', { name: 'Close', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.locator('body > [data-slot="toast-host"]')).toHaveCount(1);
  await dismiss.click();
  await expect(host.locator('[data-toast-id]')).toHaveCount(0);
});

test('people columns and filters fit narrow screens in both themes', async ({ page }) => {
  for (const theme of ['light', 'dark']) {
    await page.goto('/admin/users');
    await page.evaluate((value) => localStorage.setItem('theme', value), theme);
    await page.reload();
    await expect(page.getByRole('table', { name: 'People' }).getByRole('link').first()).toBeVisible();
    for (const width of [1440, 1280, 375]) {
      await page.setViewportSize({ width, height: 900 });
      expect((await overflowing(page)).overflow).toBeLessThanOrEqual(1);
      const table = page.getByRole('table', { name: 'People' });
      await expect
        .poll(
          () => table.evaluate((el) => el.getBoundingClientRect().width <= el.parentElement!.clientWidth + 1),
          { message: `${theme} at ${width}px` },
        )
        .toBe(true);
      await expect(table.getByRole('columnheader', { name: /Status/ })).toBeVisible();
    }
    await page.screenshot({ path: test.info().outputPath(`people-${theme}-375.png`) });
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    const filters = page.getByRole('dialog', { name: 'Filters', exact: true });
    await expect(filters).toBeVisible();
    await settle(page);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({ target: n.target, reason: n.failureSummary })),
      })),
    ).toEqual([]);
    await filters.getByRole('button', { name: 'Show results', exact: true }).click();
  }
});

test('changing a search cancels the obsolete list request', async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/users?*', async (route) => {
    if (new URL(route.request().url()).searchParams.get('q') === 'quality-slow') await held;
    await route.continue();
  });
  try {
    await page.goto('/admin/users');
    await expect(page.getByRole('table', { name: 'People' }).getByRole('link').first()).toBeVisible();
    const isSlow = (url: string) => new URL(url).searchParams.get('q') === 'quality-slow';
    const started = page.waitForRequest((request) => isSlow(request.url()));
    await page.getByRole('searchbox').fill('quality-slow');
    await started;
    const cancelled = page.waitForEvent('requestfailed', (request) => isSlow(request.url()));
    await page.getByRole('searchbox').fill('admin');
    await cancelled;
    await expect(page.getByRole('link', { name: 'Platform Admin', exact: true })).toBeVisible();
  } finally {
    release();
  }
});

test('the deferred assistant opens and retains an unfinished template when reopened', async ({ page }) => {
  await page.goto('/admin/users');
  const open = page.getByRole('banner').getByRole('button', { name: 'Assistant', exact: true });
  await open.click();
  const panel = page.getByRole('dialog', { name: 'Assistant', exact: true });
  await panel
    .getByRole('button', { name: /Custom field/ })
    .first()
    .click();
  const label = panel.getByRole('textbox', { name: /^Label/ });
  await label.fill('Unfinished template');
  await panel.getByRole('button', { name: 'Close the assistant', exact: true }).click();
  await expect(panel).toBeHidden();
  await open.click();
  await expect(label).toHaveValue('Unfinished template');
});
