import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, expect, type Page, test } from './fixtures';
import { overflowing, settle } from './helpers';

/*
 * Phase 8 process actions: add an action in the form builder's Actions tab (type picker, configuration sheet with
 * "Insert value"), save, then see what it did on the request page ("What happens next").
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
const formKey = `e2e-actions-${suffix}`;
let formId = '';
let reference = '';

test.beforeAll(async ({ request }) => {
  const headers = { 'x-csrf-token': await csrfOf(request) };
  const form = await request.post('/api/v1/forms', {
    headers,
    data: { key: formKey, name: { en: `E2E actions ${suffix}` }, icon: 'bell' },
  });
  expect(form.status()).toBe(201);
  formId = ((await form.json()) as { id: string }).id;
  const draft = {
    elements: [{ id: 'what', key: 'what', type: 'text', label: { en: 'What do you need?' }, required: true }],
  };
  expect((await request.patch(`/api/v1/forms/${formId}`, { headers, data: { draft } })).ok()).toBe(true);
});

test.afterAll(async ({ request }) => {
  const headers = { 'x-csrf-token': await csrfOf(request) };
  if (formId) await request.post(`/api/v1/forms/${formId}/archive`, { headers });
});

test('form builder: add a "Notify people" action from the Actions tab', async ({ page }) => {
  await page.goto(`/admin/forms/${formId}?tab=actions`);
  await expect(page.getByRole('tab', { name: /Actions/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('No actions yet')).toBeVisible();
  await expectAccessible(page);

  await page.getByRole('button', { name: 'Add action' }).click();
  const picker = page.getByRole('dialog', { name: 'Add an action' });
  await expect(picker.getByRole('button', { name: /Raise a change/ })).toBeVisible();
  await expectAccessible(page);
  await picker.getByRole('button', { name: /Notify people/ }).click();

  const sheet = page.getByRole('dialog', { name: /Notify people/ });
  await expect(sheet).toBeVisible();
  const title = sheet.getByRole('textbox', { name: 'Title', exact: true });
  await title.fill('Got your request ');
  // "Insert value" puts a template at the cursor.
  await sheet.getByRole('button', { name: 'Insert a value into Title' }).click();
  await page.getByRole('menuitem', { name: /Request number/ }).click();
  await expect(title).toHaveValue('Got your request {{request.reference}}');
  await expectAccessible(page);
  await sheet.getByRole('button', { name: 'Add action' }).click();
  await expect(sheet).toBeHidden();

  await expect(page.getByRole('listitem').filter({ hasText: 'Notify people' })).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Unsaved changes')).toBeHidden();
});

test('request page: shows what the action did', async ({ page, request }) => {
  const headers = { 'x-csrf-token': await csrfOf(request) };
  expect((await request.post(`/api/v1/forms/${formId}/publish`, { headers })).ok()).toBe(true);
  const sub = await request.post(`/api/v1/forms/by-key/${formKey}/submissions`, {
    headers,
    data: { data: { what: 'A second monitor' } },
  });
  expect(sub.status()).toBe(201);
  reference = ((await sub.json()) as { reference: string }).reference;

  await page.goto(`/requests/${reference}`);
  await expect(page.getByRole('heading', { name: 'What happens next' })).toBeVisible();
  const action = page.getByRole('listitem').filter({ hasText: 'Notify people' });
  // Runs in the worker after the request was saved.
  await expect(action.getByText('Done')).toBeVisible({ timeout: 30_000 });
  await expectAccessible(page);
});

test('Actions tab and request page work at 375 px and in dark mode', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  for (const path of [`/admin/forms/${formId}?tab=actions`, `/requests/${reference}`]) {
    await page.goto(path);
    await settle(page);
    const { overflow, offenders } = await overflowing(page);
    expect(overflow, offenders.join('\n')).toBeLessThanOrEqual(0);
  }
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.evaluate(() => localStorage.setItem('theme', 'dark'));
  await page.goto(`/admin/forms/${formId}?tab=actions`);
  await expect(page.getByRole('listitem').filter({ hasText: 'Notify people' })).toBeVisible();
  await expectAccessible(page);
  await page.goto(`/requests/${reference}`);
  await expectAccessible(page);
});
