import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from './fixtures';
import { overflowing, settle } from './helpers';

/**
 * Process packs and change-set packages against the seeded demo stack, as the admin. **Install a process pack** (on
 * Change sets and on Forms) opens **Process packs**: the modules' built-in packs with what each creates, by process,
 * before installing, and **Import a file**. A file with problems shows the API's list and creates nothing; a valid one
 * (a group, an approval workflow naming it, a form using the workflow by `$ref`) becomes a draft change set, grouped
 * as one process, ready to apply. Its **More actions → Export** downloads `<reference>.json`, which is the same
 * package. **Review before installing** on the ISMS process pack opens its change set grouped by process. Every draft
 * is discarded, so the demo stays as it was. The page passes axe in light and dark mode and fits a 375 px screen.
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

/** Process packs, from the change sets page's header. */
async function openPacks(page: Page) {
  await page.goto('/assistant/change-sets');
  await page.getByRole('link', { name: 'Install a process pack' }).click();
  await expect(page).toHaveURL(/\/assistant\/packs$/);
  await expect(page.getByRole('heading', { name: 'Process packs', level: 1 })).toBeVisible();
  return page.getByRole('main');
}

test.describe.configure({ mode: 'serial' });

test('process packs list the built-in packs and import a file, refusing one with problems', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const packs = await openPacks(page);
  const tabs = packs.getByRole('tablist', { name: 'Where the pack comes from' });
  await expect(tabs.getByRole('tab', { name: 'Built-in' })).toHaveAttribute('aria-selected', 'true');
  // Either the modules' packs (each with Review before installing) or the empty state, never an error.
  await expect(
    packs.getByRole('list', { name: 'Built-in process packs' }).or(packs.getByText('No process packs')),
  ).toBeVisible();
  await expect(packs.getByRole('alert')).toHaveCount(0);
  await expectAccessible(page, 'built-in packs');

  await tabs.getByRole('tab', { name: 'Import a file' }).click();
  await expect(page).toHaveURL(/tab=file/);
  const file = packs.getByLabel('Package file');
  // Not JSON at all.
  await file.setInputFiles({
    name: 'notes.json',
    mimeType: 'application/json',
    buffer: Buffer.from('not json'),
  });
  await expect(packs.getByText('This file isn’t valid JSON.')).toBeVisible();
  await expect(packs.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();

  // A package whose form refers to an approval that comes later: the API lists the problem, nothing is created.
  const broken = { ...process, items: [process.items[2], process.items[0], process.items[1]] };
  await file.setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(broken)),
  });
  await expect(packs.getByText(/broken\.json/)).toBeVisible();
  await packs.getByRole('button', { name: 'Import', exact: true }).click();
  const problem = packs.getByRole('alert');
  await expect(problem).toContainText('The package has problems. Nothing was created:');
  await expect(problem).toContainText('items.0.value');
  await expectAccessible(page, 'import with problems');

  // The package as it should be: a draft change set opens with its dry run.
  await file.setInputFiles({
    name: 'process.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(process)),
  });
  await expect(packs.getByText(`“${title}”, 3 changes`)).toBeVisible();
  await packs.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page).toHaveURL(/\/assistant\/change-sets\/[0-9a-f-]{36}$/);
  const h1 = page.getByRole('heading', { level: 1 });
  await expect(h1).toContainText(title);
  await expect(page.getByText(/^CS-\d{5} created from the file$/).first()).toBeVisible();
  await expect(page.getByText('Draft', { exact: true }).first()).toBeVisible();
  for (const label of [`E2E reviewers ${stamp}`, `E2E approval ${stamp}`, `E2E packaged request ${stamp}`]) {
    const item = page.getByRole('article', { name: new RegExp(label) });
    await expect(item.getByText('Ready to apply')).toBeVisible();
  }
  // One process: the group only its approval names, the approval, the form.
  const group = page.getByRole('region', { name: new RegExp(`^E2E packaged request ${stamp}`) });
  await expect(group.getByRole('article')).toHaveCount(3);
  await expect(group.getByText(`Approval: E2E reviewers ${stamp}.`).first()).toBeVisible();
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

