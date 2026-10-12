import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, adaptPage, expect, type Page, test } from './fixtures';
import { settle } from './helpers';

/*
 * Ask IT published outside the platform (Phase 10, §16.6), against the seeded demo stack (builtin mode).
 *   E2E_BASE_URL=http://localhost:3000 pnpm e2e published-chat
 */

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

async function csrfOf(request: APIRequestContext) {
  return ((await (await request.get('/api/v1/auth/session')).json()) as { csrfToken: string }).csrfToken;
}

test.describe.configure({ mode: 'serial' });

const created: string[] = [];

test.afterAll(async ({ request }) => {
  const csrf = await csrfOf(request);
  for (const id of created)
    await request.delete(`/api/v1/helpdesk-ai/published-chats/${id}`, { headers: { 'x-csrf-token': csrf } });
});

test('publish a chat for anyone, then use its link as a visitor', async ({ page, browser, baseURL }) => {
  await page.goto('/helpdesk-ai/published');
  await page.getByRole('button', { name: 'Publish a chat' }).first().click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('textbox', { name: 'Name' }).fill('E2E visitor chat');
  await sheet.getByText('Anyone', { exact: true }).click();
  await sheet.getByRole('checkbox', { name: 'Network & VPN' }).check();
  await sheet
    .getByRole('textbox', { name: 'Websites that may embed it' })
    .fill('https://intranet.example.com');
  await sheet.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Chat published').first()).toBeVisible();
  // The new chat stays open with its link and snippets.
  const link = await sheet.getByRole('textbox', { name: 'Chat link' }).inputValue();
  expect(link).toMatch(/\/p\/helpdesk-ai\/chat\/[A-Za-z0-9_-]{32}$/);
  await expect(sheet.getByRole('textbox', { name: 'Chat bubble' })).toHaveValue(/embed\.js" data-chat="/);
  await expectAccessible(page, 'published chats admin');
  const chats = (await (await page.request.get('/api/v1/helpdesk-ai/published-chats')).json()) as {
    items: { id: string; name: string }[];
  };
  created.push(chats.items.find((c) => c.name === 'E2E visitor chat')!.id);

  // Only the listed website may frame it.
  const framed = await page.request.get(link);
  expect(framed.headers()['content-security-policy']).toContain(
    'frame-ancestors https://intranet.example.com',
  );

  // A visitor: no platform session at all.
  const context = await browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
    locale: 'en-US',
  });
  const visitor = adaptPage(await context.newPage());
  try {
    await visitor.goto(link);
    await expect(visitor.getByRole('heading', { name: 'How can IT help you today?' })).toBeVisible();
    await expect(visitor.getByText(/Answers come from the IT knowledge base/)).toBeVisible();
    const box = visitor.getByRole('textbox', { name: 'Your question' });
    await box.fill('My VPN keeps disconnecting');
    await box.press('Enter');
    await expect(visitor.getByText("Here's what I found in the knowledge base:")).toBeVisible({
      timeout: 20_000,
    });
    // No tickets for visitors: the second answer is to contact the service desk.
    await visitor.getByRole('button', { name: 'No, I still need help' }).click();
    await expect(visitor.getByText('For more help, contact the IT service desk.')).toBeVisible();
    // Articles open in the chat.
    await visitor.getByRole('button', { name: /VPN/ }).first().click();
    await expect(visitor.getByRole('button', { name: 'Back to the conversation' })).toBeVisible();
    await expectAccessible(visitor, 'published chat article');
    await visitor.getByRole('button', { name: 'Back to the conversation' }).click();
    await expectAccessible(visitor, 'published chat');
  } finally {
    await context.close();
  }
});

test('a chat for signed-in people opened as a link signs the person in with their session', async ({
  page,
  request,
}) => {
  const csrf = await csrfOf(request);
  const res = await request.post('/api/v1/helpdesk-ai/published-chats', {
    headers: { 'x-csrf-token': csrf },
    data: { name: 'E2E staff chat', access: 'signed_in', title: 'IT help for staff' },
  });
  expect(res.ok()).toBeTruthy();
  const chat = (await res.json()) as { id: string; token: string };
  created.push(chat.id);

  await page.goto(`/p/helpdesk-ai/chat/${chat.token}`);
  await expect(page.getByRole('heading', { name: 'IT help for staff' })).toBeVisible();
  await expect(page.getByText(/^Signed in as /)).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Your question' })).toBeVisible();
});

test('framed on another site, a chat for signed-in people signs in through a window', async ({
  page,
  request,
  baseURL,
}) => {
  // An intranet page on 127.0.0.1, another site than localhost: the platform's cookie never reaches the frame. A
  // real local server (a route-fulfilled page counts as public, and Chrome keeps public pages from local ones).
  let token = '';
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      `<!doctype html><html data-hydrated="1"><title>Intranet</title><h1>Intranet</h1><iframe title="Ask IT" style="width:400px;height:600px" src="${baseURL}/p/helpdesk-ai/chat/${token}?embed=1"></iframe>`,
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const host = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const csrf = await csrfOf(request);
  const res = await request.post('/api/v1/helpdesk-ai/published-chats', {
    headers: { 'x-csrf-token': csrf },
    data: { name: 'E2E framed staff chat', access: 'signed_in', allowedOrigins: [host] },
  });
  const chat = (await res.json()) as { id: string; token: string };
  created.push(chat.id);
  token = chat.token;
  try {
    await page.goto(`${host}/`);
    const frame = page.frameLocator('iframe');
    await expect(frame.getByRole('heading', { name: 'Sign in to chat with IT' })).toBeVisible({
      timeout: 20_000,
    });

    // The window signs in with the platform's session, hands the chat a session and closes.
    const popup = page.waitForEvent('popup');
    await frame.getByRole('button', { name: 'Sign in' }).click();
    await (await popup).waitForEvent('close', { timeout: 20_000 });
    await expect(frame.getByText(/^Signed in as /)).toBeVisible();
    const box = frame.getByRole('textbox', { name: 'Your question' });
    await box.fill('My VPN keeps disconnecting');
    await box.press('Enter');
    await expect(frame.getByText("Here's what I found in the knowledge base:")).toBeVisible({
      timeout: 20_000,
    });
  } finally {
    server.close();
  }
});

test('a chat that is off, or a made-up link, says it is not available', async ({ page }) => {
  await page.goto('/p/helpdesk-ai/chat/not-a-real-chat-link-0000000000');
  await expect(page.getByRole('heading', { name: "This chat isn't available" })).toBeVisible();
});
