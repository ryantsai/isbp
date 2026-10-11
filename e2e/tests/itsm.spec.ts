import AxeBuilder from '@axe-core/playwright';
import { adaptPage, type Browser, expect, type Page, test } from './fixtures';
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
    page: adaptPage(await context.newPage()),
    async close() {
      await context.request.patch('/api/v1/me', { data: { locale: user.locale }, headers });
      await context.close();
    },
  };
}

async function expectAccessible(page: Page, label: string) {
  await settle(page);
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    label,
  ).toEqual([]);
}

test.describe.configure({ mode: 'serial' });

/** The incident reported in the first test (later tests reuse it). */
let reference = '';

test('report an issue, get it resolved, confirm the fix with a rating', async ({
  browser,
  page,
  baseURL,
}) => {
  const title = `My VPN disconnects every few minutes at home (e2e ${Date.now().toString(36)})`;
  // A plain employee (no service desk role) reports it, so they get the requester's view of their ticket.
  const requester = await signInAs(browser, baseURL!, 'employee');
  // Whatever happens, give the demo user their own language back.
  try {
    await reportResolveConfirm(requester.page, page, title);
  } finally {
    await requester.close();
  }
});

async function reportResolveConfirm(p: Page, page: Page, title: string) {
  // The requester describes the issue; knowledge articles are suggested while they type.
  await p.goto('/itsm/report');
  await expect(p.getByRole('heading', { name: 'Report an issue' })).toBeVisible();
  // Type only once the page is interactive (text typed into server-rendered inputs before hydration is lost).
  await p.waitForLoadState('networkidle');
  await p.getByLabel("What's wrong?").fill(title);
  await p.getByLabel('Tell us more').fill('The VPN client drops the connection and I have to log in again.');
  const suggestions = p.getByRole('complementary', { name: 'These articles might help' });
  await expect(suggestions.getByRole('link', { name: /VPN/ }).first()).toBeVisible();
  await p.getByRole('radio', { name: /I can't work/ }).check({ force: true });
  await p.getByRole('button', { name: 'Send to the service desk' }).click();
  await expect(p).toHaveURL(/\/itsm\/tickets\/INC-\d{5}$/);
  reference = p.url().split('/').pop()!;
  await expect(p.getByRole('heading', { name: title })).toBeVisible();

  // On their own ticket the requester writes to the service desk (never "Reply to requester").
  await expect(p.getByRole('textbox', { name: 'Message the service desk' })).toBeVisible();
  await expect(p.getByRole('tab', { name: 'Reply to requester' })).toHaveCount(0);

  // The agent (admin) asks a question, then resolves with the fix in one step ("Send and resolve").
  await page.goto(`/itsm/tickets/${reference}`);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  const question = 'Which VPN client version do you have?';
  await page.getByRole('textbox', { name: 'Reply to requester' }).fill(question);
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(page.getByText(question)).toBeVisible();
  const reply = 'Updated the VPN client to 5.3; the connection is stable again.';
  await page.getByRole('textbox', { name: 'Reply to requester' }).fill(reply);
  await page.getByRole('button', { name: 'Send and resolve' }).click();
  const dialog = page.getByRole('dialog', { name: 'Resolve the ticket' });
  // The reply becomes the resolution notes (one message to the requester); notes are still required.
  await expect(dialog.getByLabel('Resolution notes')).toHaveValue(reply);
  await dialog.getByLabel('Resolution notes').fill('');
  await dialog.getByRole('button', { name: 'Resolve' }).click();
  await expect(dialog.getByText('Tell the requester what was done.')).toBeVisible();
  await dialog.getByLabel('Resolution notes').fill(reply);
  await dialog.getByRole('button', { name: 'Resolve' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Status changed to Resolved')).toBeVisible();
  // Finished: the fields are read-only and the next step is "Reopen".
  await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Priority' })).toHaveCount(0);

  // The requester sees the answer and the resolution, confirms the fix and rates the service.
  await p.reload();
  await expect(p.getByText(question)).toBeVisible();
  await expect(p.getByText(reply)).toBeVisible();
  const fixed = p.getByRole('region', { name: 'Is it fixed?' });
  await fixed.getByRole('button', { name: 'Yes, close it' }).click();
  await fixed.getByRole('radio', { name: '5 stars: excellent' }).check({ force: true });
  await fixed.getByLabel('Anything else to tell us? (optional)').fill('Quick and friendly, thank you!');
  await fixed.getByRole('button', { name: 'Close the ticket' }).click();
  await expect(p.getByText('Thanks! Your ticket is closed.')).toBeVisible();
  await expect(p.getByText('Rated 5 out of 5')).toBeVisible();
}

test('agent workspace: switch queues', async ({ page }) => {
  await page.goto('/itsm');
  const queues = page.getByRole('navigation', { name: 'Queues' });
  await expect(queues).toBeVisible();
  await settle(page);
  await queues.getByRole('button', { name: /^SLA attention/ }).click();
  await expect(page).toHaveURL(/[?&]view=attention/);
  await expect(page.getByRole('table', { name: 'SLA attention' })).toBeVisible();
  // The queues hold incidents and service requests (problems and changes have their own pages).
  await expect(page.getByRole('combobox', { name: 'Type' })).toHaveText('Incidents & requests');
  await queues.getByRole('button', { name: /^Major incidents/ }).click();
  await expect(page.getByRole('table', { name: 'Major incidents' })).toBeVisible();
  await queues.getByRole('button', { name: /^All open/ }).click();
  await expect(page).not.toHaveURL(/view=/);
  const table = page.getByRole('table', { name: 'All open' });
  await expect(table.getByRole('link', { name: /(INC|SR|PRB|CHG)-\d{5}/ }).first()).toBeVisible();
  // Rows open the ticket page.
  await table
    .getByRole('link', { name: /(INC|SR|PRB|CHG)-\d{5}/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/itsm\/tickets\/(INC|SR|PRB|CHG)-\d{5}$/);
});

test('change calendar: month grid, navigation, agenda and list', async ({ page }) => {
  await page.goto('/itsm/changes');
  await settle(page);
  const views = page.getByRole('group', { name: 'View' });
  await expect(views.getByRole('button', { name: 'Month' })).toHaveAttribute('aria-pressed', 'true');
  const grid = page.getByRole('table', { name: /^Changes planned in/ });
  await expect(grid).toBeVisible();
  const month = (await grid.locator('caption').textContent()) ?? '';
  // The grid slides to the next month: both months are on screen until the old one has left.
  const grids = page.getByRole('table', { name: /^Changes planned in/ });
  const thisMonth = page.getByRole('table', { name: month, exact: true });
  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(page).toHaveURL(/[?&]month=\d{4}-\d{2}/);
  await expect(thisMonth).toHaveCount(0);
  await expect(grids).toHaveCount(1);
  await page.getByRole('button', { name: 'Today' }).click();
  await expect(thisMonth).toBeVisible();
  await expect(grids).toHaveCount(1);
  await views.getByRole('button', { name: 'Agenda' }).click();
  await expect(page.getByRole('table', { name: /^Changes planned in/ })).toBeHidden();
  await views.getByRole('button', { name: 'List' }).click();
  await expect(page).toHaveURL(/[?&]view=list/);
  await expect(page.getByRole('table', { name: 'Changes' })).toBeVisible();
});

test('a draft change goes to approval from its own page, and asks for the window first', async ({ page }) => {
  const title = `Rotate the gateway certificate (e2e ${Date.now().toString(36)})`;
  await page.goto('/itsm/changes');
  await settle(page);
  await page.getByRole('button', { name: 'New change' }).click();
  const sheet = page.getByRole('dialog', { name: 'New change' });
  await sheet.getByLabel('What will change?').fill(title);
  await sheet.getByRole('button', { name: 'Save draft' }).click();
  await expect(page).toHaveURL(/\/itsm\/tickets\/CHG-\d{5}$/);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  // No window yet: "Submit for approval" opens the plan to set it (instead of failing).
  await page.getByRole('button', { name: 'Submit for approval' }).click();
  const plan = page.getByRole('dialog', { name: 'Plan the window to submit' });
  await expect(plan).toBeVisible();
  await expect(plan.getByRole('button', { name: 'Save and submit for approval' })).toBeVisible();
  await plan.getByRole('button', { name: 'Cancel' }).click();
  await expect(plan).toBeHidden();
});

test('a problem raised from an incident starts with the incident linked', async ({ page, request }) => {
  const list = (await (
    await request.get('/api/v1/itsm/tickets?pageSize=1&type=incident&status=open')
  ).json()) as { items: { reference: string; title: string }[] };
  const incident = list.items[0]!;
  await page.goto(`/itsm/tickets/${incident.reference}`);
  await settle(page);
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Create problem' }).click();
  const dialog = page.getByRole('dialog', { name: 'New problem' });
  await expect(dialog.getByLabel('Title')).toHaveValue(incident.title);
  await expect(dialog.getByText(incident.reference).first()).toBeVisible();
  await dialog.getByRole('button', { name: 'Create problem' }).click();
  await expect(page).toHaveURL(/\/itsm\/tickets\/PRB-\d{5}$/);
  // The problem lists the incidents it causes ("1 linked incident"); Related doesn't repeat them.
  const incidents = page.getByRole('list', { name: /linked incident/ });
  await expect(incidents.getByRole('link', { name: incident.reference })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start investigating' })).toBeVisible();
});

test('service desk pages have no accessibility violations (light and dark)', async ({ page, request }) => {
  // 22 page loads with axe scans.
  test.setTimeout(240_000);
  if (!reference) {
    const list = (await (await request.get('/api/v1/itsm/tickets?pageSize=1&type=incident')).json()) as {
      items: { reference: string }[];
    };
    reference = list.items[0]!.reference;
  }
  const pages: [string, (p: Page) => Promise<void>][] = [
    ['/itsm', (p) => expect(p.getByRole('navigation', { name: 'Queues' })).toBeVisible()],
    [`/itsm/tickets/${reference}`, (p) => expect(p.getByRole('heading', { name: 'Activity' })).toBeVisible()],
    ['/itsm/report', (p) => expect(p.getByRole('heading', { name: 'Report an issue' })).toBeVisible()],
    ['/itsm/changes', (p) => expect(p.getByRole('group', { name: 'View' })).toBeVisible()],
    ['/itsm/changes?view=list', (p) => expect(p.getByRole('table', { name: 'Changes' })).toBeVisible()],
    ['/itsm/problems', (p) => expect(p.getByRole('heading', { name: 'Problems' })).toBeVisible()],
    ['/itsm/reports', (p) => expect(p.getByText('Created vs. resolved')).toBeVisible()],
    ['/itsm/settings', (p) => expect(p.getByRole('heading', { name: 'Categories' })).toBeVisible()],
    ['/itsm/settings?tab=sla', (p) => expect(p.getByRole('heading', { name: 'SLA policies' })).toBeVisible()],
    [
      '/itsm/settings?tab=catalog',
      (p) => expect(p.getByRole('heading', { name: 'Service catalog' })).toBeVisible(),
    ],
  ];
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    for (const [path, ready] of pages) {
      await page.goto(path);
      await page.evaluate((s) => localStorage.setItem('theme', s), scheme);
      await page.reload();
      await ready(page);
      await expectAccessible(page, `${scheme} ${path}`);
    }
  }
});