test('the ISMS process pack shows what it creates and installs as a change set grouped by process', async ({
  page,
}) => {
  test.setTimeout(240_000);
  // From Forms, where people building processes look.
  await page.goto('/admin/forms');
  await page.getByRole('link', { name: 'Install a process pack' }).click();
  await expect(page).toHaveURL(/\/assistant\/packs$/);
  await expect(
    page.getByRole('list', { name: 'Built-in process packs' }).or(page.getByText('No process packs')),
  ).toBeVisible();
  const pack = page.getByRole('article', { name: 'ISMS process pack' });
  test.skip(!(await pack.count()), 'the ISMS module is not enabled');
  await expect(
    pack.getByText(/^\d+ processes · 5 groups you fill in after installing · 3 ticket categories/),
  ).toBeVisible();
  await pack.getByRole('button', { name: 'What it creates' }).click();
  const contents = pack.getByRole('region', { name: 'What it creates' });
  await expect(contents.getByText('Firewall rule change request', { exact: true })).toBeVisible();
  await expect(
    contents.getByRole('heading', { name: 'Groups you fill in after installing (5)' }),
  ).toBeVisible();
  await expect(contents.getByText('ISMS approvers', { exact: true })).toBeVisible();
  await expectAccessible(page, 'process packs with contents');

  await pack.getByRole('button', { name: 'Review before installing' }).click();
  await expect(page).toHaveURL(/\/assistant\/change-sets\/[0-9a-f-]{36}$/, { timeout: 120_000 });
  await expect(page.getByRole('heading', { name: 'Changes by process' })).toBeVisible();
  await expect(page.getByText(/^\d+ processes · 5 groups · 3 ticket categories/)).toBeVisible();
  // Long change sets start collapsed, with an outline to jump around.
  const outline = page.getByRole('navigation', { name: 'Outline' });
  await expect(outline.getByRole('link', { name: /Firewall rule change request/ })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
  await outline.getByRole('link', { name: /Firewall rule change request/ }).click();
  const firewall = page.getByRole('region', { name: /^Firewall rule change request/ });
  await expect(firewall.getByRole('article')).toHaveCount(2);
  await expectAccessible(page, 'ISMS change set');
  const reference = ((await page.getByRole('heading', { level: 1 }).textContent()) ?? '').match(
    /CS-\d{5}/,
  )![0];

  // Leave the demo as it was.
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Discard' }).click();
  const discard = page.getByRole('alertdialog', { name: `Discard ${reference}?` });
  await discard.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(discard).toBeHidden();
  await expect(page.getByText('Discarded', { exact: true }).first()).toBeVisible();
});

test('process packs are accessible in dark mode and fit a phone', async ({ page }) => {
  await page.goto('/assistant/packs');
  await useScheme(page, 'dark');
  await expect(page.getByRole('heading', { name: 'Process packs', level: 1 })).toBeVisible();
  await expectAccessible(page, 'process packs (dark)');
  await page.getByRole('tab', { name: 'Import a file' }).click();
  await expect(page.getByLabel('Package file')).toBeVisible();
  await expectAccessible(page, 'import a file (dark)');
  await useScheme(page, 'light');

  await page.setViewportSize({ width: 375, height: 812 });
  await openPacks(page);
  await expect(page.getByRole('tab', { name: 'Import a file' })).toBeVisible();
  await settle(page);
  const { overflow, offenders } = await overflowing(page);
  expect(overflow, offenders.join('\n')).toBeLessThanOrEqual(1);
  await page.getByRole('tab', { name: 'Import a file' }).click();
  await expect(page.getByLabel('Package file')).toBeVisible();
  expect((await overflowing(page)).overflow).toBeLessThanOrEqual(1);
});
