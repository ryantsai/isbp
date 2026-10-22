import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, expect, type Page, test } from './fixtures';
import { overflowing, settle } from './helpers';

/*
 * The Phase 8 demo process, as the seed builds it: the "Configuration change request" form (key `config-change`,
 * offered to the IS groups that can read the CMDB) with CIs picked from the CMDB, two rules (the end can't be before
 * the start; a high-risk change needs a rollback plan) and the "Configuration change approval" workflow that routes
 * on the picked CIs (their support groups, and the Change Advisory Board for a critical CI). Runs as the seeded
 * admin, who is in IS Administrators; the request it sends is cancelled afterwards.
 *   E2E_BASE_URL=http://localhost:3000 pnpm e2e process-builder-demo
 */

const FORM = '/requests/forms/config-change';
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const stamp = Date.now().toString(36);
let reference = '';

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

/** Picks a CI in the multiple record field by name. */
async function pickCi(page: Page, name: string) {
  await page.getByRole('combobox', { name: 'Configuration items' }).fill(name);
  await page
    .getByRole('option', { name: new RegExp(name) })
    .first()
    .click();
  await page.keyboard.press('Escape');
}

test.describe.configure({ mode: 'serial' });

test.afterAll(async ({ request }) => {
  if (!reference) return;
  const res = await request.get(`/api/v1/requests/${reference}`);
  const id = ((await res.json()) as { submission?: { id: string } }).submission?.id;
  if (id)
    await request.post(`/api/v1/form-submissions/${id}/cancel`, {
      headers: { 'x-csrf-token': await csrfOf(request) },
      data: { reason: 'e2e cleanup' },
    });
});

test('the demo configuration change request: CIs from the CMDB, its rules and who approves', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto('/requests');
  await expect(page.getByRole('link', { name: /Configuration change request/ }).first()).toBeVisible();
  await page.goto(FORM);
  await expect(page.getByRole('heading', { name: 'Configuration change request' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Who will approve this?' })).toBeVisible();

  // A medium CI: its support group approves.
  await pickCi(page, 'fs-01');
  // The picked record is a token beside the picker.
  await expect(page.getByText('fs-01').first()).toBeVisible();
  const supportGroup = page.getByRole('listitem').filter({ hasText: 'CI support group' });
  await expect(supportGroup).toBeVisible();
  await expect(supportGroup).not.toContainText('Skipped');

  // A critical one too: the Change Advisory Board joins.
  await pickCi(page, 'erp-db-01');
  await expect(page.getByText('erp-db-01').first()).toBeVisible();
  const cab = page.getByRole('listitem').filter({ hasText: 'Change Advisory Board' });
  await expect(cab).toBeVisible();
  await expect(cab).not.toContainText('Skipped');
  await expectAccessible(page);

  // The end can't be before the start.
  await page.getByRole('textbox', { name: 'Summary' }).fill(`E2E patch window ${stamp}`);
  await page.getByLabel('Planned start').fill(day(20));
  await page.getByLabel('Planned end').fill(day(19));
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText('The end date can’t be before the start date')).toBeVisible();
  await expect(page.getByLabel('Planned end')).toHaveAttribute('aria-invalid', 'true');

  // A high-risk change needs a rollback plan.
  await page.getByLabel('Planned end').fill(day(21));
  await page.getByRole('combobox', { name: 'Risk' }).click();
  await page.getByRole('option', { name: 'High', exact: true }).click();
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText('A high-risk change needs a rollback plan')).toBeVisible();
  await expect(page.getByLabel('Rollback plan')).toHaveAttribute('aria-invalid', 'true');
  await expectAccessible(page);

  await page.getByLabel('Rollback plan').fill('Fail back to the replica.');
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page).toHaveURL(/\/requests\/REQ-\d{5}$/);
  reference = page.url().split('/').pop()!;
  // "Waiting for approval" until the path loads, then "Waiting for <approvers>".
  await expect(page.getByRole('region', { name: 'Status' }).getByText(/^Waiting for /)).toBeVisible();
  await expect(page.getByRole('link', { name: /erp-db-01/ }).first()).toBeVisible();
  await expectAccessible(page);
});

test('the demo request form works at 375 px and in dark mode', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(FORM);
  await expect(page.getByRole('combobox', { name: 'Configuration items' })).toBeVisible();
  await settle(page);
  const { overflow, offenders } = await overflowing(page);
  expect(overflow, offenders.join('\n')).toBeLessThanOrEqual(1);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.evaluate(() => localStorage.setItem('theme', 'dark'));
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Configuration items' })).toBeVisible();
  await expectAccessible(page);
  await page.evaluate(() => localStorage.setItem('theme', 'light'));
});

test('the demo change set links to the form, and the approved demo request shows the change it raised', async ({
  page,
  request,
}) => {
  await page.goto('/assistant/change-sets?scope=all&q=Configuration%20change%20requests');
  await page
    .getByRole('link', { name: /Configuration change requests/ })
    .first()
    .click();
  const live = page.getByRole('region', { name: 'Ready to use' });
  await expect(
    live.getByRole('link', { name: 'Open the form: Configuration change request' }),
  ).toHaveAttribute('href', FORM);

  // The approved request's "What happens next": the change, raised and submitted for authorization.
  const mine = (await (await request.get('/api/v1/forms')).json()) as {
    items: { id: string; key: string }[];
  };
  const form = mine.items.find((f) => f.key === 'config-change')!;
  const subs = (await (await request.get(`/api/v1/forms/${form.id}/submissions?status=approved`)).json()) as {
    items: { reference: string }[];
  };
  expect(subs.items.length).toBeGreaterThan(0);
  await page.goto(`/requests/${subs.items.at(-1)!.reference}`);
  await expect(page.getByText('Change raised and submitted for authorization')).toBeVisible();
  await expect(page.getByRole('link', { name: /CHG-\d{5}/ }).first()).toBeVisible();
  await expectAccessible(page);
});
