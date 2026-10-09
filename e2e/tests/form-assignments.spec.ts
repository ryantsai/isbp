import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, expect, type Page, test } from './fixtures';
import { overflowing, settle } from './helpers';

/*
 * Phase 8 assigned and recurring forms: a form someone must fill in by a date. The person sees it under "To do" (the
 * request portal and the dashboard), fills it in from there and it's done; a form administrator assigns it from the
 * form's Assignments tab, sees the compliance summary and cancels one; Scheduled Jobs offers the "Assign a form"
 * task type with its own editor.
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
const formKey = `e2e-inspection-${suffix}`;
const formName = `E2E server room inspection ${suffix}`;
let formId = '';
let me = '';

async function assign(request: APIRequestContext, title: string, dueInHours = 30) {
  const res = await request.post(`/api/v1/forms/${formId}/assignments`, {
    headers: { 'x-csrf-token': await csrfOf(request) },
    data: {
      assignee: { type: 'user', userId: me },
      title,
      periodKey: '2026-10',
      note: 'Check the UPS log too.',
      dueAt: new Date(Date.now() + dueInHours * 3_600_000).toISOString(),
    },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string; href: string };
}

test.beforeAll(async ({ request }) => {
  const headers = { 'x-csrf-token': await csrfOf(request) };
  me = ((await (await request.get('/api/v1/me')).json()) as { id: string }).id;
  const form = await request.post('/api/v1/forms', {
    headers,
    data: { key: formKey, name: { en: formName }, icon: 'clipboard-check' },
  });
  expect(form.status()).toBe(201);
  formId = ((await form.json()) as { id: string }).id;
  const draft = {
    elements: [
      { id: 'by', key: 'checkedBy', type: 'text', label: { en: 'Checked by' }, required: true },
      { id: 'ok', key: 'ok', type: 'boolean', label: { en: 'Temperature and humidity are normal' } },
    ],
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

test('a person sees the to-do, fills the form in from it, and it is done', async ({ page, request }) => {
  const title = `Inspection October ${suffix}`;
  const todo = await assign(request, title);

  // To do lives on My work; the requests page only says how many are waiting.
  await page.goto('/my-work');
  const section = page.getByRole('region', { name: 'To do' });
  await expect(section).toBeVisible();
  const link = section.getByRole('link', { name: new RegExp(title) });
  await expect(link).toBeVisible();
  // The My work row says when it is due ("Due in 30 hours", "Overdue by …"): the exact wording depends on the time left.
  await expect(link).toContainText(/Due|Overdue/);
  await expectAccessible(page);

  await link.click();
  await expect(page).toHaveURL(new RegExp(`/requests/forms/${formKey}\\?assignment=${todo.id}`));
  const banner = page.getByRole('region', { name: new RegExp(title) });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Check the UPS log too.');
  await expect(banner).toContainText('Sending the form completes this to-do.');
  await expectAccessible(page);

  await page.getByLabel('Checked by').fill('E2E');
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page).toHaveURL(/\/requests\/REQ-\d+/);

  const after = await request.get(`/api/v1/me/form-assignments/${todo.id}`);
  expect(((await after.json()) as { state: string }).state).toBe('done');
  await page.goto('/requests');
  await page.goto('/my-work');
  await expect(page.getByRole('link', { name: new RegExp(title) })).toHaveCount(0);

  // Opening the done to-do again says so.
  await page.goto(todo.href);
  await expect(page.getByText('This to-do was already completed by')).toBeVisible();
});

test('My work shows open to-dos', async ({ page, request }) => {
  const title = `Backup check ${suffix}`;
  await assign(request, title, 24 * 10);
  await page.goto('/my-work');
  const todo = page.getByRole('region', { name: 'To do' });
  const link = todo.getByRole('link', { name: new RegExp(title) });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', /\/requests\/forms\/.+\?assignment=/);
  await expectAccessible(page);
});

test('a form administrator assigns the form, follows compliance and cancels', async ({ page }) => {
  await page.goto(`/admin/forms/${formId}?tab=assignments`);
  await expect(page.getByRole('tab', { name: /Assignments/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Compliance by period' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Assignments of this form' })).toBeVisible();
  await expectAccessible(page);

  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Assign this form' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio', { name: 'A group' }).check();
  await dialog.getByRole('combobox', { name: 'Group' }).click();
  await page.getByRole('option').first().click();
  await dialog.getByLabel('Title').fill(`Quarterly review ${suffix}`);
  const due = new Date(Date.now() + 14 * 24 * 3_600_000).toISOString().slice(0, 10);
  await dialog.getByLabel('Due date').fill(due);
  await dialog.getByLabel('Period (optional)').fill('2026-Q4');
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Assign' }).click();
  await expect(dialog).toBeHidden();

  const row = page.getByRole('row', { name: new RegExp(`Quarterly review ${suffix}`) });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Open');
  await row
    .getByRole('button', { name: new RegExp(`Cancel assignment: Quarterly review ${suffix}`) })
    .click();
  const confirm = page.getByRole('alertdialog', { name: 'Cancel this assignment?' });
  await expect(confirm).toBeVisible();
  await expectAccessible(page);
  await confirm.getByRole('button', { name: 'Cancel assignment' }).click();
  await expect(row).toContainText('Cancelled');

  // Filter by status (state in the URL).
  await page.getByRole('combobox', { name: 'Status' }).click();
  await page.getByRole('option', { name: 'Cancelled' }).click();
  await expect(page).toHaveURL(/state=cancelled/);
  await expect(page.getByRole('row', { name: new RegExp(`Quarterly review ${suffix}`) })).toBeVisible();
});

test('Scheduled Jobs offers “Assign a form” with its own editor', async ({ page }) => {
  await page.goto(
    `/scheduler/jobs/new?type=core.assign-form&config=${encodeURIComponent(JSON.stringify({ formKey }))}`,
  );
  await expect(page.getByRole('combobox', { name: 'Form' })).toContainText(formName);
  await expect(page.getByRole('combobox', { name: 'Period' })).toBeVisible();
  await expect(page.getByText('becomes the period')).toBeVisible();
  await expectAccessible(page);
});

test('to-dos and the assignments tab work at 375 px and in dark mode', async ({ page, request }) => {
  await assign(request, `Narrow screen check with a rather long title ${suffix}`);
  await page.setViewportSize({ width: 375, height: 800 });
  // My work's own layout (the dashboard) is checked by its owner's spec; here the pages this feature changes.
  for (const path of ['/requests', `/admin/forms/${formId}?tab=assignments`]) {
    await page.goto(path);
    await settle(page);
    const { overflow, offenders } = await overflowing(page);
    expect(overflow, `${path}\n${offenders.join('\n')}`).toBeLessThanOrEqual(0);
  }
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.evaluate(() => localStorage.setItem('theme', 'dark'));
  await page.goto('/my-work');
  await expect(page.getByRole('region', { name: 'To do' })).toBeVisible();
  await expectAccessible(page);
  await page.goto(`/admin/forms/${formId}?tab=assignments`);
  await expect(page.getByText(`Narrow screen check with a rather long title ${suffix}`)).toBeVisible();
  await expectAccessible(page);
});
