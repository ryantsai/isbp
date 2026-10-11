import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, expect, type Page, test } from './fixtures';
import { overflowing, settle } from './helpers';

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

/** People made by a test are offboarded afterwards (people are never deleted). */
async function offboard(request: APIRequestContext, id: string | undefined) {
  if (!id) return;
  await request.post(`/api/v1/users/${id}/offboard`, {
    headers: { 'x-csrf-token': await csrfOf(request) },
    data: { reason: 'e2e clean-up' },
  });
}

const personId = (page: Page) => new URL(page.url()).pathname.split('/').pop()!;

test('search and filter people (state is kept in the URL)', async ({ page }) => {
  await page.goto('/admin/users');
  await page.getByRole('searchbox').fill('admin');
  await expect(page).toHaveURL(/q=admin/);
  await expect(page.getByRole('link', { name: /Platform Admin/ })).toBeVisible();
});

test('create a pre-boarded person, then onboard them', async ({ page, request }) => {
  const unique = Date.now().toString(36);
  let id: string | undefined;
  try {
    await page.goto('/admin/users');
    await page.getByRole('button', { name: 'Add person' }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('Work email').fill(`e2e.${unique}@isbp.example`);
    await sheet.getByLabel('Display name').fill(`E2E Person ${unique}`);
    await sheet.getByRole('radio', { name: /Pre-boarded/ }).click();
    await sheet.getByRole('button', { name: 'Create' }).click();

    await expect(page).toHaveURL(/\/admin\/users\/[0-9a-f-]+\?new=1$/, { timeout: 60_000 });
    id = personId(page);
    await expect(page.getByRole('heading', { name: `E2E Person ${unique}` })).toBeVisible();
    await expect(page.getByText('Pending').first()).toBeVisible();
    // A pre-boarded person's next step is onboarding on their first day.
    await expect(page.getByText('Activate the account on their first day')).toBeVisible();
    await page.getByRole('button', { name: 'Onboard' }).click();
    await expect(page.getByText('Active').first()).toBeVisible();
  } finally {
    await offboard(request, id);
  }
});

test('Add person: the display name and manager fill themselves in, groups are chosen up front', async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  let id: string | undefined;
  try {
    await page.goto('/admin/users?create=1');
    const sheet = page.getByRole('dialog', { name: 'Add a person' });
    // Empty submit: plain messages, not Zod's.
    await sheet.getByRole('button', { name: 'Create' }).click();
    await expect(sheet.getByText('Enter an email address, like name@example.com')).toBeVisible();

    await sheet.getByLabel('Work email').fill(`e2e.kai.${unique}@isbp.example`);
    await sheet.getByLabel('Given name').fill('Kai');
    await sheet.getByLabel('Family name').fill(`Chen${unique}`);
    await expect(sheet.getByLabel('Display name')).toHaveValue(`Kai Chen${unique}`);

    await sheet.getByRole('combobox', { name: 'Department' }).click();
    await page.getByRole('option', { name: 'Service Desk', exact: true }).click();
    // The department's manager is suggested (the picker is named "Manager").
    await expect(sheet.getByRole('combobox', { name: 'Manager' })).not.toHaveText(/No manager/);
    await expect(sheet.getByText('Suggested: the manager of Service Desk.')).toBeVisible();
    // The chosen department shows its name only (no tree glyph).
    await expect(sheet.getByRole('combobox', { name: 'Department' })).toHaveText('Service Desk');

    await sheet.getByRole('combobox', { name: 'Add groups' }).fill('Network');
    await page.getByRole('option', { name: /Network Team/ }).click();
    // The list closes by itself after a pick; the group is now a chip.
    await expect(sheet.getByRole('button', { name: 'Remove Network Team' })).toBeVisible();
    await expectAccessible(page);

    await sheet.getByRole('button', { name: 'Create' }).click();
    await expect(page).toHaveURL(/\?new=1$/, { timeout: 60_000 });
    id = personId(page);
    const next = page.getByRole('region', { name: /What’s next\?/ });
    await expect(next.getByRole('link', { name: 'Grant a role' })).toBeVisible();
    await next.getByRole('button', { name: 'Dismiss next steps' }).click();
    await expect(next).toBeHidden();
    await expect(page.getByRole('tab', { name: /Groups/ })).toContainText('1');
  } finally {
    await offboard(request, id);
  }
});

