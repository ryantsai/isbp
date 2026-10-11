import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, expect, type Page, test } from './fixtures';
import { overflowing, settle } from './helpers';

/*
 * Phase 8 process plumbing (§15.8a): a form with a table field (add, fill, reorder and remove rows, cell errors), the
 * request page showing the rows as a table, and the print view (answers, decisions, actions, attachments) — light,
 * accessible and usable at 375 px.
 */

async function expectAccessible(page: Page) {
  await settle(page);
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

async function csrfOf(request: APIRequestContext) {
  return ((await (await request.get('/api/v1/auth/session')).json()) as { csrfToken: string }).csrfToken;
}

test.describe.configure({ mode: 'serial' });

const suffix = Date.now().toString(36);
const formKey = `e2e-table-${suffix}`;
const formName = `E2E firewall rules ${suffix}`;
let formId = '';
let reference = '';

test.beforeAll(async ({ request }) => {
  const headers = { 'x-csrf-token': await csrfOf(request) };
  const form = await request.post('/api/v1/forms', {
    headers,
    data: { key: formKey, name: { en: formName }, icon: 'shield' },
  });
  expect(form.status()).toBe(201);
  formId = ((await form.json()) as { id: string }).id;
  const draft = {
    elements: [
      { id: 'purpose', key: 'purpose', type: 'text', label: { en: 'Purpose' }, required: true },
      {
        id: 'rules',
        key: 'rules',
        type: 'rows',
        label: { en: 'Firewall rules' },
        required: true,
        rows: {
          max: 5,
          fields: [
            { key: 'source', type: 'text', label: { en: 'Source' }, required: true },
            {
              key: 'port',
              type: 'number',
              label: { en: 'Port' },
              required: true,
              validation: { min: 1, max: 65535 },
            },
            {
              key: 'protocol',
              type: 'select',
              label: { en: 'Protocol' },
              defaultValue: 'tcp',
              options: [
                { value: 'tcp', label: { en: 'TCP' } },
                { value: 'udp', label: { en: 'UDP' } },
              ],
            },
          ],
        },
      },
    ],
    actions: [
      {
        id: 'ssh',
        on: 'submitted',
        type: 'core.notify',
        when: { fact: 'data.rules.port', op: 'eq', value: 22 },
        config: { toRequester: true, title: 'SSH requested', message: '{{answers.rules}}' },
      },
    ],
  };
  const saved = await request.patch(`/api/v1/forms/${formId}`, { headers, data: { draft } });
  expect(saved.ok(), await saved.text()).toBe(true);
  expect((await request.post(`/api/v1/forms/${formId}/publish`, { headers })).ok()).toBe(true);
});

test.afterAll(async ({ request }) => {
  const headers = { 'x-csrf-token': await csrfOf(request) };
  if (formId) await request.post(`/api/v1/forms/${formId}/archive`, { headers });
});

test('form builder: a table field shows its columns and opens the column editor', async ({ page }) => {
  await page.goto(`/admin/forms/${formId}`);
  await page.getByRole('button', { name: /Edit Firewall rules/ }).click();
  await expect(page.getByRole('heading', { name: 'Columns' })).toBeVisible();
  const columns = page.getByRole('list', { name: 'Columns' });
  await expect(columns.getByRole('listitem')).toHaveCount(3);
  await columns.getByRole('button', { name: /Port/ }).first().click();
  await expect(page.getByLabel('Minimum', { exact: true })).toBeVisible();
  await expectAccessible(page);
});

test('filling in a table: add, fill, move and remove rows; cell errors on the cell', async ({ page }) => {
  await page.goto(`/requests/forms/${formKey}`);
  await page.getByLabel('Purpose').fill('Remote support for the ERP vendor');
  const table = page.getByRole('group', { name: 'Firewall rules' });
  const rows = table.getByRole('list', { name: 'Rows of Firewall rules' });
  // A required table starts with one empty row.
  await expect(rows.getByRole('group', { name: 'Row 1' })).toBeVisible();
  const row1 = rows.getByRole('group', { name: 'Row 1' });
  await row1.getByLabel('Source').fill('10.0.0.0/24');
  await row1.getByLabel('Port').fill('70000');

  // Keyboard: "Add row" focuses the new row's first cell.
  await page.getByRole('button', { name: 'Add row' }).click();
  const row2 = rows.getByRole('group', { name: 'Row 2' });
  await expect(row2.getByLabel('Source')).toBeFocused();
  await page.keyboard.type('vendor-gw');
  await row2.getByLabel('Port').fill('22');
  await expect(page.getByText('2 rows of at most 5')).toBeVisible();

  await page.getByRole('button', { name: 'Submit' }).click();
  // The cell's own error, under the cell.
  await expect(row1.getByText('Enter at most 65535')).toBeVisible();
  await expect(row1.getByLabel('Port')).toHaveAttribute('aria-invalid', 'true');
  await row1.getByLabel('Port').fill('443');
  // A number commits on blur: leave the cell before clicking elsewhere.
  await row1.getByLabel('Port').press('Tab');

  // Move row 2 up, then add and remove a third row.
  await page.getByRole('button', { name: 'Move row 2 up' }).click();
  await expect(rows.getByRole('group', { name: 'Row 1' }).getByLabel('Source')).toHaveValue('vendor-gw');
  await page.getByRole('button', { name: 'Add row' }).click();
  await page.getByRole('button', { name: 'Remove row 3' }).click();
  await expect(rows.getByRole('group', { name: 'Row 3' })).toHaveCount(0);
  await expectAccessible(page);

  await page.getByRole('button', { name: 'Submit' }).click();
  await page.waitForURL(/\/requests\/REQ-\d+$/);
  reference = page.url().split('/').pop()!;
});

test('request page: the rows as a table, the conditional action, and Print', async ({ page }) => {
  await page.goto(`/requests/${reference}`);
  const answers = page.getByRole('table', { name: 'Firewall rules' });
  await expect(answers.getByRole('columnheader', { name: 'Port' })).toBeVisible();
  await expect(answers.getByRole('row')).toHaveCount(3);
  await expect(answers.getByRole('row').nth(1)).toContainText('vendor-gw');
  // The SSH action's condition held (a row with port 22): it ran.
  const action = page.getByRole('listitem').filter({ hasText: 'Notify people' });
  await expect(action.getByText('Done')).toBeVisible({ timeout: 30_000 });
  await expectAccessible(page);
  await page.getByRole('link', { name: 'Print' }).click();
  await page.waitForURL(`**/requests/${reference}/print`);
});

test('print view: everything on one light page, accessible, at 375 px too', async ({ page }) => {
  await page.goto(`/requests/${reference}/print`);
  await expect(page.getByRole('heading', { level: 1, name: formName })).toBeVisible();
  await expect(page.getByText('Version 1')).toBeVisible();
  for (const section of ['Summary', 'Answers', 'Approval decisions', 'Actions', 'Attachments'])
    await expect(page.getByRole('heading', { level: 2, name: section })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Firewall rules' })).toContainText('10.0.0.0/24');
  await expect(page.getByText("This request doesn't need approval.")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Print' })).toBeVisible();
  await expectAccessible(page);

  // The viewer's dark theme doesn't apply to the print view.
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.evaluate(() => localStorage.setItem('theme', 'dark'));
  await page.reload();
  const background = await page.evaluate(
    () => getComputedStyle(document.body.firstElementChild!).backgroundColor,
  );
  expect(background).not.toBe('');
  const scheme = await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
  expect(scheme).toBe('light');
  await expectAccessible(page);

  // Printing hides the toolbar.
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('button', { name: 'Print' })).toBeHidden();
  await page.emulateMedia({ media: 'screen' });

  await page.setViewportSize({ width: 375, height: 800 });
  for (const path of [
    `/requests/forms/${formKey}`,
    `/requests/${reference}`,
    `/requests/${reference}/print`,
  ]) {
    await page.goto(path);
    await settle(page);
    const { overflow, offenders } = await overflowing(page);
    expect(overflow, offenders.join('\n')).toBeLessThanOrEqual(0);
  }
});

test('form and request page in dark mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  // Storage belongs to the app's origin: open a page first.
  await page.goto(`/requests/forms/${formKey}`);
  await page.evaluate(() => localStorage.setItem('theme', 'dark'));
  await page.reload();
  await expect(page.getByRole('list', { name: 'Rows of Firewall rules' })).toBeVisible();
  await expectAccessible(page);
  await page.goto(`/requests/${reference}`);
  await expect(page.getByRole('table', { name: 'Firewall rules' })).toBeVisible();
  await expectAccessible(page);
});
