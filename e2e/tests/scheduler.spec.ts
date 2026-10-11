import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, expect, type Page, test } from './fixtures';
import { overflowing, settle } from './helpers';

/**
 * Scheduled jobs against the seeded demo jobs ("Platform health check", "Partner feed import" with its
 * failure streak, the SQL jobs on the demo ERP and warehouse): the monitoring dashboard and its table twin,
 * creating a job and following its run live, cron validation, the run filters, and accessibility of every
 * page in light and dark mode and at 375px. Runs as the seeded admin.
 */

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

async function expectNoHorizontalScroll(page: Page) {
  const { overflow, offenders } = await overflowing(page);
  expect(overflow, `${page.url()} ${offenders.join(' | ')}`).toBeLessThanOrEqual(1);
}

interface Found {
  items: { id: string; name?: string; status?: string; job?: { id: string; name: string } }[];
}

async function first(request: APIRequestContext, path: string) {
  const res = await request.get(`/api/v1/scheduler${path}`);
  expect(res.ok(), path).toBeTruthy();
  const body = (await res.json()) as Found;
  expect(body.items.length, path).toBeGreaterThan(0);
  return body.items[0]!;
}

async function csrfOf(request: APIRequestContext) {
  return ((await (await request.get('/api/v1/auth/session')).json()) as { csrfToken: string }).csrfToken;
}

const healthCheck = (request: APIRequestContext) => first(request, '/jobs?q=Platform%20health%20check');
const partnerFeed = (request: APIRequestContext) => first(request, '/jobs?q=Partner%20feed%20import');
const failedRun = (request: APIRequestContext) => first(request, '/runs?view=failed&q=Partner%20feed');

test.describe.configure({ mode: 'serial' });

test('the dashboard leads with what is failing and why, then key figures and runs per hour', async ({
  page,
}) => {
  await page.goto('/scheduler');
  await expect(page.getByRole('heading', { name: 'Scheduled jobs', level: 1 })).toBeVisible();
  // Overview | Jobs | Runs are the area's sections.
  const sections = page.getByRole('navigation', { name: 'Scheduled jobs sections' });
  for (const s of ['Overview', 'Jobs', 'Runs'])
    await expect(sections.getByRole('link', { name: s })).toBeVisible();
  const kpis = page.getByRole('group', { name: 'Key figures' });
  for (const tile of ['Runs (24 h)', 'Success rate (24 h)', 'Running now'])
    await expect(kpis.getByText(tile, { exact: true })).toBeVisible();

  const chart = page.getByRole('region', { name: 'Runs per hour' });
  await expect(chart.getByRole('list', { name: 'Runs per hour' }).getByRole('listitem')).toHaveCount(24);
  await chart.getByRole('button', { name: 'Table', exact: true }).click();
  await expect(chart.getByRole('columnheader', { name: 'Hour' })).toBeVisible();
  await expect(chart.getByRole('columnheader', { name: 'Succeeded' })).toBeVisible();
  await chart.getByRole('button', { name: 'Chart', exact: true }).click();

  // The partner feed has been failing since this morning: why, in plain words, with what to do.
  const failing = page.getByRole('region', { name: 'Failing jobs' });
  await expect(failing.getByRole('link', { name: 'Partner feed import' })).toBeVisible();
  await expect(failing.getByText(/couldn't be reached|answered 502/).first()).toBeVisible();
  await expect(failing.getByRole('button', { name: 'Run Partner feed import now' })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Upcoming runs' }).getByRole('listitem').first(),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Slowest jobs' }).getByRole('listitem').first(),
  ).toBeVisible();
});

