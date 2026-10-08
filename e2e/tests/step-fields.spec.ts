import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, type Browser, expect, type Page, test } from './fixtures';
import { overflowing, settle } from './helpers';

/*
 * Phase 8 approval step fields: the approval step asks its approver to fill something in with the decision (the
 * "filled in by IT" part of a paper form). In the inbox, Approve is blocked until the required field is filled; the
 * request page then shows the values under "Filled in by approvers".
 */

const DEMO_PASSWORD = process.env.E2E_DEMO_PASSWORD ?? 'Demo-2026!pass';

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

/** An API session of another demo user (the requester: nobody may approve their own request). */
async function apiAs(browser: Browser, baseURL: string, username: string) {
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const login = await context.request.post('/api/v1/auth/login', {
    data: { username, password: DEMO_PASSWORD },
  });
  expect(login.ok()).toBeTruthy();
  const { csrfToken } = (await login.json()) as { csrfToken: string };
  return { context, request: context.request, headers: { 'x-csrf-token': csrfToken } };
}

test.describe.configure({ mode: 'serial' });

const suffix = Date.now().toString(36);
const formKey = `e2e-disposal-${suffix}`;
const notes = `Disk shredded on site (${suffix})`;
let formId = '';
let workflowId = '';
let reference = '';

test.beforeAll(async ({ request }) => {
  const headers = { 'x-csrf-token': await csrfOf(request) };
  const me = ((await (await request.get('/api/v1/me')).json()) as { id: string }).id;
  const wf = await request.post('/api/v1/workflows', {
    headers,
    data: { name: `E2E disposal review ${suffix}`, triggerKey: 'core.form-submission' },
  });
  expect(wf.status()).toBe(201);
  workflowId = ((await wf.json()) as { id: string }).id;
  const draft = {
    steps: [
      {
        id: 'review',
        type: 'approval',
        name: { en: 'IT review', 'zh-TW': 'IT 審查', 'ja-JP': 'IT レビュー' },
        approvers: [{ type: 'user', userId: me }],
        mode: 'any',
        fields: [
          {
            key: 'handling',
            type: 'textarea',
            label: { en: 'Handling notes', 'zh-TW': '處理說明', 'ja-JP': '処理メモ' },
            required: true,
          },
          {
            key: 'assetTag',
            type: 'text',
            label: { en: 'Asset tag', 'zh-TW': '資產標籤', 'ja-JP': '資産タグ' },
          },
        ],
      },
    ],
  };
  const patched = await request.patch(`/api/v1/workflows/${workflowId}`, { headers, data: { draft } });
  expect(patched.ok()).toBe(true);
  expect(((await patched.json()) as { issues: unknown[] }).issues).toEqual([]);
  expect((await request.post(`/api/v1/workflows/${workflowId}/publish`, { headers })).ok()).toBe(true);

  const form = await request.post('/api/v1/forms', {
    headers,
    data: { key: formKey, name: { en: `E2E disposal ${suffix}` }, icon: 'trash-2' },
  });
  expect(form.status()).toBe(201);
  formId = ((await form.json()) as { id: string }).id;
  const schema = {
    elements: [{ id: 'asset', key: 'asset', type: 'text', label: { en: 'Asset' }, required: true }],
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

test('the approver must fill in the step’s required field to approve', async ({ browser, baseURL, page }) => {
  // The requester sends the request; the admin is its approver.
  const requester = await apiAs(browser, baseURL!, 'helpdesk');
  const sent = await requester.request.post(`/api/v1/forms/by-key/${formKey}/submissions`, {
    headers: requester.headers,
    data: { data: { asset: `Laptop TPE-${suffix}` } },
  });
  expect(sent.status()).toBe(201);
  reference = ((await sent.json()) as { reference: string }).reference;
  await requester.context.close();

  await page.goto(`/approvals?q=${reference}`);
  const card = page.getByRole('listitem').filter({ hasText: reference });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: /^Approve/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Approve this request?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'To fill in' })).toBeVisible();
  await expect(dialog.getByLabel('Handling notes')).toBeVisible();
  await expect(dialog.getByLabel('Asset tag')).toBeVisible();
  await expectAccessible(page);

  // Blocked: the required field is empty.
  await dialog.getByRole('button', { name: 'Approve' }).click();
  await expect(dialog.getByText('This field is required')).toBeVisible();
  await expect(dialog).toBeVisible();
  await expectAccessible(page);

  await dialog.getByLabel('Handling notes').fill(notes);
  await dialog.getByLabel('Comment (optional)').fill('Checked for the e2e run.');
  await dialog.getByRole('button', { name: 'Approve' }).click();
  await expect(dialog).toBeHidden();
});

/** The "Filled in by approvers" card of the request page. */
const decisionsCard = (page: Page) =>
  page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByText('Filled in by approvers', { exact: true }) });

test('the request page shows what the approver filled in', async ({ page }) => {
  await page.goto(`/requests/${reference}`);
  const card = decisionsCard(page);
  await expect(card).toBeVisible();
  await expect(card.getByText('What the approvers recorded with their decisions.')).toBeVisible();
  await expect(card.getByText('IT review')).toBeVisible();
  await expect(card.getByText('Handling notes')).toBeVisible();
  await expect(card.getByText(notes)).toBeVisible();
  // The optional field left empty isn't listed.
  await expect(card.getByText('Asset tag')).toHaveCount(0);
  // The history shows the values with the decision too.
  await expect(page.getByText(notes)).toHaveCount(2);
  await expectAccessible(page);
});

test('the request page with decisions works at 375 px and in dark mode', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`/requests/${reference}`);
  await expect(decisionsCard(page)).toBeVisible();
  await settle(page);
  const { overflow, offenders } = await overflowing(page);
  expect(overflow, offenders.join('\n')).toBeLessThanOrEqual(0);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.evaluate(() => localStorage.setItem('theme', 'dark'));
  await page.reload();
  await expect(decisionsCard(page).getByText(notes)).toBeVisible();
  await expectAccessible(page);
  await page.evaluate(() => localStorage.removeItem('theme'));
});
