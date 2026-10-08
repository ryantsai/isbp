import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from './fixtures';
import { overflowing, settle } from './helpers';

/**
 * The AI agent (Phase 6) against the seeded demo stack, which has no chat model: the assistant panel opens from any
 * page in builtin mode with the guided templates, a template builds a change set (a custom field on groups), the
 * change set page shows the dry run and the proposed value, the admin applies it and rolls it back again (which
 * also leaves the demo data as it was), the change sets list finds it, and the panel and pages are accessible
 * (light and dark) and fit a 375 px screen. The "Approval process" template proposes a workflow and the form using it
 * as one change set; once applied, its page links to the form. Runs as the seeded admin.
 *   E2E_BASE_URL=http://localhost:3000 pnpm e2e assistant
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

async function useScheme(page: Page, scheme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  await page.evaluate((s) => localStorage.setItem('theme', s), scheme);
  await page.reload();
}

/** Opens the assistant from the header of the current page. */
async function openAssistant(page: Page) {
  await page.getByRole('banner').getByRole('button', { name: 'Assistant', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Assistant' });
  await expect(panel).toBeVisible();
  return panel;
}

const stamp = Date.now().toString(36);
const fieldLabel = `E2E cost centre ${stamp}`;
/** The change set the template builds (its page is used by the later tests). */
let changeSet = { reference: '', path: '' };

test.describe.configure({ mode: 'serial' });

test('the assistant opens from any page and offers guided templates without a chat model', async ({
  page,
}) => {
  for (const path of ['/', '/admin/ai']) {
    await page.goto(path);
    const panel = await openAssistant(page);
    // Builtin mode says so, and replaces free text with the kinds' templates.
    await expect(panel.getByText('Guided templates').first()).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Guided templates' })).toBeVisible();
    await expect(panel.getByRole('button', { name: /Custom field/ }).first()).toBeVisible();
    await expect(panel.getByRole('button', { name: /Approval chain/ }).first()).toBeVisible();
    await expect(panel.getByRole('button', { name: /Approval process/ }).first()).toBeVisible();
    await expect(panel.getByRole('textbox', { name: 'Message to the assistant' })).toHaveCount(0);
    await panel.getByRole('button', { name: 'Close the assistant' }).click();
    await expect(panel).toBeHidden();
  }
});

test('a guided template builds a change set, which is dry-run, applied and rolled back', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const panel = await openAssistant(page);
  await panel
    .getByRole('button', { name: /Custom field/ })
    .first()
    .click();
  await expect(panel.getByRole('heading', { name: 'Custom field' })).toBeVisible();

  await panel.getByRole('combobox', { name: 'Add it to' }).click();
  await page.getByRole('option', { name: 'Groups', exact: true }).click();
  await panel.getByRole('textbox', { name: 'Label', exact: true }).fill(fieldLabel);
  await panel.getByRole('button', { name: 'Prepare the change' }).click();

  // The change lands in a new change set; the card links to its page.
  const added = panel.getByText(/^Added to CS-\d{5}\.$/);
  await expect(added).toBeVisible();
  const reference = (await added.textContent())!.match(/CS-\d{5}/)![0];
  const card = panel.getByRole('region', { name: `Change set ${reference}` });
  await expect(card.getByText('1 change')).toBeVisible();
  await expect(card.getByText('Ready')).toBeVisible();
  await card.getByRole('link', { name: 'Review and apply' }).click();
  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(/\/assistant\/change-sets\/[0-9a-f-]{36}$/);
  changeSet = { reference, path: new URL(page.url()).pathname };

  // The change set page: title from the item, the dry run passed, the proposed value.
  const h1 = page.getByRole('heading', { level: 1 });
  await expect(h1).toContainText(fieldLabel);
  await expect(h1).toContainText(reference);
  await expect(page.getByText('Draft', { exact: true }).first()).toBeVisible();
  const item = page.getByRole('article', { name: new RegExp(fieldLabel) });
  await expect(item.getByText('Create', { exact: true })).toBeVisible();
  await expect(item.getByText('Dry run passed')).toBeVisible();
  const value = item.getByRole('region', { name: 'Proposed value' });
  await expect(value.getByText('entityType', { exact: true })).toBeVisible();
  await expect(value.getByText('core.group', { exact: true })).toBeVisible();
  await expect(value.getByText('field', { exact: true })).toBeVisible();

  // Apply it (one transaction with the admin's permissions).
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  const apply = page.getByRole('alertdialog', { name: `Apply ${reference}?` });
  await expect(apply).toBeVisible();
  await expectAccessible(page, 'apply dialog');
  await apply.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(apply).toBeHidden();
  await expect(page.getByText(`${reference} was applied`).first()).toBeVisible();
  await expect(page.getByText('Applied', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/^Applied by /)).toBeVisible();
  await expect(item.getByText('Applied', { exact: true })).toBeVisible();

  // The field exists for groups now.
  await expect(async () => {
    const res = await page.request.get('/api/v1/custom-fields?entityType=core.group');
    expect(res.ok()).toBeTruthy();
    expect(JSON.stringify(await res.json())).toContain(fieldLabel);
  }).toPass({ timeout: 15_000 });

  // A proposed update of the new field reads as a diff of current → proposed (that draft is then discarded).
  const api = page.request;
  const session = (await (await api.get('/api/v1/auth/session')).json()) as { csrfToken: string };
  const headers = { 'x-csrf-token': session.csrfToken };
  const applied = (await (await api.get(`/api/v1${changeSet.path}`)).json()) as {
    items: { appliedId: string; after: { value: { field: { label: Record<string, string> } } } }[];
  };
  const created = applied.items[0]!;
  const renamed = `${fieldLabel} (renamed)`;
  const draft = await api.post('/api/v1/assistant/change-sets', {
    data: { title: `E2E rename ${stamp}` },
    headers,
  });
  expect(draft.ok(), await draft.text()).toBeTruthy();
  const draftId = ((await draft.json()) as { id: string }).id;
  const current = created.after.value;
  const proposed = await api.post(`/api/v1/assistant/change-sets/${draftId}/items`, {
    data: {
      kind: 'core.custom-field',
      op: 'update',
      targetId: created.appliedId,
      value: { ...current, field: { ...current.field, label: { ...current.field.label, en: renamed } } },
    },
    headers,
  });
  expect(proposed.ok(), await proposed.text()).toBeTruthy();
  await page.goto(`/assistant/change-sets/${draftId}`);
  const update = page.getByRole('article').first();
  await expect(update.getByText('Update', { exact: true })).toBeVisible();
  const diff = update.getByRole('region', { name: 'Differences: current → proposed' });
  await expect(diff.getByText('Changed', { exact: true })).toBeVisible();
  await expect(diff.getByText('field.label.en', { exact: true })).toBeVisible();
  await expect(diff.getByText(fieldLabel, { exact: true })).toBeVisible();
  await expect(diff.getByText(renamed, { exact: true })).toBeVisible();
  await expectAccessible(page, 'change set with an update diff');
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Discard' }).click();
  const discard = page.getByRole('alertdialog', { name: /^Discard CS-\d{5}\?$/ });
  await discard.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(discard).toBeHidden();
  await expect(page.getByText('Discarded', { exact: true }).first()).toBeVisible();

  // Roll the first change set back (the created field is archived), with a reason for the audit log.
  await page.goto(changeSet.path);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(fieldLabel);
  await page.getByRole('button', { name: 'Roll back', exact: true }).click();
  const rollback = page.getByRole('alertdialog', { name: `Roll back ${reference}?` });
  await expect(rollback).toBeVisible();
  await rollback.getByRole('textbox', { name: /Reason/ }).fill('End-to-end test clean-up');
  await rollback.getByRole('button', { name: 'Roll back', exact: true }).click();
  await expect(rollback).toBeHidden();
  await expect(page.getByText(`${reference} was rolled back`).first()).toBeVisible();
  await expect(page.getByText('Rolled back', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/^Rolled back by /)).toBeVisible();
});

test('the change sets list finds the change set by reference and status', async ({ page }) => {
  expect(changeSet.reference, 'the template test ran first').not.toBe('');
  await page.goto('/assistant/change-sets');
  await expect(page.getByRole('heading', { name: 'Change sets', level: 1 })).toBeVisible();
  const tabs = page.getByRole('tablist', { name: 'Whose change sets' });
  await expect(tabs.getByRole('tab', { name: 'Mine' })).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('searchbox').fill(changeSet.reference);
  await expect(page).toHaveURL(new RegExp(`q=${changeSet.reference}`));
  const row = page.getByRole('row').filter({ hasText: changeSet.reference });
  await expect(row).toHaveCount(1);
  await expect(row.getByText('Rolled back')).toBeVisible();

  await page.getByRole('combobox', { name: 'Status' }).click();
  await page.getByRole('option', { name: 'Draft', exact: true }).click();
  await expect(page).toHaveURL(/status=draft/);
  await expect(page.getByText('No change sets match')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();

  await tabs.getByRole('tab', { name: 'All' }).click();
  await expect(page).toHaveURL(/scope=all/);
  await expect(page.getByRole('table', { name: 'Change sets' })).toBeVisible();

  await page
    .getByRole('link', { name: new RegExp(changeSet.reference) })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`${changeSet.path}$`));
});

