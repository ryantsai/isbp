import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, expect, type Page, test } from './fixtures';
import { settle } from './helpers';

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

test('API client: create, store the secret once, revoke', async ({ page }) => {
  const name = `E2E client ${Date.now().toString(36)}`;
  await page.goto('/admin/api-clients');
  await page.getByRole('button', { name: 'Create client' }).first().click();
  const form = page.getByRole('dialog', { name: 'Create an API client' });
  await form.getByLabel('Name').fill(name);
  await form.getByRole('checkbox', { name: /Finance ERP/ }).check();
  await form.getByRole('button', { name: 'Create client' }).click();

  // The secret is shown exactly once; the dialog stays until it has been stored.
  // A dialog that must be answered (Astryx `purpose="required"`) is an alertdialog.
  const reveal = page.getByRole('alertdialog', { name: `“${name}” is ready` });
  await expect(reveal.getByText(/isbp_sk_/).first()).toBeVisible();
  await expect(reveal.getByRole('button', { name: 'Done' })).toBeDisabled();
  await reveal.getByLabel('I’ve stored the secret somewhere safe').check();
  await reveal.getByRole('button', { name: 'Done' }).click();
  await expect(reveal).toBeHidden();

  // Done opens the new client's page.
  await expect(page).toHaveURL(/\/admin\/api-clients\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await page.getByRole('button', { name: 'Revoke client' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Revoke client' }).click();
  await expect(page.getByText('Revoked').first()).toBeVisible();
});

test('form builder: create a form, add a field, publish', async ({ page, request }) => {
  const name = `E2E form ${Date.now().toString(36)}`;
  await page.goto('/admin/forms');
  await page.getByRole('button', { name: 'New form' }).click();
  const dialog = page.getByRole('dialog', { name: 'New form' });
  await dialog.getByLabel('Name').first().fill(name);
  await dialog.getByRole('button', { name: 'Create and open builder' }).click();
  await expect(page).toHaveURL(/\/admin\/forms\/[0-9a-f-]+/);
  const formId = page.url().split('/').pop()!.split('?')[0]!;

  try {
    await page.getByRole('button', { name: 'Add a short text field' }).click();
    await expect(page.getByText('Unsaved changes')).toBeVisible();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Draft saved').first()).toBeVisible();
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: /^Publish/ })
      .click();
    await expect(page.getByText('Version 1 is live').first()).toBeVisible();
    await expect(page.getByText('Published v1').first()).toBeVisible();
    await expectAccessible(page);
  } finally {
    // Archived forms leave the portal catalog.
    const csrf = await csrfOf(request);
    await request.post(`/api/v1/forms/${formId}/archive`, { headers: { 'x-csrf-token': csrf } });
  }
});

test('notifications: mark everything read', async ({ page, request }) => {
  const { notifications } = (await (await request.get('/api/v1/me/badges')).json()) as {
    notifications: number;
  };
  await page.goto('/notifications?view=unread');
  if (notifications > 0) {
    await expect(page.getByRole('listitem').first()).toBeVisible();
    await page.getByRole('button', { name: 'Mark all as read' }).click();
  }
  await expect(page.getByText("You're all caught up")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
});

test('custom fields: add a record field to tickets with the short editor', async ({ page, request }) => {
  const label = `E2E application ${Date.now().toString(36)}`;
  await page.goto('/admin/custom-fields?entity=itsm.ticket');
  await expect(page.getByRole('tab', { name: /Tickets/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Add field' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Add a field to Tickets' });
  await sheet.getByRole('combobox', { name: 'Field type' }).click();
  await page.getByRole('option', { name: 'Record' }).click();
  await sheet.getByRole('textbox', { name: 'Label' }).fill(label);
  await sheet.getByRole('checkbox', { name: 'Application', exact: true }).check();
  // Type, label, required and the record types come first; the rest waits under "More options", the key under
  // "Advanced".
  await expect(sheet.getByRole('button', { name: 'More options' })).toHaveAttribute('aria-expanded', 'false');
  await expect(sheet.getByRole('button', { name: 'Advanced' })).toHaveAttribute('aria-expanded', 'false');
  // A closed section is hidden from assistive technology (and inert).
  await expect(sheet.getByRole('textbox', { name: 'Key' })).toHaveCount(0);
  await expectAccessible(page);
  await sheet.getByRole('button', { name: 'Add field' }).click();
  await expect(sheet).toBeHidden();

  const headers = { 'x-csrf-token': await csrfOf(request) };
  const fields = (await (await request.get('/api/v1/custom-fields?entityType=itsm.ticket')).json()) as {
    items: { id: string; field: { label: { en?: string } } }[];
  };
  const id = fields.items.find((f) => f.field.label.en === label)?.id;
  try {
    expect(id).toBeTruthy();
    await expect(page.getByText(label).first()).toBeVisible();
  } finally {
    if (id) await request.post(`/api/v1/custom-fields/${id}/archive`, { headers });
  }
});

for (const [name, path] of [
  ['notifications', '/notifications'],
  ['settings', '/settings'],
  ['notification channels', '/admin/notifications'],
  ['email settings', '/admin/notifications?tab=email'],
  ['delivery log', '/admin/notifications?tab=log'],
  ['forms', '/admin/forms'],
  ['custom fields', '/admin/custom-fields'],
  ['applications', '/admin/applications'],
  ['API clients', '/admin/api-clients'],
] as const) {
  test(`${name} has no serious accessibility violations`, async ({ page }) => {
    await page.goto(path);
    await expectAccessible(page);
  });
}

test('application and API client detail pages have no serious accessibility violations (light and dark)', async ({
  page,
  request,
}) => {
  const apps = (await (await request.get('/api/v1/applications')).json()) as {
    items: { id: string; isPlatform: boolean }[];
  };
  const clients = (await (await request.get('/api/v1/api-clients')).json()) as { items: { id: string }[] };
  const appId = apps.items.find((a) => !a.isPlatform)!.id;
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    for (const path of [
      `/admin/applications/${appId}`,
      `/admin/applications/${appId}?tab=query`,
      `/admin/api-clients/${clients.items[0]!.id}`,
    ]) {
      await page.goto(path);
      await page.evaluate((s) => localStorage.setItem('theme', s), scheme);
      await page.reload();
      await expectAccessible(page);
    }
  }
});
