import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, type Browser, expect, type Page, test } from './fixtures';
import { overflowing, settle } from './helpers';

/*
 * Phase 8 requests as records (`core.request`): the request page hosts the platform's Attachments and Linked records
 * panels, so the requester attaches evidence (a quote, a delivery note) to their own request.
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

/** A second, independent browser session for another demo user, pinned to English. */
async function signInAs(browser: Browser, baseURL: string, username: string) {
  const context = await browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
    locale: 'en-US',
  });
  await context.addCookies([{ name: 'isbp_locale', value: 'en', url: baseURL }]);
  const login = await context.request.post('/api/v1/auth/login', {
    data: { username, password: DEMO_PASSWORD },
  });
  expect(login.ok()).toBeTruthy();
  const { csrfToken: csrf, user } = (await login.json()) as { csrfToken: string; user: { locale: string } };
  // The profile language wins over the browser's: switch to English for the test, restore afterwards.
  const headers = { 'x-csrf-token': csrf };
  await context.request.patch('/api/v1/me', { data: { locale: 'en' }, headers });
  return {
    context,
    headers,
    page: await context.newPage(),
    async close() {
      await context.request.patch('/api/v1/me', { data: { locale: user.locale }, headers });
      await context.close();
    },
  };
}

test.describe.configure({ mode: 'serial' });

const suffix = Date.now().toString(36);
const formKey = `e2e-evidence-${suffix}`;
const fileName = `delivery-note-${suffix}.txt`;
let formId = '';
let submissionId = '';
let reference = '';

test.beforeAll(async ({ request }) => {
  const headers = { 'x-csrf-token': await csrfOf(request) };
  const form = await request.post('/api/v1/forms', {
    headers,
    data: { key: formKey, name: { en: `E2E equipment return ${suffix}` }, icon: 'package' },
  });
  expect(form.status()).toBe(201);
  formId = ((await form.json()) as { id: string }).id;
  const draft = {
    elements: [{ id: 'item', key: 'item', type: 'text', label: { en: 'Item' }, required: true }],
  };
  expect((await request.patch(`/api/v1/forms/${formId}`, { headers, data: { draft } })).ok()).toBe(true);
  expect((await request.post(`/api/v1/forms/${formId}/publish`, { headers })).ok()).toBe(true);
});

test.afterAll(async ({ request }) => {
  if (formId)
    await request.post(`/api/v1/forms/${formId}/archive`, {
      headers: { 'x-csrf-token': await csrfOf(request) },
    });
});

test('the requester attaches a file on the request page', async ({ browser, baseURL, request }) => {
  const requester = await signInAs(browser, baseURL!, 'helpdesk');
  const sent = await requester.context.request.post(`/api/v1/forms/by-key/${formKey}/submissions`, {
    headers: requester.headers,
    data: { data: { item: `Monitor ${suffix}` } },
  });
  expect(sent.status()).toBe(201);
  ({ id: submissionId, reference } = (await sent.json()) as { id: string; reference: string });

  const p = requester.page;
  await p.goto(`/requests/${reference}`);
  await expect(p.getByRole('heading', { name: `E2E equipment return ${suffix}` })).toBeVisible();
  await expect(p.getByText(reference, { exact: true }).first()).toBeVisible();
  await expect(p.getByRole('region', { name: /Linked records/ })).toBeVisible();
  const panel = p.getByRole('region', { name: /Attachments/ });
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Drag files here, or use Upload.')).toBeVisible();
  await expectAccessible(p);

  const chooser = p.waitForEvent('filechooser');
  await panel.getByRole('button', { name: 'Upload' }).click();
  await (
    await chooser
  ).setFiles({
    name: fileName,
    mimeType: 'text/plain',
    buffer: Buffer.from(`Returned: Monitor ${suffix}\nReceived by the service desk.\n`),
  });
  await expect(panel.getByRole('link', { name: fileName, exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: `Delete ${fileName}` })).toBeVisible();

  // Kept with the request: after a reload, and for the form administrator.
  await p.reload();
  await expect(
    p.getByRole('region', { name: /Attachments/ }).getByRole('link', { name: fileName, exact: true }),
  ).toBeVisible();
  await expectAccessible(p);
  const files = (await (await request.get(`/api/v1/records/core.request/${submissionId}/files`)).json()) as {
    files: { name: string }[];
  };
  expect(files.files.map((f) => f.name)).toContain(fileName);
  await requester.close();
});

test('the request page with evidence works at 375 px and in dark mode', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`/requests/${reference}`);
  const panel = page.getByRole('region', { name: /Attachments/ });
  await expect(panel.getByRole('link', { name: fileName, exact: true })).toBeVisible();
  await settle(page);
  const { overflow, offenders } = await overflowing(page);
  expect(overflow, offenders.join('\n')).toBeLessThanOrEqual(0);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.evaluate(() => localStorage.setItem('theme', 'dark'));
  await page.reload();
  await expect(panel.getByRole('link', { name: fileName, exact: true })).toBeVisible();
  await expectAccessible(page);
  await page.evaluate(() => localStorage.removeItem('theme'));
});