test('the Groups tab adds and removes groups, and Move to another department does it all at once', async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const csrf = await csrfOf(request);
  const departments = (await (await request.get('/api/v1/departments')).json()) as {
    items: { id: string; name: string }[];
  };
  const from = departments.items.find((d) => d.name === 'Service Desk')!;
  const created = await request.post('/api/v1/users', {
    headers: { 'x-csrf-token': csrf },
    data: {
      email: `e2e.mover.${unique}@isbp.example`,
      username: `e2e.mover.${unique}`,
      displayName: `E2E Mover ${unique}`,
      departmentId: from.id,
    },
  });
  const id = ((await created.json()) as { id: string }).id;
  try {
    await page.goto(`/admin/users/${id}?tab=groups`);
    await page.getByRole('button', { name: 'Add to groups' }).click();
    const dialog = page.getByRole('dialog', { name: `Add E2E Mover ${unique} to groups` });
    await dialog.getByRole('combobox', { name: /groups/i }).fill('Network');
    await page.getByRole('option', { name: /Network Team/ }).click();
    await dialog.getByRole('button', { name: 'Add to 1 group' }).click();
    await expect(page.getByRole('link', { name: 'Network Team' })).toBeVisible();

    await page.getByRole('button', { name: 'Remove from Network Team' }).click();
    await expect(page.getByText('Removed from Network Team').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Network Team' })).toBeHidden();

    // Move: department, suggested manager, groups and roles in one sheet.
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Move to another department' }).click();
    const sheet = page.getByRole('dialog', { name: `Move E2E Mover ${unique} to another department` });
    await sheet.getByRole('combobox', { name: /New department/ }).click();
    await page
      .getByRole('option', { name: /Infrastructure/ })
      .first()
      .click();
    await expect(sheet.getByText(/Suggested: the manager of/)).toBeVisible();
    await expect(sheet.getByText(/Joins .* group|Joins no groups/)).toBeVisible();
    await expectAccessible(page);
    await sheet.getByRole('button', { name: 'Move', exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByText(/Infrastructure/).first()).toBeVisible();

    await page.getByRole('tab', { name: 'Activity' }).click();
    await expect(page.getByText('Moved to another department').first()).toBeVisible();
  } finally {
    await offboard(request, id);
  }
});

test('Access lists roles and why; permission codes only behind Show permissions', async ({
  page,
  request,
}) => {
  const people = (await (await request.get('/api/v1/users?q=helpdesk')).json()) as {
    items: { id: string }[];
  };
  await page.goto(`/admin/users/${people.items[0]!.id}?tab=access`);
  const card = page.getByRole('tabpanel');
  await expect(card.getByText(/Via group|Assigned directly/).first()).toBeVisible();
  // Codes are collapsed (hidden from assistive technology too) until asked for.
  await expect(card.locator('[aria-hidden="true"] code').first()).toBeAttached();
  await card.getByRole('button', { name: 'Show permissions' }).click();
  await expect(card.getByRole('button', { name: 'Hide permissions' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(card.locator('[aria-hidden="true"] code')).toHaveCount(0);
});

test('audit log: search by the label shown, What changed, and a role’s own Activity', async ({
  page,
  request,
}) => {
  await page.goto('/admin/audit');
  await page.getByRole('searchbox').fill('Signed in');
  await expect(page).toHaveURL(/q=Signed/);
  await expect(page.getByRole('button', { name: 'Signed in' }).first()).toBeVisible();

  await page.goto('/admin/audit?changed=roles&period=30d');
  await expect(page.getByRole('combobox', { name: 'What changed' })).toHaveText('Roles');
  const table = page.getByRole('table');
  await expect(table.getByRole('button', { name: /role/i }).first()).toBeVisible();
  await expect(table.getByRole('button', { name: 'Signed in' })).toHaveCount(0);
  await expectAccessible(page);

  const roles = (await (await request.get('/api/v1/roles')).json()) as {
    items: { id: string; key: string }[];
  };
  const role = roles.items.find((r) => r.key === 'module-admin')!;
  // Grant it for a day (a fresh demo may have no grant of this role in its audit log), then take it back.
  const csrf = await csrfOf(request);
  const users = (await (await request.get('/api/v1/users?q=auditor')).json()) as {
    items: { id: string; username: string }[];
  };
  const auditor = users.items.find((u) => u.username === 'auditor')!;
  const granted = await request.post('/api/v1/role-assignments', {
    headers: { 'x-csrf-token': csrf },
    data: {
      roleId: role.id,
      principalType: 'user',
      principalId: auditor.id,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      reason: 'E2E: role activity',
    },
  });
  expect(granted.status()).toBe(201);
  const assignment = ((await granted.json()) as { id: string }).id;
  try {
    await page.goto(`/admin/roles/${role.id}`);
    await page.getByRole('tab', { name: 'Activity' }).click();
    await expect(page.getByRole('button', { name: /Granted role/ }).first()).toBeVisible();
  } finally {
    await request.delete(`/api/v1/role-assignments/${assignment}`, { headers: { 'x-csrf-token': csrf } });
  }
});

test('roles are grouped by area, without keys or codes on the list', async ({ page }) => {
  await page.goto('/admin/roles');
  const platform = page.getByRole('button', { name: /Platform administration/ });
  await expect(platform).toHaveAttribute('aria-expanded', 'false');
  await platform.click();
  await expect(page.getByRole('link', { name: /Security auditor/ })).toBeVisible();
  await expect(page.getByText('security-auditor')).toBeHidden();
  await page.getByRole('combobox', { name: 'Type' }).click();
  await page.getByRole('option', { name: 'Custom' }).click();
  await expect(page).toHaveURL(/type=custom/);
  await expect(page.getByRole('link', { name: /HR partner/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Security auditor/ })).toBeHidden();
  await expectAccessible(page);
});

for (const path of ['/admin/roles', '/admin/modules', '/admin/identity-providers', '/admin/audit']) {
  test(`${path} fits a 375 px phone`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(path);
    await settle(page);
    const result = await overflowing(page);
    expect(result.overflow, JSON.stringify(result.offenders)).toBeLessThanOrEqual(0);
  });
}
