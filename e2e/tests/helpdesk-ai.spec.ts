import AxeBuilder from '@axe-core/playwright';
import { adaptPage, type Browser, expect, type Page, test } from './fixtures';
import { settle } from './helpers';

/*
 * Helpdesk AI against the seeded demo stack (builtin mode: no chat model configured).
 *   E2E_BASE_URL=http://localhost:3000 pnpm e2e helpdesk-ai
 */

const DEMO_PASSWORD = process.env.E2E_DEMO_PASSWORD ?? 'Demo-2026!pass';

/** A separate browser session for a demo user, pinned to English (restored afterwards). */
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

/** The ticket raised from the virtual agent (the agent test works on it). */
let reference = '';

test('ask the virtual agent a VPN question, see the cited articles, raise a ticket from the proposal', async ({
  browser,
  baseURL,
}) => {
  const requester = await signInAs(browser, baseURL!, 'hr.partner');
  const p = requester.page;
  try {
    await p.goto('/helpdesk-ai/chat');
    await expect(p.getByRole('heading', { name: 'How can IS help you today?' })).toBeVisible();
    await expect(p.getByText('Answers from our knowledge base').first()).toBeVisible();
    // One "New conversation" button on a desktop (the one above the conversation list).
    await expect(p.getByRole('button', { name: 'New conversation' })).toHaveCount(1);
    await expectAccessible(p, 'chat page (empty)');

    const question = `My VPN keeps disconnecting every few minutes when I work from home (e2e ${Date.now().toString(36)})`;
    const input = p.getByRole('textbox', { name: 'Your question' });
    await input.fill(question);
    await input.press('Enter');

    // The answer streams in with the articles as cards linking to the knowledge base (not repeated in the text).
    const log = p.getByRole('log', { name: 'Conversation' });
    await expect(log.getByText(question)).toBeVisible();
    await expect(log.getByText("Here's what I found in the knowledge base:")).toBeVisible();
    const sources = log.getByRole('list', { name: 'Sources' }).last();
    await expect(sources.getByRole('link').first()).toHaveAttribute('href', /^\/knowledge\/KB-\d{5}$/);
    await expect(log.getByText(/\[1\]/)).toHaveCount(0);
    await expect(p.getByText('Did this solve it?')).toBeVisible();
    await expect(p.getByRole('button', { name: 'Yes, thanks' })).toBeVisible();
    await expect(p).toHaveURL(/\/helpdesk-ai\/chat\?c=[0-9a-f-]+/);

    // "No, raise a ticket" opens the prefilled draft in place; nothing is created until it is confirmed.
    await p.getByRole('button', { name: 'No, raise a ticket' }).click();
    const form = p.getByRole('form', { name: 'Raise a ticket' });
    await expect(form.getByLabel('Title')).toHaveValue(question.slice(0, 120));
    await expect(form.getByLabel('Title')).toBeFocused();
    // A plain-text description and Report an issue's impact scale.
    await expect(form.getByLabel('Description')).not.toHaveValue(/\*\*/);
    await expect(form.getByRole('radiogroup', { name: 'How much does it affect you?' })).toBeVisible();
    await form.getByText("I can't work").click();
    await expect(form.getByRole('radio', { name: /I can't work/ })).toBeChecked();
    await form.getByLabel('Title').fill(`VPN drops every few minutes (e2e ${Date.now().toString(36)})`);
    await expectAccessible(p, 'chat page with a proposal');
    await form.getByRole('button', { name: 'Create ticket' }).click();

    const raised = p.getByRole('status').filter({ hasText: /Ticket (INC|SR)-\d{5} was raised/ });
    await expect(raised).toBeVisible();
    reference = /(INC|SR)-\d{5}/.exec((await raised.textContent()) ?? '')![0];
    await raised.getByRole('link', { name: 'View ticket' }).click();
    await expect(p).toHaveURL(new RegExp(`/itsm/tickets/${reference}$`));
  } finally {
    await requester.close();
  }
});

test('the agent sees the AI assist panel on the ticket and inserts a drafted reply', async ({
  browser,
  baseURL,
}) => {
  expect(reference).not.toBe('');
  const agent = await signInAs(browser, baseURL!, 'helpdesk');
  const p = agent.page;
  try {
    await p.goto(`/itsm/tickets/${reference}`);
    const panel = p.getByRole('region', { name: 'AI assist' });
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Basic mode')).toBeVisible();
    // Triage was suggested on create (the confidence is a labelled meter, not colour alone).
    await expect(panel.getByRole('button', { name: 'Triage suggestion' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(panel.getByRole('meter', { name: 'Confidence' })).toBeVisible();

    await panel.getByRole('button', { name: 'Draft a reply' }).first().click();
    await panel
      .getByRole('region', { name: 'Draft a reply' })
      .getByRole('button', { name: 'Draft a reply' })
      .click();
    const insert = panel.getByRole('button', { name: 'Insert into reply' });
    await expect(insert).toBeVisible();
    await expectAccessible(p, 'ticket page with the AI assist panel');
    await insert.click();
    const composer = p.getByPlaceholder('Write a reply the requester will see…');
    await expect(composer).toBeFocused();
    // Written in the requester's language (hr.partner's profile is Japanese).
    await expect(composer).not.toHaveValue('');
    await expect(composer).toHaveValue(/様|Hi /);
  } finally {
    await agent.close();
  }
});

test('the AI insights page shows metrics, the daily chart and recent conversations', async ({ page }) => {
  await page.goto('/helpdesk-ai');
  await expect(page.getByRole('heading', { name: 'AI insights' })).toBeVisible();
  await expect(page.getByText('Triage acceptance')).toBeVisible();
  await expect(page.getByText('Solved without a ticket')).toBeVisible();
  // Engine details stay behind "Technical details" for the people who configure AI.
  const technical = page.getByRole('button', { name: 'Technical details' });
  await expect(technical).toHaveAttribute('aria-expanded', 'false');
  await technical.click();
  await expect(technical).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('Vector search')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Suggestions waiting for an agent' })).toBeVisible();
  await expect(page.getByRole('group', { name: /Conversations per day/ })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Recent conversations' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Configure AI' }).first()).toHaveAttribute('href', '/admin/ai');
  await expectAccessible(page, 'insights page');

  // Keyboard reads the chart day by day; the table view carries the same numbers.
  await page.getByRole('group', { name: /Conversations per day/ }).focus();
  await page.keyboard.press('End');
  await expect(page.getByText(/conversations, \d+ became tickets/)).toBeAttached();
  await page.getByText('Show as table').click();
  await expect(page.getByRole('table', { name: 'Conversations per day' })).toBeVisible();
});

test('the service desk lead reads AI insights from the reports section, without the conversations', async ({
  browser,
  baseURL,
}) => {
  const lead = await signInAs(browser, baseURL!, 'helpdesk');
  const p = lead.page;
  try {
    await p.goto('/helpdesk-ai');
    await expect(p.getByRole('heading', { name: 'AI insights', level: 1 })).toBeVisible();
    const tabs = p.getByRole('navigation', { name: 'Reports' });
    await expect(tabs.getByRole('link', { name: 'AI insights' })).toHaveAttribute(
      'aria-current',
      /^(page|true)$/,
    );
    await expect(tabs.getByRole('link', { name: 'Service desk' })).toHaveAttribute('href', '/itsm/reports');
    await expect(p.getByText('Solved without a ticket')).toBeVisible();
    await expect(p.getByRole('table', { name: 'Recent conversations' })).toHaveCount(0);
    await expectAccessible(p, 'insights page (service desk lead)');
  } finally {
    await lead.close();
  }
});

test('the request portal invites people to Ask IS and opens the chat in a sheet', async ({ page }) => {
  await page.goto('/requests');
  const card = page.getByRole('region', { name: 'Ask IS' });
  await expect(card).toBeVisible();
  await expectAccessible(page, 'request portal with the Ask IS card');
  await card.getByRole('button', { name: 'Ask a question' }).click();
  const sheet = page.getByRole('dialog', { name: 'Ask IS' });
  await expect(sheet.getByRole('heading', { name: 'How can IS help you today?' })).toBeVisible();
  await expect(sheet.getByRole('textbox', { name: 'Your question' })).toBeVisible();
  await expectAccessible(page, 'Ask IS sheet');
});

test("the knowledge home doesn't invite service desk agents to Ask IS", async ({ page }) => {
  await page.goto('/knowledge');
  await settle(page);
  await expect(page.getByRole('region', { name: 'Ask IS' })).toHaveCount(0);
});

test('Ask IS on a phone: one "New conversation" in the header, no horizontal scroll', async ({
  browser,
  baseURL,
}) => {
  const requester = await signInAs(browser, baseURL!, 'hr.partner');
  const p = requester.page;
  try {
    await p.setViewportSize({ width: 375, height: 812 });
    await p.goto('/helpdesk-ai/chat');
    await expect(p.getByRole('heading', { name: 'How can IS help you today?' })).toBeVisible();
    await expect(p.getByRole('button', { name: 'New conversation' })).toHaveCount(1);
    expect(
      await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0);
  } finally {
    await requester.close();
  }
});
