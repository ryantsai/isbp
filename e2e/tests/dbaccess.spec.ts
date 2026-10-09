import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, type Browser, expect, type Page, test } from './fixtures';
import { settle } from './helpers';

/**
 * Database access against the seeded demo: the helpdesk lead requests "ERP reporting (read-only)" on the
 * Contoso ERP demo server through the wizard, admin approves (as the manager, then taking over the DBA
 * team's owner task), the worker provisions a real `demo_u_helpdesk` account, and the one-time password is
 * shown once. Then the DBA views (sync, unmanaged access), the Q4 access review, accessibility in both
 * themes and a 375px screen. Runs as the seeded admin unless noted.
 */

const DEMO_PASSWORD = process.env.E2E_DEMO_PASSWORD ?? 'Demo-2026!pass';
const API = '/api/v1/dbaccess';
const ROLE = 'ERP reporting (read-only)';

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

async function csrfOf(request: APIRequestContext) {
  return ((await (await request.get('/api/v1/auth/session')).json()) as { csrfToken: string }).csrfToken;
}

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

/** Approves the request's pending task assigned to admin, in the approvals inbox. */
async function approveInInbox(page: Page, reference: string) {
  await page.goto(`/approvals?q=${reference}`);
  const card = page.getByRole('listitem').filter({ hasText: reference });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: /^Approve/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Comment (optional)').fill('Approved for the e2e run.');
  await dialog.getByRole('button', { name: 'Approve' }).click();
  await expect(dialog).toBeHidden();
}

/** Pages every Database access screen is checked on (ids from the demo data). */
async function pagesToCheck(request: APIRequestContext) {
  const servers = (await (await request.get(`${API}/servers`)).json()) as {
    items: { id: string; displayName: string }[];
  };
  const erp = servers.items.find((s) => s.displayName === 'Contoso ERP (PostgreSQL)')!;
  const reviews = (await (await request.get(`${API}/reviews?status=active`)).json()) as {
    items: { id: string }[];
  };
  const mine = (await (await request.get(`${API}/me/access`)).json()) as {
    requests: { reference: string }[];
  };
  return [
    '/dbaccess',
    '/dbaccess/request',
    `/dbaccess/requests/${mine.requests[0]!.reference}`,
    '/dbaccess/grants',
    '/dbaccess/grants?tab=accounts',
    '/dbaccess/grants?tab=unmanaged',
    '/dbaccess/reviews',
    `/dbaccess/reviews/${reviews.items[0]!.id}`,
    '/dbaccess/servers',
    `/dbaccess/servers/${erp.id}`,
    `/dbaccess/servers/${erp.id}?tab=inventory`,
    `/dbaccess/servers/${erp.id}?tab=unmanaged`,
  ];
}

test.describe.configure({ mode: 'serial' });

