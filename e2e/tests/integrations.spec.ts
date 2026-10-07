import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, expect, type Page, test } from './fixtures';
import { overflowing, settle } from './helpers';

/**
 * The Integrations Hub against the seeded demo connections, which talk to the stand-in ServiceDesk Plus and
 * Azure DevOps Server (`tooling/integration-mocks`, `INTEGRATION_MOCKS_URL`): the overview, a connection's
 * tabs, the profile editor and a dry run, resolving the seeded conflict, a change made in ServiceDesk Plus
 * arriving through its webhook, a change made in ISBP pushed back, Git status on an application, the
 * insecure-HTTP guard, and accessibility (light, dark, 375 px). Runs as the seeded admin.
 */

const MOCKS = process.env.INTEGRATION_MOCKS_URL ?? 'http://localhost:4100';
const SDP = 'Contoso ServiceDesk Plus';
const ADO = 'Contoso Azure DevOps Server';

async function expectAccessible(page: Page, label?: string) {
  await settle(page);
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    label,
  ).toEqual([]);
}

interface Connection {
  id: string;
  name: string;
}
interface Profile {
  id: string;
  name: string;
}
interface LinkItem {
  id: string;
  remoteId: string;
  local: { id: string; reference: string | null; title: string } | null;
  state: string;
}

async function get<T>(request: APIRequestContext, path: string): Promise<T> {
  const res = await request.get(`/api/v1${path}`);
  expect(res.ok(), path).toBeTruthy();
  return (await res.json()) as T;
}

async function csrfOf(request: APIRequestContext) {
  return ((await (await request.get('/api/v1/auth/session')).json()) as { csrfToken: string }).csrfToken;
}

async function connection(request: APIRequestContext, name: string) {
  const { items } = await get<{ items: Connection[] }>(request, '/integrations/connections');
  const c = items.find((x) => x.name === name);
  expect(c, `seeded connection ${name} (is INTEGRATION_MOCKS_URL reachable at seed time?)`).toBeTruthy();
  return c!;
}

async function profile(request: APIRequestContext, connectionId: string, prefix: string) {
  const { items } = await get<{ items: Profile[] }>(
    request,
    `/integrations/profiles?connectionId=${connectionId}`,
  );
  const p = items.find((x) => x.name.startsWith(prefix));
  expect(p, prefix).toBeTruthy();
  return p!;
}

/** A linked, in-sync ticket of the requests profile (not the one with the seeded conflict). */
async function linkedTicket(request: APIRequestContext, profileId: string) {
  const { items } = await get<{ items: LinkItem[] }>(
    request,
    `/integrations/links?profileId=${profileId}&state=ok&pageSize=50`,
  );
  const link = items.find((l) => l.local?.reference?.startsWith('INC-'));
  expect(link).toBeTruthy();
  return link!;
}

test.describe.configure({ mode: 'serial' });

test('the overview shows both demo connections, working, with their figures', async ({ page }) => {
  await page.goto('/integrations');
  await expect(page.getByRole('heading', { name: 'Integrations', level: 1 })).toBeVisible();
  for (const name of [SDP, ADO]) await expect(page.getByRole('link', { name })).toBeVisible();
  await expect(page.getByText('Working', { exact: true })).toHaveCount(2);
});