test('the jobs list filters by view; a failing job shows its streak and run history', async ({ page }) => {
  await page.goto('/scheduler/jobs');
  await expect(page.getByRole('heading', { name: 'Scheduled jobs', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Platform health check' })).toBeVisible();
  await page.getByRole('tab', { name: 'Failing' }).click();
  await expect(page).toHaveURL(/view=failing/);
  await expect(page.getByRole('link', { name: 'Partner feed import' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Platform health check' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Partner feed import' }).click();
  await expect(page.getByRole('heading', { name: 'Partner feed import', level: 1 })).toBeVisible();
  await expect(page.getByText(/failures in a row/).first()).toBeVisible();
  // Why it fails is on the job page itself, with the way to the run.
  await expect(page.getByRole('link', { name: 'See the last run' })).toBeVisible();
  await expect(page.getByText('Every hour at :05 (Asia/Taipei)')).toBeVisible();
  // Secret header values never reach the page.
  await expect(page.getByText('demo-partner-key')).toHaveCount(0);
  await page.getByRole('tab', { name: /Runs/ }).click();
  await expect(page).toHaveURL(/tab=runs/);
  await expect(
    page.getByRole('tabpanel').getByText('Failed').filter({ visible: true }).first(),
  ).toBeVisible();
});

test('creating a job, running it now and following the run live', async ({ page, request }) => {
  const types = (await (await request.get('/api/v1/scheduler/task-types')).json()) as {
    sandbox: { runner: string };
  };
  const name = `E2E job ${Date.now()}`;
  await page.goto('/scheduler/jobs/new');
  await expect(page.getByRole('heading', { name: 'New job', level: 1 })).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill(name);

  let expectedLine: string;
  if (types.sandbox.runner !== 'none') {
    // A Node.js script (the development runner runs it locally; other runners in a container).
    await page.getByRole('combobox', { name: 'Task type' }).click();
    await page.getByRole('option', { name: 'Script' }).click();
    await page.getByRole('combobox', { name: 'Language' }).click();
    await page.getByRole('option', { name: 'Node.js' }).click();
    await expect(page.getByRole('textbox', { name: 'Script', exact: true })).toContainText(
      'process.env.GREETING',
    );
    expectedLine = 'Hello from Node.js';
  } else {
    // No script runner: call the platform's own API through the web app.
    const url = new URL('/api/v1/auth/providers', page.url()).toString();
    await page.getByLabel('Request', { exact: true }).fill(url);
    await page.getByLabel('Expected status').fill('200');
    expectedLine = 'HTTP 200';
  }
  await page.getByText('Manual', { exact: true }).click();
  await expect(page.getByRole('radio', { name: /Manual/ })).toBeChecked();
  await expect(page.getByText(/Runs only when someone|only when someone presses Run now/)).toBeVisible();
  await page.getByRole('button', { name: 'Create job' }).click();

  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  await expect(page.getByText('Manual only')).toBeVisible();
  await page.getByRole('button', { name: 'Run now' }).click();

  await expect(page).toHaveURL(/\/scheduler\/runs\//);
  const log = page.getByRole('log', { name: 'Log' });
  await expect(log).toContainText(/Attempt 1 started/, { timeout: 30_000 });
  await expect(log).toContainText(expectedLine, { timeout: 30_000 });
  await expect(page.getByText('Succeeded', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('list', { name: 'Timeline' })).toContainText('Finished');
  await expect(page.getByRole('button', { name: 'Run again' })).toBeVisible();

  // Clean up.
  const job = await first(request, `/jobs?q=${encodeURIComponent(name)}`);
  const deleted = await request.delete(`/api/v1/scheduler/jobs/${job.id}`, {
    headers: { 'x-csrf-token': await csrfOf(request) },
  });
  expect(deleted.status()).toBe(204);
});

test('an invalid cron expression is explained before saving', async ({ page }) => {
  await page.goto('/scheduler/jobs/new');
  await page.getByLabel('Name', { exact: true }).fill('E2E invalid cron');
  await page.getByLabel('Request', { exact: true }).fill('https://example.com/');
  // The usual schedules are picked in words; a cron expression only under "Custom (cron)".
  await expect(page.getByRole('combobox', { name: 'Repeats' })).toHaveText(/Every day/);
  await page.getByRole('combobox', { name: 'Repeats' }).click();
  await page.getByRole('option', { name: 'Custom (cron)' }).click();
  const cron = page.getByLabel('Cron expression');
  await expect(cron).toHaveValue('0 7 * * *');
  await expect(page.getByRole('list', { name: 'Next runs' }).getByRole('listitem')).toHaveCount(5);
  await cron.fill('61 * * * *');
  // The live preview explains the problem before anything is saved.
  await expect(page.getByText(/expected range 0-59/).first()).toBeVisible();
  await expect(page.getByRole('list', { name: 'Next runs' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Create job' }).click();
  await expect(page.getByText('Check the highlighted fields').first()).toBeVisible();
  await expect(cron).toHaveAttribute('aria-invalid', 'true');
  await expect(page).toHaveURL(/\/scheduler\/jobs\/new/);
});

test('the runs list filters by view, status and job', async ({ page }) => {
  await page.goto('/scheduler/runs');
  await expect(page.getByRole('heading', { name: 'Scheduled jobs', level: 1 })).toBeVisible();
  await page.getByRole('tab', { name: 'Failed' }).click();
  await expect(page).toHaveURL(/view=failed/);
  const panel = page.getByRole('tabpanel');
  await expect(panel.getByText(/^(Failed|Timed out)$/).first()).toBeVisible();
  await expect(panel.getByText('Succeeded', { exact: true })).toHaveCount(0);

  await page.getByRole('tab', { name: 'All' }).click();
  await page.getByRole('combobox', { name: 'Status' }).click();
  await page.getByRole('option', { name: 'Succeeded', exact: true }).click();
  await expect(page).toHaveURL(/status=succeeded/);
  await page.getByPlaceholder('Search by job name…').fill('Platform health');
  await expect(page).toHaveURL(/q=Platform/);
  await expect(page.getByRole('link', { name: 'Platform health check' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Partner feed import' })).toHaveCount(0);
});

test('Scheduled jobs pages have no accessibility violations (light and dark)', async ({ page, request }) => {
  test.setTimeout(240_000);
  const health = await healthCheck(request);
  const feed = await partnerFeed(request);
  const run = await failedRun(request);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    for (const path of [
      '/scheduler',
      '/scheduler/jobs',
      '/scheduler/jobs?view=failing',
      '/scheduler/runs',
      '/scheduler/runs?view=failed',
      `/scheduler/jobs/${health.id}`,
      `/scheduler/jobs/${feed.id}?tab=runs`,
      `/scheduler/jobs/${feed.id}/edit`,
      '/scheduler/jobs/new',
      `/scheduler/runs/${run.id}`,
    ]) {
      await page.goto(path);
      await page.evaluate((s) => localStorage.setItem('theme', s), scheme);
      await page.reload();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectAccessible(page, `${scheme} ${path}`);
    }
    // The chart's table twin.
    await page.goto('/scheduler');
    await page
      .getByRole('region', { name: 'Runs per hour' })
      .getByRole('button', { name: 'Table', exact: true })
      .click();
    await expectAccessible(page, `${scheme} dashboard table`);
  }
});

test('Scheduled jobs pages fit a 375px screen', async ({ page, request }) => {
  const health = await healthCheck(request);
  const run = await failedRun(request);
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of [
    '/scheduler',
    '/scheduler/jobs',
    '/scheduler/runs',
    `/scheduler/jobs/${health.id}`,
    `/scheduler/jobs/${health.id}?tab=runs`,
    `/scheduler/jobs/${health.id}/edit`,
    '/scheduler/jobs/new',
    `/scheduler/runs/${run.id}`,
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await settle(page);
    await expectNoHorizontalScroll(page);
  }
});
