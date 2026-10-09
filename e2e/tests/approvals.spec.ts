import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, type Browser, expect, type Page, test } from './fixtures';
import { settle } from './helpers';

const DEMO_PASSWORD = process.env.E2E_DEMO_PASSWORD ?? 'Demo-2026!pass';

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
    csrf,
    page: await context.newPage(),
    async close() {
      await context.request.patch('/api/v1/me', { data: { locale: user.locale }, headers });
      await context.close();
    },
  };
}

async function csrfOf(request: APIRequestContext) {
  return ((await (await request.get('/api/v1/auth/session')).json()) as { csrfToken: string }).csrfToken;
}

async function expectAccessible(page: Page) {
  await settle(page);
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test.describe.configure({ mode: 'serial' });

test('request access, see who will approve, get it approved in the inbox', async ({
  browser,
  page,
  request,
  baseURL,
}) => {
  // Owned by admin, who is also helpdesk's manager: admin decides both steps.
  const role = 'Workflow administrator';
  const helpdesk = await signInAs(browser, baseURL!, 'helpdesk');
  const me = (await (await helpdesk.context.request.get('/api/v1/me')).json()) as { id: string };

  // Clean slate: withdraw open requests and remove earlier grants of this role (reruns).
  const roles = (await (
    await helpdesk.context.request.get(`/api/v1/requestable-roles?q=${encodeURIComponent(role)}`)
  ).json()) as {
    items: { id: string; name: string; pendingRequest: { id: string } | null }[];
  };
  const target = roles.items.find((r) => r.name === role)!;
  if (target.pendingRequest)
    await helpdesk.context.request.post(`/api/v1/access-requests/${target.pendingRequest.id}/cancel`, {
      data: {},
      headers: { 'x-csrf-token': helpdesk.csrf },
    });
  const csrf = await csrfOf(request);
  const grants = (await (
    await request.get(`/api/v1/role-assignments?roleId=${target.id}&userId=${me.id}`)
  ).json()) as {
    items: { id: string }[];
  };
  for (const g of grants.items)
    await request.delete(`/api/v1/role-assignments/${g.id}`, { headers: { 'x-csrf-token': csrf } });

  // The requester: choose the access, say why, review the approval path, send.
  const p = helpdesk.page;
  await p.goto('/requests');
  await p
    .getByRole('region', { name: 'What do you need?' })
    .getByRole('link', { name: /Access to an application/ })
    .click();
  // The platform's own roles sit under a collapsed "Platform roles" group: open it before choosing one of them.
  await p.getByRole('button', { name: /^Platform roles/ }).click();
  await p.getByRole('radio', { name: role }).click();
  await p.getByRole('button', { name: 'Continue' }).click();
  await p.getByRole('button', { name: '30 days' }).click();
  await p
    .getByLabel('Why do you need it?')
    .fill('I approve the service desk team’s expense claims while the lead is away.');
  await p.getByRole('button', { name: 'Review' }).click();
  await expect(p.getByText('Who will approve it')).toBeVisible();
  await expect(p.getByText('Manager approval')).toBeVisible();
  await p.getByRole('button', { name: 'Send request' }).click();
  await expect(p).toHaveURL(/\/requests\/REQ-\d{5}$/);
  const reference = p.url().split('/').pop()!;
  // The status and the path both say it: the first match is the status under the title.
  await expect(p.getByText('Waiting for approval').first()).toBeVisible();

  // The approver (admin is the manager and the role owner's fallback) decides in the inbox.
  for (let step = 0; step < 2; step++) {
    await page.goto(`/approvals?q=${reference}`);
    const card = page.getByRole('listitem').filter({ hasText: reference });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: /^Approve/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Comment (optional)').fill('Approved for the e2e run.');
    await dialog.getByRole('button', { name: 'Approve' }).click();
    await expect(dialog).toBeHidden();
  }

  // Granted (asynchronously, by the worker) — the requester sees it.
  await expect(async () => {
    await p.reload();
    await expect(p.getByText(/Access granted/)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await expect(p.getByText('Approved for the e2e run.').first()).toBeVisible();
  await helpdesk.close();
});

test('rejecting requires a reason', async ({ page }) => {
  await page.goto('/approvals');
  // The first card of the inbox (the sidebar's own list items come first in the page).
  const first = page.getByRole('list', { name: 'Waiting for me' }).getByRole('listitem').first();
  await expect(first).toBeVisible();
  await first.getByRole('button', { name: /^Reject/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Reject' }).click();
  await expect(dialog.getByText('Give the requester a reason.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
});

test('submit a form with conditional fields', async ({ browser, baseURL }) => {
  const helpdesk = await signInAs(browser, baseURL!, 'helpdesk');
  const p = helpdesk.page;
  await p.goto('/requests');
  await p
    .getByRole('region', { name: 'What do you need?' })
    .getByRole('link', { name: /Request a laptop or equipment/ })
    .click();
  await expect(p.getByRole('heading', { name: /Request a laptop or equipment/ })).toBeVisible();
  // The laptop model only appears for laptops.
  await expect(p.getByLabel('Laptop model')).toHaveCount(0);
  await p.getByRole('combobox', { name: 'Item' }).click();
  await p.getByRole('option', { name: 'Laptop' }).click();
  await expect(p.getByRole('combobox', { name: 'Laptop model' })).toBeVisible();
  await p.getByRole('button', { name: 'Submit' }).click();
  await expect(p.getByText('This field is required').first()).toBeVisible();
  await p.getByRole('combobox', { name: 'Laptop model' }).click();
  await p.getByRole('option', { name: 'Standard 14″' }).click();
  await p.getByLabel('Estimated cost (TWD)').fill('27000');
  await p.getByLabel('Business justification').fill('Replacement for a broken laptop (e2e).');
  await p.getByRole('button', { name: 'Submit' }).click();
  await expect(p).toHaveURL(/\/requests\/REQ-\d{5}$/);
  await expect(p.getByText('Standard 14″')).toBeVisible();
  await expect(p.getByText('Who will approve it').first()).toBeVisible();
  await helpdesk.close();
});

test('workflow builder: add a step and test the path without saving', async ({ page }) => {
  await page.goto('/admin/workflows');
  await page.getByRole('link', { name: /Privileged access/ }).click();
  await expect(page.getByRole('heading', { name: 'Privileged access' })).toBeVisible();
  await page.getByRole('button', { name: 'Add a step here' }).first().click();
  await page.getByRole('menuitem', { name: /Notification/ }).click();
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await page.getByRole('tab', { name: 'Test' }).click();
  await page.getByRole('button', { name: 'Run test' }).click();
  await expect(page.getByText('Result: approved')).toBeVisible();
});

for (const [name, path] of [
  ['approvals inbox', '/approvals'],
  ['requests portal', '/requests'],
  ['request access wizard', '/requests/access'],
  ['workflows', '/admin/workflows'],
] as const) {
  test(`${name} has no serious accessibility violations`, async ({ page }) => {
    await page.goto(path);
    await expectAccessible(page);
  });
}

test('workflow builder and a request page have no serious accessibility violations', async ({
  page,
  request,
}) => {
  await page.goto('/admin/workflows');
  await page.getByRole('link', { name: /Privileged access/ }).click();
  await expect(page.getByRole('heading', { name: 'Privileged access' })).toBeVisible();
  await expectAccessible(page);
  // A request admin decided on (earlier in this file), opened from its approval.
  const done = (await (await request.get('/api/v1/me/approvals?status=done&pageSize=1')).json()) as {
    items: { instance: { subject: { href: string } } }[];
  };
  await page.goto(done.items[0]!.instance.subject.href);
  await expect(
    page.getByText('Who will approve it').or(page.getByText("This request doesn't need approval.")),
  ).toBeVisible();
  await expectAccessible(page);
});
