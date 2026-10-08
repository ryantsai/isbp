import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, expect, type Page, test } from './fixtures';
import { overflowing, settle } from './helpers';

/*
 * Phase 8 process builder: a request form with a record field (CIs from the CMDB, production only), a rule across
 * fields (end after start) and an approval workflow that routes on the picked CI's facts (its support group
 * approves). Covers the builder's Rules tab, the record picker, rule errors and "Who will approve this?".
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
const formKey = `e2e-change-${suffix}`;
let formId = '';
let workflowId = '';

test.beforeAll(async ({ request }) => {
  const headers = { 'x-csrf-token': await csrfOf(request) };
  const wf = await request.post('/api/v1/workflows', {
    headers,
    data: { name: `E2E configuration change ${suffix}`, triggerKey: 'core.form-submission' },
  });
  expect(wf.status()).toBe(201);
  workflowId = ((await wf.json()) as { id: string }).id;
  const draft = {
    steps: [
      {
        id: 'owners',
        type: 'approval',
        name: {
          en: 'CI support group',
          'zh-TW': '組態項目支援群組',
          'ja-JP': '構成アイテムのサポート グループ',
        },
        approvers: [{ type: 'fact', fact: 'records.ci.ownerGroup', kind: 'group' }],
        mode: 'any',
        ifNoApprover: 'skip',
      },
    ],
  };
  expect((await request.patch(`/api/v1/workflows/${workflowId}`, { headers, data: { draft } })).ok()).toBe(
    true,
  );
  expect((await request.post(`/api/v1/workflows/${workflowId}/publish`, { headers })).ok()).toBe(true);

  const form = await request.post('/api/v1/forms', {
    headers,
    data: { key: formKey, name: { en: `E2E change ${suffix}` }, icon: 'git-branch' },
  });
  expect(form.status()).toBe(201);
  formId = ((await form.json()) as { id: string }).id;
  const schema = {
    elements: [
      {
        id: 'ci',
        key: 'ci',
        type: 'record',
        label: { en: 'Configuration item', 'zh-TW': '組態項目', 'ja-JP': '構成アイテム' },
        required: true,
        record: { types: ['cmdb.ci'], where: { fact: 'environment', op: 'eq', value: 'production' } },
      },
      { id: 'start', key: 'start', type: 'date', label: { en: 'Start' }, required: true, width: 'half' },
      { id: 'end', key: 'end', type: 'date', label: { en: 'End' }, required: true, width: 'half' },
    ],
    rules: [
      {
        id: 'order',
        require: { fact: 'end', op: 'gte', valueFact: 'start' },
        message: {
          en: 'The end must be after the start',
          'zh-TW': '結束必須晚於開始',
          'ja-JP': '終了は開始より後にしてください',
        },
        fields: ['end'],
      },
    ],
  };
  const saved = await request.patch(`/api/v1/forms/${formId}`, {
    headers,
    data: { draft: schema, workflowDefinitionId: workflowId },
  });
  expect(saved.ok()).toBe(true);
  expect((await request.post(`/api/v1/forms/${formId}/publish`, { headers })).ok()).toBe(true);
});

test.afterAll(async ({ request }) => {
  const headers = { 'x-csrf-token': await csrfOf(request) };
  if (formId) await request.post(`/api/v1/forms/${formId}/archive`, { headers });
  if (workflowId) await request.post(`/api/v1/workflows/${workflowId}/archive`, { headers });
});

test('form builder: the Rules tab lists and edits rules', async ({ page }) => {
  await page.goto(`/admin/forms/${formId}?tab=rules`);
  await expect(page.getByRole('tab', { name: /Rules/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('The end must be after the start')).toBeVisible();
  await expect(page.getByText('Shown on: End')).toBeVisible();
  await expectAccessible(page);

  await page.getByRole('button', { name: 'Edit rule “The end must be after the start”' }).click();
  const sheet = page.getByRole('dialog', { name: 'Edit rule' });
  await expect(sheet).toBeVisible();
  // The rule compares two fields: the "compare with another field" toggle is on.
  await expect(sheet.getByRole('button', { name: 'Compare with another field' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expectAccessible(page);
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(sheet).toBeHidden();

  // The record field's options: types, "allow several" and the filter on the CI's facts.
  await page.goto(`/admin/forms/${formId}`);
  await page.getByRole('button', { name: 'Edit Configuration item (Record)' }).click();
  await expect(page.getByRole('checkbox', { name: /Configuration item/ }).first()).toBeChecked();
  await expect(page.getByText('Only records where…')).toBeVisible();
  await expectAccessible(page);
});

test('request form: pick a CI, see the rule error and who will approve', async ({ page }) => {
  await page.goto(`/requests/forms/${formKey}`);
  await expect(page.getByRole('heading', { name: 'Who will approve this?' })).toBeVisible();

  await page.getByRole('combobox', { name: 'Configuration item' }).click();
  await page.getByPlaceholder('Search by reference or title…').fill('erp-app');
  await page
    .getByRole('option', { name: /erp-app-01/ })
    .first()
    .click();
  await expect(page.getByRole('combobox', { name: 'Configuration item' })).toContainText('erp-app-01');

  await page.getByLabel('Start').fill('2026-11-05');
  await page.getByLabel('End').fill('2026-11-01');
  // The preview follows the answers: the CI's support group approves.
  await expect(page.getByText('CI support group')).toBeVisible();
  await expectAccessible(page);

  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText('The end must be after the start')).toBeVisible();
  await expect(page.getByLabel('End')).toHaveAttribute('aria-invalid', 'true');

  await page.getByLabel('End').fill('2026-11-06');
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page).toHaveURL(/\/requests\/REQ-\d+/);
  // The answer shows the CI as a link to its page.
  await expect(page.getByRole('link', { name: /erp-app-01/ }).first()).toBeVisible();
  await expectAccessible(page);
});

test('request form works at 375 px and in dark mode', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`/requests/forms/${formKey}`);
  await expect(page.getByRole('combobox', { name: 'Configuration item' })).toBeVisible();
  const { overflow, offenders } = await overflowing(page);
  expect(overflow, offenders.join('\n')).toBeLessThanOrEqual(0);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.evaluate(() => localStorage.setItem('theme', 'dark'));
  await page.reload();
  await expectAccessible(page);
});