test('the approval-process template builds a form with its own approval, and the applied set links to the form', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const name = `E2E server change ${stamp}`;
  await page.goto('/');
  const panel = await openAssistant(page);
  await panel
    .getByRole('button', { name: /Approval process/ })
    .first()
    .click();
  await expect(panel.getByRole('heading', { name: 'Approval process' })).toBeVisible();

  // The form: records people pick (CIs), a question, then who approves (manager → the CIs' groups → the CAB).
  await panel.getByRole('textbox', { name: 'Form name', exact: true }).fill(name);
  await panel.getByRole('combobox', { name: 'Records people pick' }).click();
  await page.getByRole('option', { name: 'Configuration item', exact: true }).click();
  await panel.getByRole('textbox', { name: 'Question for the records' }).fill('Servers');
  await panel.getByRole('checkbox', { name: 'People can pick several' }).check();
  await panel.getByRole('textbox', { name: 'Question 1' }).fill('Summary');
  await expect(panel.getByRole('checkbox', { name: "The requester's manager approves first" })).toBeChecked();
  await panel
    .getByRole('checkbox', { name: 'Then the group responsible for the picked records approves' })
    .check();
  await expect(panel.getByRole('combobox', { name: 'Group from the records' })).toContainText(
    'Support group',
  );
  await panel.getByRole('checkbox', { name: 'Then a group approves' }).check();
  await panel.getByRole('combobox', { name: 'Group', exact: true }).click();
  await page.getByRole('option', { name: 'Change Advisory Board' }).click();
  await expectAccessible(page, 'approval-process template');
  await panel.getByRole('button', { name: 'Prepare the change' }).click();

  // One change set with both: the workflow, then the form that refers to it.
  const added = panel.getByText(/^Added to CS-\d{5}\.$/);
  await expect(added).toBeVisible();
  const reference = (await added.textContent())!.match(/CS-\d{5}/)![0];
  const card = panel.getByRole('region', { name: `Change set ${reference}` });
  await expect(card.getByText('2 changes')).toBeVisible();
  await expect(card.getByText('Ready')).toBeVisible();
  await card.getByRole('link', { name: 'Review and apply' }).click();
  await expect(page).toHaveURL(/\/assistant\/change-sets\/[0-9a-f-]{36}$/);
  const path = new URL(page.url()).pathname;
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name);
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.getByRole('article', { name: new RegExp(`${name} – approval`) })).toBeVisible();

  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  const apply = page.getByRole('alertdialog', { name: `Apply ${reference}?` });
  await apply.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(apply).toBeHidden();
  await expect(page.getByText(`${reference} was applied`).first()).toBeVisible();

  // Ready to use: the form's own page, for the people who request.
  const live = page.getByRole('region', { name: 'Ready to use' });
  await expect(live).toBeVisible();
  const open = live.getByRole('link', { name: `Open the form: ${name}` });
  await expect(open).toHaveAttribute('href', /^\/requests\/forms\/e2e-server-change-/);
  await expectAccessible(page, 'applied change set with its links');
  const href = (await open.getAttribute('href'))!;
  await open.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Servers' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Who will approve this?' })).toBeVisible();

  // Leave the demo as it was: the form and its workflow are archived again.
  await page.goto(path);
  await page.getByRole('button', { name: 'Roll back', exact: true }).click();
  const rollback = page.getByRole('alertdialog', { name: `Roll back ${reference}?` });
  await rollback.getByRole('button', { name: 'Roll back', exact: true }).click();
  await expect(rollback).toBeHidden();
  await expect(page.getByText(`${reference} was rolled back`).first()).toBeVisible();
});

