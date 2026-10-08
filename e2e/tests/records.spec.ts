import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, expect, type Page, test } from './fixtures';
import { settle } from './helpers';

/** The core "Linked records" and "Attachments" panels, hosted on a CMDB CI page and an ITSM change. */

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

async function ciId(request: APIRequestContext, name: string) {
  const res = (await (await request.get(`/api/v1/cmdb/cis?q=${encodeURIComponent(name)}`)).json()) as {
    items: { id: string; name: string }[];
  };
  return res.items.find((c) => c.name === name)!.id;
}

test.describe.configure({ mode: 'serial' });

test('link a knowledge article to a CI and remove the link again', async ({ page, request }) => {
  await page.goto(`/cmdb/${await ciId(request, 'nas-01')}`);
  const panel = page.getByRole('region', { name: /Linked records/ });
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Link record' }).click();

  const dialog = page.getByRole('dialog', { name: 'Link a record' });
  await dialog.getByRole('combobox', { name: 'Record type' }).click();
  await page.getByRole('option', { name: 'Knowledge article' }).click();
  await dialog.getByRole('searchbox').fill('VPN');
  // Wait for the article results (the dialog first lists recent records of the type chosen before).
  const first = dialog.getByRole('button', { name: /^Link KB-\d+ .*VPN/ }).first();
  await expect(first).toBeVisible();
  const label = (await first.getAttribute('aria-label'))!.replace(/^Link /, '');
  await first.click();
  await expect(dialog.getByText('Linked').first()).toBeVisible();
  await page.keyboard.press('Escape');

  await expect(
    panel.getByRole('link', { name: new RegExp(label.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }),
  ).toBeVisible();
  await panel.getByRole('button', { name: `Remove link to ${label}` }).click();
  await expect(panel.getByRole('button', { name: `Remove link to ${label}` })).toHaveCount(0);
});

test('upload, preview and delete an attachment on a CI', async ({ page, request }) => {
  await page.goto(`/cmdb/${await ciId(request, 'nas-01')}`);
  const panel = page.getByRole('region', { name: /Attachments/ });
  await expect(panel).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await panel.getByRole('button', { name: 'Upload' }).click();
  await (
    await chooser
  ).setFiles({
    name: 'nas-01 rack photo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ),
  });
  await expect(panel.getByRole('link', { name: 'nas-01 rack photo.png', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Preview nas-01 rack photo.png' }).click();
  await expect(page.getByRole('dialog', { name: 'nas-01 rack photo.png' }).getByRole('img')).toBeVisible();
  await page.keyboard.press('Escape');

  // A blocked type is refused with an explanation.
  const chooser2 = page.waitForEvent('filechooser');
  await panel.getByRole('button', { name: 'Upload' }).click();
  await (
    await chooser2
  ).setFiles({ name: 'tool.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') });
  await expect(page.getByText(/tool\.exe: files of type \.exe can't be uploaded/)).toBeVisible();

  await panel.getByRole('button', { name: 'Delete nas-01 rack photo.png' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(panel.getByRole('link', { name: 'nas-01 rack photo.png', exact: true })).toHaveCount(0);
});

test('the seeded change shows its runbook attachment and the linked project task', async ({
  page,
  request,
}) => {
  const changes = (await (
    await request.get('/api/v1/itsm/tickets?type=change&view=all&q=Core%20switch%20firmware')
  ).json()) as { items: { reference: string }[] };
  await page.goto(`/itsm/tickets/${changes.items[0]!.reference}`);
  await expect(
    page.getByRole('region', { name: /Attachments/ }).getByText('core-switch-upgrade-runbook.md'),
  ).toBeVisible();
  const links = page.getByRole('region', { name: /Linked records/ });
  await expect(links.getByText('Replace core switch tpe-sw-core-01')).toBeVisible();
});

test('record panels have no accessibility violations (light and dark)', async ({ page, request }) => {
  test.setTimeout(120_000);
  const id = await ciId(request, 'tpe-sw-core-01');
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.goto(`/cmdb/${id}`);
    await page.evaluate((s) => localStorage.setItem('theme', s), scheme);
    await page.reload();
    await expect(page.getByRole('region', { name: /Linked records/ })).toBeVisible();
    await expect(page.getByRole('region', { name: /Attachments/ })).toBeVisible();
    await expectAccessible(page, `${scheme} CI with panels`);
    await page
      .getByRole('region', { name: /Linked records/ })
      .getByRole('button', { name: 'Link record' })
      .click();
    await expect(page.getByRole('dialog', { name: 'Link a record' })).toBeVisible();
    await expectAccessible(page, `${scheme} link dialog`);
    await page.keyboard.press('Escape');
  }
});
