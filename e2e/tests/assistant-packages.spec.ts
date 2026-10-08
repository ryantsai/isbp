import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from './fixtures';
import { overflowing, settle } from './helpers';

/**
 * Change-set packages against the seeded demo stack, as the admin: on Change sets, **From a package** opens a dialog
 * with the modules' built-in packages and **Import a file**. A file with problems shows the API's list and creates
 * nothing; a valid one (a group, an approval workflow naming it, a form using the workflow by `$ref`) becomes a draft
 * change set whose dry run passes. Its **More actions → Export** downloads `<reference>.json`, which is the same
 * package; the draft is then discarded, so the demo stays as it was. The dialog passes axe in light and dark mode and
 * fits a 375 px screen.
 *   E2E_BASE_URL=http://localhost:3000 pnpm e2e assistant-packages
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

const stamp = Date.now().toString(36);
const text = (s: string) => ({ en: s, 'zh-TW': s, 'ja-JP': s });
const groupKey = `e2e-pack-${stamp}`;
const title = `E2E package ${stamp}`;

/** A small process as a package: its group, the approval that names it, the form that uses the approval. */
const process = {
  format: 'isbp.change-set-package',
  version: 1,
  key: 'e2e-process',
  title: text(title),
  summary: text('A reviewers group, its approval and the request form'),
  items: [
    {
      ref: 'reviewers',
      kind: 'core.group',
      op: 'create',
      value: { key: groupKey, name: `E2E reviewers ${stamp}` },
    },
    {
      ref: 'approval',
      kind: 'core.workflow',
      op: 'create',
      value: {
        name: `E2E approval ${stamp}`,
        description: null,
        triggerKey: 'core.form-submission',
        isDefault: false,
        graph: {
          steps: [
            {
              id: 'review',
              type: 'approval',
              name: text('Reviewers'),
              approvers: [{ type: 'group', groupKey }],
              mode: 'any',
            },
          ],
        },
      },
    },
    {
      ref: 'form',
      kind: 'core.form',
      op: 'create',
      value: {
        key: `e2e-pack-form-${stamp}`,
        name: text(`E2E packaged request ${stamp}`),
        description: null,
        icon: 'file-text',
        category: 'E2E',
        schema: {
          elements: [{ id: 'what', key: 'what', type: 'text', label: text('What'), required: true }],
        },
        workflowId: '$ref:approval',
        audience: { type: 'everyone' },
        active: true,
      },
    },
  ],
};

async function openDialog(page: Page) {
  await page.goto('/assistant/change-sets');
  await page.getByRole('button', { name: 'From a package' }).click();
  const dialog = page.getByRole('dialog', { name: 'New change set from a package' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe.configure({ mode: 'serial' });

test('the package dialog lists built-in packages and imports a file, refusing one with problems', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const dialog = await openDialog(page);
  const tabs = dialog.getByRole('tablist', { name: 'Where the package comes from' });
  await expect(tabs.getByRole('tab', { name: 'Built-in packages' })).toHaveAttribute('aria-selected', 'true');
  // Either the modules' packages (each with Install) or the empty state, never an error.
  await expect(
    dialog.getByRole('list', { name: 'Built-in packages' }).or(dialog.getByText('No built-in packages')),
  ).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expectAccessible(page, 'built-in packages');

  await tabs.getByRole('tab', { name: 'Import a file' }).click();
  const file = dialog.getByLabel('Package file');
  // Not JSON at all.
  await file.setInputFiles({
    name: 'notes.json',
    mimeType: 'application/json',
    buffer: Buffer.from('not json'),
  });
  await expect(dialog.getByText('This file isn’t valid JSON.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();

  // A package whose form refers to an approval that comes later: the API lists the problem, nothing is created.
  const broken = { ...process, items: [process.items[2], process.items[0], process.items[1]] };
  await file.setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(broken)),
  });
  await expect(dialog.getByText(/broken\.json/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  const problem = dialog.getByRole('alert');
  await expect(problem).toContainText('The package has problems. Nothing was created:');
  await expect(problem).toContainText('items.0.value');
  await expectAccessible(page, 'import with problems');

  // The package as it should be: a draft change set opens with its dry run.
  await file.setInputFiles({
    name: 'process.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(process)),
  });
  await expect(dialog.getByText(`“${title}”, 3 changes`)).toBeVisible();
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/assistant\/change-sets\/[0-9a-f-]{36}$/);
  const h1 = page.getByRole('heading', { level: 1 });
  await expect(h1).toContainText(title);
  await expect(page.getByText(/^CS-\d{5} created from the file$/).first()).toBeVisible();
  await expect(page.getByText('Draft', { exact: true }).first()).toBeVisible();
  for (const label of [`E2E reviewers ${stamp}`, `E2E approval ${stamp}`, `E2E packaged request ${stamp}`]) {
    const item = page.getByRole('article', { name: new RegExp(label) });
    await expect(item.getByText('Dry run passed')).toBeVisible();
  }
  const reference = (await h1.textContent())!.match(/CS-\d{5}/)![0];

  // Export: the same package, as <reference>.json.
  await page.getByRole('button', { name: 'More actions' }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(`${reference}.json`);
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8')) as typeof process;
  expect(exported).toMatchObject({ format: 'isbp.change-set-package', version: 1, title: text(title) });
  expect(exported.items.map((i) => [i.ref, i.kind, i.op])).toEqual(
    process.items.map((i) => [i.ref, i.kind, i.op]),
  );
  expect(exported.items[2]!.value).toMatchObject({ workflowId: '$ref:approval' });

  // Leave the demo as it was.
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Discard' }).click();
  const discard = page.getByRole('alertdialog', { name: `Discard ${reference}?` });
  await discard.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(discard).toBeHidden();
  await expect(page.getByText('Discarded', { exact: true }).first()).toBeVisible();
  // Nothing of the package went live.
  const groups = await page.request.get(`/api/v1/groups?q=${groupKey}`);
  expect(((await groups.json()) as { total: number }).total).toBe(0);
});

test('the package dialog is accessible in dark mode and fits a phone', async ({ page }) => {
  await page.goto('/assistant/change-sets');
  await useScheme(page, 'dark');
  let dialog = await openDialog(page);
  await expectAccessible(page, 'package dialog (dark)');
  await dialog.getByRole('tab', { name: 'Import a file' }).click();
  await expectAccessible(page, 'import a file (dark)');
  await useScheme(page, 'light');

  await page.setViewportSize({ width: 375, height: 812 });
  dialog = await openDialog(page);
  await expect(dialog.getByRole('tab', { name: 'Import a file' })).toBeVisible();
  const { overflow, offenders } = await overflowing(page);
  expect(overflow, offenders.join('\n')).toBeLessThanOrEqual(0);
  await dialog.getByRole('tab', { name: 'Import a file' }).click();
  await expect(dialog.getByLabel('Package file')).toBeVisible();
  expect((await overflowing(page)).overflow).toBeLessThanOrEqual(0);
});