test('the assistant panel and change set pages have no accessibility violations (light and dark)', async ({
  page,
}) => {
  test.setTimeout(180_000);
  expect(changeSet.path, 'the template test ran first').not.toBe('');
  for (const scheme of ['light', 'dark'] as const) {
    await page.goto('/');
    await useScheme(page, scheme);
    const panel = await openAssistant(page);
    await expect(panel.getByRole('heading', { name: 'Guided templates' })).toBeVisible();
    await expectAccessible(page, `${scheme} assistant panel`);
    await panel
      .getByRole('button', { name: /Approval chain/ })
      .first()
      .click();
    await expect(panel.getByRole('combobox', { name: 'What needs approval' })).toBeVisible();
    await expectAccessible(page, `${scheme} assistant template form`);
    await panel.getByRole('button', { name: 'Close the assistant' }).click();

    for (const path of ['/assistant/change-sets', '/assistant/change-sets?scope=all', changeSet.path]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectAccessible(page, `${scheme} ${path}`);
    }

    await page.goto('/admin/ai?tab=mcp');
    await expect(page.getByText('/api/v1/mcp').first()).toBeVisible();
    await expect(page.getByText(/claude mcp add --transport http isbp/)).toBeVisible();
    await expectAccessible(page, `${scheme} AI → Outside agents (MCP)`);
  }
  await useScheme(page, 'light');
});

test('the assistant panel and change set pages fit a 375px screen', async ({ page }) => {
  expect(changeSet.path, 'the template test ran first').not.toBe('');
  await page.setViewportSize({ width: 375, height: 812 });

  await page.goto('/');
  const panel = await openAssistant(page);
  await expect(panel.getByRole('heading', { name: 'Guided templates' })).toBeVisible();
  const box = await panel.boundingBox();
  expect(box?.width, 'the panel takes the full width on phones').toBeGreaterThanOrEqual(370);
  await settle(page);
  let { overflow, offenders } = await overflowing(page);
  expect(overflow, `panel ${offenders.join(' | ')}`).toBeLessThanOrEqual(1);
  await panel.getByRole('button', { name: 'Close the assistant' }).click();

  for (const path of ['/assistant/change-sets', changeSet.path, '/admin/ai?tab=mcp']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await settle(page);
    ({ overflow, offenders } = await overflowing(page));
    expect(overflow, `${path} ${offenders.join(' | ')}`).toBeLessThanOrEqual(1);
  }
});
