import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, expect, type Page, test } from './fixtures';
import { overflowing, settle } from './helpers';

/*
 * One place to build a process: the form builder's Approval tab sets up the form's approval on the workflow canvas
 * (preset to the form's answers), "Before you publish" warns about what would stop it working, and one Publish puts
 * the approval and the form live together, then offers the form's link. The workflow designer no longer claims
 * "Unsaved changes" right after publishing, and the Workflows list is organised by what it approves.
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
let formId = '';
let workflowId = '';

test.beforeAll(async ({ request }) => {
  const headers = { 'x-csrf-token': await csrfOf(request) };
  const form = await request.post('/api/v1/forms', {
    headers,
    data: { key: `e2e-purchase-${suffix}`, name: { en: `E2E software purchase ${suffix}` } },
  });
  expect(form.status()).toBe(201);
  formId = ((await form.json()) as { id: string }).id;
  const draft = {
    elements: [
      {
        id: 'app',
        key: 'application',
        type: 'record',
        label: { en: 'Application' },
        required: true,
        record: { types: ['alm.application'] },
      },
      { id: 'why', key: 'why', type: 'textarea', label: { en: 'Why do you need it?' }, required: true },
    ],
  };
  expect((await request.patch(`/api/v1/forms/${formId}`, { headers, data: { draft } })).ok()).toBe(true);
});

test.afterAll(async ({ request }) => {
  const headers = { 'x-csrf-token': await csrfOf(request) };
  if (formId) await request.post(`/api/v1/forms/${formId}/archive`, { headers });
  if (workflowId) await request.post(`/api/v1/workflows/${workflowId}/archive`, { headers });
});

test('form builder: set up the approval in the form and publish both at once', async ({ page, request }) => {
  await page.goto(`/admin/forms/${formId}`);
  const tabs = page.getByRole('tablist', { name: 'Build the process' }).getByRole('tab');
  await expect(tabs).toHaveText([/Questions/, /Rules/, /Approval/, /Actions/, /Preview/, /Settings/]);
  await page.getByRole('tab', { name: /Approval/ }).click();
  await expect(page).toHaveURL(/tab=approval/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Who approves these requests?' })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Set up an approval' }).click();

  // A first step is ready: the requester's manager, preset to this form's answers.
  await expect(page.getByRole('button', { name: /Manager approval/ }).first()).toBeVisible();
  await expect(page.getByLabel('Name of the approval')).toHaveValue(
    `E2E software purchase ${suffix} approval`,
  );
  await expectAccessible(page);

  // A second step: whoever owns the picked application (named after its approver).
  await page.getByRole('button', { name: 'Add a step here' }).last().click();
  await page.getByRole('menuitem', { name: /Approval/ }).click();
  await page.getByRole('combobox', { name: 'Approver type' }).first().click();
  await page.getByRole('option', { name: 'Person in a field' }).click();
  await page.getByRole('combobox', { name: 'Person in a field' }).click();
  await page
    .getByRole('option', { name: /Application: .*owner/i })
    .first()
    .click();
  await expect(page.getByLabel('Step name')).toHaveValue(/Application: .*owner approval/i);

  // Before you publish: an empty owner would reject every request.
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByText('Before you publish')).toBeVisible();
  await expect(dialog.getByText(/finds no approver and the request is rejected/)).toBeVisible();
  await expect(dialog.getByText(/is published too/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Skip the step instead' }).click();
  // The fix applies at once and its warning goes; the dialog stays open to publish.
  await expect(dialog.getByText(/finds no approver and the request is rejected/)).toHaveCount(0);
  await dialog.getByRole('button', { name: /^Publish/ }).click();
  const success = page.getByRole('status').filter({ hasText: /Version 1 is live for everyone/ });
  await expect(success).toBeVisible();
  await expect(success.getByRole('button', { name: 'Copy link' })).toBeVisible();
  await expect(page.getByText('Unsaved changes')).toHaveCount(0);

  const form = (await (await request.get(`/api/v1/forms/${formId}`)).json()) as {
    publishedVersion: number;
    workflow: { id: string } | null;
  };
  expect(form.publishedVersion).toBe(1);
  expect(form.workflow).not.toBeNull();
  workflowId = form.workflow!.id;
  const wf = (await (await request.get(`/api/v1/workflows/${workflowId}`)).json()) as {
    publishedVersion: number;
    draft: { steps: { ifNoApprover?: string }[] };
  };
  expect(wf.publishedVersion).toBe(1);
  expect(wf.draft.steps).toHaveLength(2);
  expect(wf.draft.steps[1]!.ifNoApprover).toBe('skip');
});

test('preview shows who would approve the sample answers', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`/admin/forms/${formId}?tab=preview`);
  await expect(page.getByRole('heading', { name: 'Who will approve this?' })).toBeVisible();
  // A dry run on the server for the sample answers (the owner step waits for an application to be picked).
  await expect(page.getByText('Manager approval').first()).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(/Depends on the answer to “Application”/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What happens next' })).toBeVisible();
  await expectAccessible(page);
});

test('the Approval tab works at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/admin/forms/${formId}?tab=approval`);
  await expect(page.getByRole('button', { name: /Manager approval/ }).first()).toBeVisible();
  const { overflow, offenders } = await overflowing(page);
  expect(offenders).toEqual([]);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('workflow designer: publishing leaves nothing unsaved', async ({ page }) => {
  await page.goto(`/admin/workflows/${workflowId}`);
  await expect(page.getByText('Version 1').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Workflow' }).click();
  await page.getByLabel('Description').fill('Checked by e2e');
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Published version 2').first()).toBeVisible();
  await expect(page.getByText('Unsaved changes')).toHaveCount(0);
  await expect(page.getByText('Unpublished changes')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled();
});

test('workflows list: approvals for forms, then built-in approvals by area', async ({ page }) => {
  await page.goto('/admin/workflows');
  await expect(page.getByRole('heading', { name: 'Approvals for forms' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Built-in approvals' })).toBeVisible();
  await expect(page.getByText(`Used by: E2E software purchase ${suffix}`)).toBeVisible();
  // Trigger keys stay out of sight.
  await expect(page.getByText('core.access-request')).toHaveCount(0);
  await expectAccessible(page);
});
