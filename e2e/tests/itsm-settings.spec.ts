import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, expect, type Page, test } from './fixtures';
import { overflowing, settle } from './helpers';

/** Saving and loading wait longer than the default: the dev server compiles these pages on first use. */
const slow = { timeout: 60_000 };

/** Service desk settings: categories with their own SLA, SLA policy order, compact targets, a11y and phones. */

interface Policy {
  id: string;
  name: Record<string, string>;
  targets: Record<string, { responseMinutes: number; resolutionMinutes: number }>;
  calendar: { id: string };
  reach: { blocked: { type: string; by: string | null }[] } | null;
}

async function csrf(request: APIRequestContext) {
  return {
    'x-csrf-token': ((await (await request.get('/api/v1/auth/session')).json()) as { csrfToken: string })
      .csrfToken,
  };
}

async function policies(request: APIRequestContext) {
  return ((await (await request.get('/api/v1/itsm/sla-policies')).json()) as { items: Policy[] }).items;
}

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

test('a new category gets its own SLA targets in the same form, checked before the general policy', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const name = `E2E meeting rooms ${Date.now() % 1_000_000}`;
  await page.goto('/itsm/settings');
  await page.getByRole('button', { name: 'New category' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Name').fill(name);
  await sheet.getByLabel('Parent').click();
  await page.getByRole('option', { name: 'Hardware', exact: true }).click();
  await sheet.getByLabel('Default group').click();
  await expect(page.getByRole('group', { name: 'Service desk groups' })).toBeVisible();
  await page.getByRole('option', { name: 'Service Desk' }).click();
  await sheet.getByRole('radio', { name: /Set targets for this category/ }).check();
  await expect(sheet.getByText('Copied from “Incidents”')).toBeVisible();
  await expect(sheet.getByText(/Checked before “Incidents”/)).toBeVisible();
  await sheet.getByLabel('P1 · Critical: First response').fill('15m');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toBeHidden(slow);
  const row = page.getByRole('listitem').filter({ hasText: name });
  await expect(row).toContainText(`SLA: ${name}`);
  await expect(row).not.toContainText('e2e-meeting-rooms'); // the key stays under "Advanced"

  const list = await policies(request);
  const own = list.find((p) => p.name.en === name)!;
  const incidents = list.findIndex((p) => p.name.en === 'Incidents');
  expect(list.indexOf(own)).toBeLessThan(incidents);
  expect(own.targets['1']!.responseMinutes).toBe(15);
  expect(own.reach).toEqual({ blocked: [] });

  const headers = await csrf(request);
  expect((await request.delete(`/api/v1/itsm/sla-policies/${own.id}`, { headers })).ok()).toBeTruthy();
  const cats = (await (await request.get('/api/v1/itsm/categories?includeInactive=true')).json()) as {
    items: { id: string; name: Record<string, string> }[];
  };
  const cat = cats.items.find((c) => c.name.en === name)!;
  expect((await request.delete(`/api/v1/itsm/categories/${cat.id}`, { headers })).ok()).toBeTruthy();
});

test('a policy that never applies is flagged, and "Check it first" moves it before the one that takes its tickets', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const headers = await csrf(request);
  const incidents = (await policies(request)).find((p) => p.name.en === 'Incidents')!;
  const name = `E2E network incidents ${Date.now() % 1_000_000}`;
  const created = (await (
    await request.post('/api/v1/itsm/sla-policies', {
      headers,
      data: {
        name,
        ticketTypes: ['incident'],
        condition: { fact: 'ticket.categoryKeys', op: 'eq', value: 'network' },
        targets: incidents.targets,
        calendarId: incidents.calendar.id,
        pauseStatuses: ['on_hold'],
        warnAt: 0.75,
        active: true,
        sortOrder: 9_000,
      },
    })
  ).json()) as Policy;
  try {
    expect(created.reach?.blocked).toEqual([{ type: 'incident', by: incidents.id }]);
    await page.goto('/itsm/settings?tab=sla');
    const card = page.getByRole('article', { name });
    await expect(card).toContainText(
      /This policy will never apply: “Incidents” \(#\d\) matches these tickets first\./,
    );
    await card.getByRole('button', { name: 'Check it first' }).click();
    await expect(card.getByText(/will never apply/)).toBeHidden();
    const order = (await policies(request)).map((p) => p.id);
    expect(order.indexOf(created.id)).toBe(order.indexOf(incidents.id) - 1);

    // Move it back down with the keyboard: the focus stays on the moved policy's buttons.
    await card.getByRole('button', { name: `Move ${name} down` }).focus();
    await page.keyboard.press('Enter');
    await expect(card).toContainText('will never apply');
    await expect(page.locator(':focus')).toHaveAccessibleName(new RegExp(`Move ${name} (down|up)`));
  } finally {
    await request.delete(`/api/v1/itsm/sla-policies/${created.id}`, { headers });
  }
});

test('SLA targets are typed as compact durations and checked', async ({ page }) => {
  await page.goto('/itsm/settings?tab=sla&create=1');
  const sheet = page.getByRole('dialog', { name: 'New SLA policy' });
  await expect(sheet.getByText('Copied from “Incidents”')).toBeVisible(slow);
  await expect(sheet.getByLabel('P1 · Critical: First response')).toHaveValue('30m');
  await sheet.getByLabel('Same for all priorities').check();
  await expect(sheet.getByLabel('All priorities: First response')).toBeVisible();
  await sheet.getByLabel('All priorities: First response').fill('abc');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(
    sheet.getByText('Enter each target in hours and minutes, e.g. 4h, 30m or 1h 30m.'),
  ).toBeVisible();
  await expect(sheet.getByLabel('All priorities: First response')).toHaveAttribute('aria-invalid', 'true');
});

test('service desk settings have no accessibility violations and fit a phone', async ({ page }) => {
  test.setTimeout(600_000);
  const pages: [string, (p: Page) => Promise<void>][] = [
    ['/itsm/settings', (p) => expect(p.getByRole('heading', { name: 'Categories' })).toBeVisible(slow)],
    [
      '/itsm/settings?create=1',
      async (p) => {
        await p.getByRole('radio', { name: /Set targets for this category/ }).check(slow);
        await expect(p.getByText('Same for all priorities')).toBeVisible();
      },
    ],
    [
      '/itsm/settings?tab=sla',
      (p) => expect(p.getByRole('heading', { name: 'SLA policies' })).toBeVisible(slow),
    ],
    ['/itsm/settings?tab=sla&create=1', (p) => expect(p.getByRole('dialog')).toBeVisible(slow)],
    [
      '/itsm/settings?tab=calendars',
      (p) => expect(p.getByRole('heading', { name: 'Business calendars' })).toBeVisible(slow),
    ],
    [
      '/itsm/settings?tab=catalog',
      (p) => expect(p.getByRole('heading', { name: 'Service catalog' })).toBeVisible(slow),
    ],
  ];
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    for (const [path, ready] of pages) {
      await page.goto(path);
      await page.evaluate((s) => localStorage.setItem('theme', s), scheme);
      await page.reload();
      await ready(page);
      await expectAccessible(page, `${scheme} ${path}`);
    }
  }
  await page.setViewportSize({ width: 375, height: 812 });
  for (const [path, ready] of pages) {
    await page.goto(path);
    await ready(page);
    await settle(page);
    const { overflow, offenders } = await overflowing(page);
    expect(overflow, `${path}: ${offenders.join('; ')}`).toBeLessThanOrEqual(0);
  }
});
