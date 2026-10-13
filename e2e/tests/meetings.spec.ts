import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, expect, type Page, test } from './fixtures';
import { settle } from './helpers';

/**
 * Meeting minutes (Phase 11): record a meeting, organise the notes, send the minutes (items become NET tasks), work on
 * an item tracked here; accessibility and the phone layout.
 */

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

async function session(request: APIRequestContext) {
  return (await (await request.get('/api/v1/auth/session')).json()) as {
    csrfToken: string;
    user: { id: string };
  };
}

const stamp = Date.now().toString(36);
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
let reference = '';

test.describe.configure({ mode: 'serial' });

test('record a meeting from the list', async ({ page }) => {
  await page.goto('/meetings');
  await expect(page.getByRole('heading', { name: 'Meetings', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'New meeting' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'New meeting' });
  await sheet.getByRole('textbox', { name: 'Title' }).fill(`E2E stand-up ${stamp}`);
  await sheet.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(/\/meetings\/MTG-\d{5}$/);
  await expect(page.getByRole('heading', { name: `E2E stand-up ${stamp}`, level: 1 })).toBeVisible();
  await expect(page.getByText("The minutes haven't been sent yet")).toBeVisible();
});

test('organise the notes, save the minutes and send them: project items become NET tasks', async ({
  page,
  request,
}) => {
  const { csrfToken } = await session(request);
  const net = (await (await request.get('/api/v1/projects/projects/NET')).json()) as { id: string };
  const created = await request.post('/api/v1/meetings/meetings', {
    headers: { 'x-csrf-token': csrfToken },
    data: {
      title: `E2E cutover review ${stamp}`,
      startsAt: new Date().toISOString(),
      links: [`projects.project:${net.id}`],
      notes: [
        'Reviewed the cutover plan.',
        'Decision: Freeze changes on the core the week before.',
        `Action: @admin send the cutover notice by ${day(3)}`,
        'Is the rollback window long enough?',
      ].join('\n'),
    },
  });
  expect(created.status()).toBe(201);
  reference = ((await created.json()) as { reference: string }).reference;

  await page.goto(`/meetings/${reference}`);
  await expect(page.getByRole('textbox', { name: 'Notes' })).toHaveValue(/Reviewed the cutover plan/);
  await page.getByRole('button', { name: 'Organise', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Organised minutes' });
  await expect(sheet.getByRole('textbox', { name: 'Decisions' })).toHaveValue(/Freeze changes on the core/);
  await expect(sheet.getByRole('textbox', { name: 'What has to be done' })).toHaveValue(
    'send the cutover notice',
  );
  await sheet.getByRole('button', { name: 'Save minutes' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText('Becomes a task in NET when the minutes are sent')).toBeVisible();

  await page.getByRole('button', { name: 'Send minutes' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Send the minutes?' });
  await confirm.getByRole('button', { name: 'Send minutes' }).click();
  await expect(page.getByText(/^Created task NET-\d+$/).first()).toBeVisible();
  await expect(page.getByText('Minutes sent').first()).toBeVisible();
  await expect(page.getByRole('link', { name: /^NET-\d+$/ }).first()).toBeVisible();
});

test('an item tracked here is on My action items and is marked done there', async ({ page, request }) => {
  const { csrfToken, user } = await session(request);
  const title = `E2E check the rollback window ${stamp}`;
  const added = await request.post(`/api/v1/meetings/meetings/${reference}/action-items`, {
    headers: { 'x-csrf-token': csrfToken },
    data: { title, ownerId: user.id, dueDate: day(2), destination: 'meeting' },
  });
  expect(added.status()).toBe(201);

  await page.goto('/meetings/action-items');
  await expect(page.getByRole('heading', { name: 'My action items', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: `Mark “${title}” done` }).click();
  await expect(page.getByText('Marked done').first()).toBeVisible();
  await expect(page.getByRole('button', { name: `Mark “${title}” done` })).toHaveCount(0);
});

test('meetings pages have no accessibility violations (light and dark)', async ({ page }) => {
  test.setTimeout(180_000);
  const pages: [string, string][] = [
    ['/meetings', 'list'],
    ['/meetings/action-items', 'action items'],
    [`/meetings/${reference}`, 'meeting'],
  ];
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    for (const [path, label] of pages) {
      await page.goto(path);
      await page.evaluate((s) => localStorage.setItem('theme', s), scheme);
      await page.reload();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectAccessible(page, `${scheme} ${label}`);
    }
  }
});

test('meetings pages fit a 375px screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of ['/meetings', '/meetings/action-items', `/meetings/${reference}`]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await settle(page);
    await expectNoHorizontalScroll(page);
  }
});
