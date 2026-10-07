import AxeBuilder from '@axe-core/playwright';
import { type Browser, expect, type Page, test } from './fixtures';
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
  const helpdesk = await signInAs(browser, baseURL!, 'helpdesk');
  const p = helpdesk.page;

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

  // The agent (admin) replies to the requester and resolves it with a resolution code.
  await page.goto(`/itsm/tickets/${reference}`);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  const reply = 'Thanks! Please update the VPN client to the latest version and try again.';
  await page.getByRole('textbox', { name: 'Reply to requester' }).fill(reply);
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(page.getByText(reply)).toBeVisible();
  await page
    .getByRole('toolbar', { name: 'Ticket actions' })
    .getByRole('button', { name: 'Resolve' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Resolve the ticket' });
  // Notes are required.
  await dialog.getByRole('button', { name: 'Resolve' }).click();
  await expect(dialog.getByText('Tell the requester what was done.')).toBeVisible();
  await dialog
    .getByLabel('Resolution notes')
    .fill('Updated the VPN client to 5.3; the connection is stable again.');
  await dialog.getByRole('button', { name: 'Resolve' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Status changed to Resolved')).toBeVisible();

  // The requester sees the reply, confirms the fix and rates the service.
  await p.reload();
  await expect(p.getByText(reply)).toBeVisible();
  const fixed = p.getByRole('region', { name: 'Is it fixed?' });
  await fixed.getByRole('button', { name: 'Yes, close it' }).click();
  await fixed.getByRole('radio', { name: '5 stars: excellent' }).check({ force: true });
  await fixed.getByLabel('Anything else to tell us? (optional)').fill('Quick and friendly, thank you!');
  await fixed.getByRole('button', { name: 'Close the ticket' }).click();
  await expect(p.getByText('Thanks! Your ticket is closed.')).toBeVisible();
  await expect(p.getByText('Rated 5 out of 5')).toBeVisible();
  await helpdesk.close();
});

test('agent workspace: switch queues', async ({ page }) => {
  await page.goto('/itsm');
  const queues = page.getByRole('navigation', { name: 'Queues' });
  await expect(queues).toBeVisible();
  await queues.getByRole('button', { name: /^Breached SLA/ }).click();
  await expect(page).toHaveURL(/[?&]view=breached/);
  await expect(page.getByRole('table', { name: 'Breached SLA' })).toBeVisible();
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
  await expect(page.getByRole('tab', { name: 'Calendar' })).toHaveAttribute('aria-selected', 'true');
  const grid = page.getByRole('table', { name: /^Changes planned in/ });
  await expect(grid).toBeVisible();
  const caption = grid.locator('caption');
  const month = (await caption.textContent()) ?? '';
  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(page).toHaveURL(/[?&]month=\d{4}-\d{2}/);
  await expect(caption).not.toHaveText(month);
  await page.getByRole('button', { name: 'Today' }).click();
  await expect(caption).toHaveText(month);
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await expect(page.getByRole('table', { name: /^Changes planned in/ })).toBeHidden();
  await page.getByRole('tab', { name: 'List' }).click();
  await expect(page.getByRole('table', { name: 'Changes' })).toBeVisible();
});

test('service desk pages have no accessibility violations (light and dark)', async ({ page, request }) => {
  // 16 page loads with axe scans.
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
    ['/itsm/changes', (p) => expect(p.getByRole('tab', { name: 'Calendar' })).toBeVisible()],
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