test('request a database role, get it approved and provisioned, see the password once', async ({
  browser,
  page,
  request,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const helpdesk = await signInAs(browser, baseURL!, 'helpdesk');
  const api = helpdesk.context.request;

  // Clean slate on reruns: withdraw an open request and give back the access.
  const catalog = (await (await api.get(`${API}/catalog?q=demo_reporting`)).json()) as {
    items: { roleName: string; heldGrantId: string | null; pendingRequest: { reference: string } | null }[];
  };
  const item = catalog.items.find((i) => i.roleName === 'demo_reporting')!;
  if (item.pendingRequest)
    await api.post(`${API}/requests/${item.pendingRequest.reference}/cancel`, {
      data: {},
      headers: helpdesk.headers,
    });
  if (item.heldGrantId) {
    await api.post(`${API}/grants/${item.heldGrantId}/relinquish`, {
      data: { reason: 'Clean slate for the e2e run' },
      headers: helpdesk.headers,
    });
    await expect(async () => {
      const g = (await (await api.get(`${API}/grants/${item.heldGrantId}`)).json()) as { status: string };
      expect(['revoked', 'expired']).toContain(g.status);
    }).toPass({ timeout: 30_000 });
  }

  // The requester: portal card → wizard (choose, duration and reason, review) → send.
  const p = helpdesk.page;
  await p.goto('/requests');
  await p
    .getByRole('region', { name: 'What do you need?' })
    .getByRole('link', { name: /Direct database access/ })
    .click();
  await expect(p.getByRole('heading', { name: 'Request database access', level: 1 })).toBeVisible();
  await p.getByPlaceholder('Search roles, databases or servers…').fill('reporting');
  await p.getByRole('checkbox', { name: ROLE }).check();
  await expect(p.getByText('1 role selected')).toBeVisible();
  await p.getByRole('button', { name: 'Continue' }).click();
  await expect(p.getByText(/At most 180 days/)).toBeVisible();
  await p.getByLabel('Why do you need it?').fill('Weekly service desk KPI report from the ERP (e2e).');
  await p.getByRole('button', { name: 'Review', exact: true }).click();
  // The same review step as the access request: who will approve it, from a dry run of the workflow.
  await expect(p.getByRole('heading', { name: 'Who will approve it' })).toBeVisible();
  await expect(p.getByText('Manager approval')).toBeVisible();
  await expect(p.getByText('Role owner approval')).toBeVisible();
  await p.getByRole('button', { name: 'Send request' }).click();
  await expect(p).toHaveURL(/\/dbaccess\/requests\/DBR-\d{5}$/);
  const reference = p.url().split('/').pop()!;
  await expect(p.getByText('Waiting for approval').first()).toBeVisible();
  await expect(p.getByRole('list', { name: 'Approval path' })).toBeVisible();

  // Admin is helpdesk's manager: approve in the inbox.
  await approveInInbox(page, reference);

  // The role owner is the DBA team: admin (a workflow administrator) takes one task over, then approves.
  const csrf = await csrfOf(request);
  const me = (await (await request.get('/api/v1/me')).json()) as { id: string };
  const { instanceId } = (await (await api.get(`${API}/requests/${reference}`)).json()) as {
    instanceId: string;
  };
  let taskId = '';
  await expect(async () => {
    const inst = (await (await request.get(`/api/v1/workflow-instances/${instanceId}`)).json()) as {
      tasks: { id: string; stepId: string; status: string }[];
    };
    const task = inst.tasks.find((t) => t.stepId === 'owner' && t.status === 'pending');
    expect(task).toBeTruthy();
    taskId = task!.id;
  }).toPass({ timeout: 20_000 });
  const delegated = await request.post(`/api/v1/approvals/${taskId}/delegate`, {
    data: { userId: me.id, comment: 'Taking over for the e2e run' },
    headers: { 'x-csrf-token': csrf },
  });
  expect(delegated.ok()).toBeTruthy();
  await approveInInbox(page, reference);

  // The worker provisions the account and verifies the membership.
  await p.goto('/dbaccess');
  await expect(async () => {
    await p.reload();
    await expect(p.getByRole('button', { name: 'Show password' })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await expect(p.getByText(ROLE).first()).toBeVisible();
  await expect(p.getByText('demo_u_helpdesk').first()).toBeVisible();

  // The one-time reveal.
  await p.getByRole('button', { name: 'Show password' }).click();
  const reveal = p.getByRole('dialog', { name: 'Your database password' });
  await expect(reveal).toBeVisible();
  await reveal.getByRole('button', { name: 'Show the password' }).click();
  await expect(reveal.getByTestId('revealed-password')).toHaveText(/^[A-Za-z][A-Za-z0-9\-_.!#%*+=~]{15,63}$/);
  await expect(reveal.getByText('demo_u_helpdesk')).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(reveal).toBeHidden();
  // Second time: gone.
  await p.getByRole('button', { name: 'Password', exact: true }).click();
  await expect(p.getByRole('dialog').getByText(/already shown or has expired/)).toBeVisible();
  await p.keyboard.press('Escape');

  // The request page now says the access is granted.
  await p.goto(`/dbaccess/requests/${reference}`);
  await expect(p.getByText('Approved', { exact: true }).first()).toBeVisible();
  await expect(p.getByText('Active', { exact: true })).toBeVisible();
  await helpdesk.close();
});

test('DBA: sync servers and see unmanaged access and orphans', async ({ page }) => {
  await page.goto('/dbaccess/servers');
  await expect(page.getByRole('heading', { name: 'Servers', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Sync now: Contoso ERP (PostgreSQL)' }).click();
  await expect(
    page.getByText(/Contoso ERP \(PostgreSQL\): \d+ accounts, \d+ roles, \d+ without a request/),
  ).toBeVisible();
  // The SQL Server host does not exist: the DBA sees the server's own error.
  await page.getByRole('button', { name: 'Sync now: HR (SQL Server)' }).click();
  await expect(page.getByText(/HR \(SQL Server\) could not be synced/)).toBeVisible();

  await page.goto('/dbaccess/grants?tab=unmanaged');
  await expect(page.getByRole('heading', { name: 'Who has access', level: 1 })).toBeVisible();
  const unmanaged = page.getByRole('list', { name: 'Access without a request' });
  await expect(unmanaged.getByText('demo_u_legacy_report')).toBeVisible();
  await expect(unmanaged.getByText('TMPLOAD')).toBeVisible();
  // Adopting asks for the person and an end date.
  await unmanaged
    .getByRole('listitem')
    .filter({ hasText: 'demo_u_legacy_report' })
    .getByRole('button', { name: 'Assign to a person' })
    .click();
  const adopt = page.getByRole('dialog', { name: 'Assign demo_u_legacy_report to a person' });
  await expect(adopt.getByLabel('Access until')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('tab', { name: 'Accounts' }).click();
  await expect(page).toHaveURL(/tab=accounts/);
  await page.getByRole('combobox', { name: 'Person' }).click();
  await page.getByRole('option', { name: 'Only accounts with no matching person' }).click();
  await expect(page.getByText('TMPLOAD')).toBeVisible();

  await page.getByRole('tab', { name: 'Granted access' }).click();
  await page.getByRole('combobox', { name: 'Status' }).click();
  await page.getByRole('option', { name: 'Failed', exact: true }).click();
  await expect(page.getByRole('cell', { name: /HRIS read-only/ }).first()).toBeVisible();
  await page
    .getByRole('cell', { name: /HRIS read-only/ })
    .first()
    .click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('Last error from the server')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Retry provisioning' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('access review: decide items one by one', async ({ page }) => {
  await page.goto('/dbaccess/reviews');
  await expect(page.getByRole('heading', { name: 'Access reviews', level: 1 })).toBeVisible();
  // Listed among the campaigns (and under "Reviews awaiting you" while admin has items to decide).
  await page.getByRole('link', { name: 'Q4 2026 database access review' }).first().click();
  await expect(page.getByRole('heading', { name: 'Q4 2026 database access review', level: 1 })).toBeVisible();
  // The admin's own grants to decide come first, with Keep / Revoke on every row.
  await expect(page.getByRole('tab', { name: /To do/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'All', exact: true }).click();
  await expect(page).toHaveURL(/view=all/);

  await page
    .getByRole('button', { name: /^Keep access of / })
    .first()
    .click();
  await expect(page.getByText('Access kept').first()).toBeVisible();

  await page
    .getByRole('button', { name: /^Revoke access of / })
    .last()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Revoke this access?' });
  await dialog.getByRole('button', { name: 'Revoke' }).click();
  await expect(dialog.getByText('Give a reason (at least 3 characters).')).toBeVisible();
  await dialog.getByLabel('Reason').fill('Moved to another team (e2e).');
  await dialog.getByRole('button', { name: 'Revoke' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Marked to revoke when the review closes').first()).toBeVisible();
  // Export is in the header's "More" menu.
  await page.getByRole('button', { name: 'More actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Export CSV' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('Database access pages have no accessibility violations (light and dark)', async ({ page, request }) => {
  test.setTimeout(300_000);
  const paths = await pagesToCheck(request);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    for (const path of paths) {
      await page.goto(path);
      await page.evaluate((s) => localStorage.setItem('theme', s), scheme);
      await page.reload();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectAccessible(page, `${scheme} ${path}`);
    }
    // The wizard's second step, the reveal dialog and the role form.
    await page.goto('/dbaccess/request');
    await page.getByRole('checkbox', { name: 'Data warehouse read-only' }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByLabel('Why do you need it?')).toBeVisible();
    await expectAccessible(page, `${scheme} wizard details`);

    await page.goto('/dbaccess');
    const show = page.getByRole('button', { name: /^(Show password|Password)$/ }).first();
    if (await show.isVisible()) {
      await show.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectAccessible(page, `${scheme} reveal dialog`);
      await page.keyboard.press('Escape');
    }

    await page.goto(paths.find((x) => /\/servers\/[^?]+$/.test(x))!);
    await page.getByRole('button', { name: 'Make a role requestable' }).click();
    await expect(page.getByRole('dialog', { name: 'Make a role requestable' })).toBeVisible();
    await expectAccessible(page, `${scheme} role form`);
    await page.keyboard.press('Escape');
  }
});

test('Database access pages fit a 375px screen', async ({ page, request }) => {
  const paths = await pagesToCheck(request);
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of paths) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await settle(page);
    await expectNoHorizontalScroll(page);
  }
});