test('a connection page shows its profiles, runs, linked records and conflicts', async ({
  page,
  request,
}) => {
  const sdp = await connection(request, SDP);
  await page.goto(`/integrations/connections/${sdp.id}`);
  await expect(page.getByRole('heading', { name: SDP, level: 1 })).toBeVisible();
  await expect(page.getByText('Webhook', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Sync profiles' }).click();
  await expect(page).toHaveURL(/tab=profiles/);
  await expect(page.getByText('Requests ↔ tickets')).toBeVisible();
  await expect(page.getByText('Assets ↔ assets')).toBeVisible();

  await page.getByRole('tab', { name: 'Runs' }).click();
  await expect(page.getByRole('tabpanel').getByText('Succeeded').first()).toBeVisible();

  await page.getByRole('tab', { name: 'Linked records' }).click();
  await expect(page.getByRole('tabpanel').getByText('In sync').first()).toBeVisible();
  // The disposal guardrail: ServiceDesk Plus says disposed, ISBP's approval decides.
  await page.getByRole('tab', { name: 'Error', exact: true }).click();
  await expect(page.getByText(/disposal approval/).first()).toBeVisible();
});

test('the profile editor shows a saved profile and previews the next changes', async ({ page, request }) => {
  const sdp = await connection(request, SDP);
  const requests = await profile(request, sdp.id, 'Requests');
  await page.goto(`/integrations/connections/${sdp.id}/profiles/${requests.id}`);
  await expect(page.getByRole('heading', { name: 'Requests ↔ tickets', level: 1 })).toBeVisible();
  // What ↔ what is fixed once saved, and shown.
  await expect(page.getByRole('combobox', { name: 'In Contoso ServiceDesk Plus', exact: true })).toHaveText(
    /Requests/,
  );
  await expect(page.getByRole('combobox', { name: 'In ISBP', exact: true })).toHaveText(/Tickets/);
  await expect(page.getByRole('radio', { name: /Both ways/ })).toBeChecked();
  await expect(page.getByText('Field mapping')).toBeVisible();
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(
    page.getByText(/No changes in Contoso ServiceDesk Plus since the last sync|The next/),
  ).toBeVisible({
    timeout: 30_000,
  });
});

test('resolving the seeded conflict keeps the value chosen per field', async ({ page, request }) => {
  const sdp = await connection(request, SDP);
  await page.goto(`/integrations/connections/${sdp.id}?tab=conflicts`);
  const row = page.getByRole('row').filter({ hasText: 'INC-' }).first();
  await expect(row).toBeVisible();
  const ref = (await row.getByText(/^INC-\d{5}$/).textContent())!.trim();
  await row.getByRole('button', { name: /^Resolve the conflict of #\d+/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Resolve sync conflict' });
  await expect(dialog).toBeVisible();
  await expectAccessible(page, 'resolve dialog');
  await dialog.getByRole('radio', { name: /Keep the value from Contoso ServiceDesk Plus/ }).check();
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Conflict resolved').first()).toBeVisible();
  await expect(dialog).toBeHidden();

  await page.goto(`/itsm/tickets/${ref}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Escalated: VPN drops');
  const panel = page.getByRole('region', { name: 'Synced with' });
  await expect(panel.getByText(SDP)).toBeVisible();
  await expect(panel.getByText('In sync')).toBeVisible();
});

test('a change in ServiceDesk Plus arrives through its webhook; a change in ISBP is pushed back', async ({
  page,
  request,
}) => {
  const sdp = await connection(request, SDP);
  const requests = await profile(request, sdp.id, 'Requests');
  const link = await linkedTicket(request, requests.id);
  const ref = link.local!.reference!;

  // Someone renames the request in ServiceDesk Plus; its webhook makes the hub re-read it.
  const remoteTitle = `Renamed in ServiceDesk Plus ${Date.now()}`;
  const edited = await request.post(`${MOCKS}/_mock/sdp/requests/${link.remoteId}`, {
    data: { subject: remoteTitle },
  });
  expect(edited.ok()).toBeTruthy();
  await expect(async () => {
    const t = await get<{ title: string }>(request, `/itsm/tickets/${ref}`);
    expect(t.title).toBe(remoteTitle);
  }).toPass({ timeout: 30_000 });

  // An agent renames it in ISBP; the worker pushes it to ServiceDesk Plus.
  const localTitle = `Renamed in ISBP ${Date.now()}`;
  const patched = await request.patch(`/api/v1/itsm/tickets/${ref}`, {
    data: { title: localTitle },
    headers: { 'x-csrf-token': await csrfOf(request) },
  });
  expect(patched.ok(), await patched.text()).toBeTruthy();
  await expect(async () => {
    const r = await request.get(`${MOCKS}/_mock/sdp/requests/${link.remoteId}`);
    expect(((await r.json()) as { subject: string }).subject).toBe(localTitle);
  }).toPass({ timeout: 30_000 });

  await page.goto(`/itsm/tickets/${ref}`);
  const panel = page.getByRole('region', { name: 'Synced with' });
  await expect(panel.getByRole('link', { name: /#\d+/ })).toBeVisible();
  await expect(panel.getByRole('button', { name: /Sync now/ })).toBeVisible();
});

test('repositories from Azure DevOps Server show Git status on the application', async ({ page }) => {
  await page.goto('/alm');
  await page.getByRole('link', { name: 'Finance ERP' }).first().click();
  await expect(page.getByRole('heading', { name: 'Finance ERP', level: 1 })).toBeVisible();
  await expect(page.getByText('erp-core').first()).toBeVisible();
  await expect(page.getByText(/active pull requests?/).first()).toBeVisible();
  await expect(page.getByText(/^Synced/).first()).toBeVisible();
});

test('a plain-HTTP server needs the explicit "Allow insecure HTTP" switch', async ({ page }) => {
  await page.goto('/integrations');
  await page.getByRole('button', { name: 'Add connection' }).click();
  await page.getByRole('button', { name: /Azure DevOps Server \(on-premises\)/ }).click();
  const sheet = page.getByRole('dialog', { name: /Azure DevOps Server/ });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel('Connection name').fill('E2E plain HTTP');
  await sheet.getByLabel('Collection URL').fill('http://ado.contoso.example/tfs/DefaultCollection');
  await sheet.getByLabel('Personal access token').fill('e2e-not-a-real-token');
  await expectAccessible(page, 'add connection sheet');
  await sheet.getByRole('button', { name: 'Test connection' }).click();
  // INSECURE_HTTP, translated, with the hint to the switch.
  await expect(sheet.getByText(/uses plain HTTP/)).toBeVisible({ timeout: 30_000 });
  await expect(sheet.getByRole('switch', { name: 'Allow insecure HTTP' })).not.toBeChecked();
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(sheet).toBeHidden();
});

test('Integrations pages have no accessibility violations (light and dark)', async ({ page, request }) => {
  test.setTimeout(240_000);
  const sdp = await connection(request, SDP);
  const ado = await connection(request, ADO);
  const requests = await profile(request, sdp.id, 'Requests');
  const { items: runs } = await get<{ items: { id: string }[] }>(
    request,
    `/integrations/runs?connectionId=${ado.id}&pageSize=1`,
  );
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    for (const path of [
      '/integrations',
      `/integrations/connections/${sdp.id}`,
      `/integrations/connections/${sdp.id}?tab=profiles`,
      `/integrations/connections/${sdp.id}?tab=runs`,
      `/integrations/connections/${sdp.id}?tab=links`,
      `/integrations/connections/${sdp.id}?tab=conflicts`,
      `/integrations/connections/${ado.id}?tab=profiles`,
      `/integrations/connections/${sdp.id}/profiles/${requests.id}`,
      `/integrations/runs/${runs[0]!.id}`,
      '/integrations/conflicts',
    ]) {
      await page.goto(path);
      await page.evaluate((s) => localStorage.setItem('theme', s), scheme);
      await page.reload();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectAccessible(page, `${scheme} ${path}`);
    }
  }
});

test('Integrations pages fit a 375px screen', async ({ page, request }) => {
  const sdp = await connection(request, SDP);
  const requests = await profile(request, sdp.id, 'Requests');
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of [
    '/integrations',
    `/integrations/connections/${sdp.id}`,
    `/integrations/connections/${sdp.id}?tab=links`,
    `/integrations/connections/${sdp.id}/profiles/${requests.id}`,
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await settle(page);
    const { overflow, offenders } = await overflowing(page);
    expect(overflow, `${path} ${offenders.join(' | ')}`).toBeLessThanOrEqual(1);
  }
});
