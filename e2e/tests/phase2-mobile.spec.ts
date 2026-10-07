import { expect, type Page, test } from '@playwright/test';
import { overflowing, settle } from './helpers';

async function expectFits(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole('main')).toBeVisible();
  await settle(page);
  const { overflow, offenders } = await overflowing(page);
  expect(overflow, `${path}\n${offenders.join('\n')}`).toBeLessThanOrEqual(1);
}

test('Phase 2 pages fit a 375px screen', async ({ page, request }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 375, height: 812 });
  const tickets = (await (
    await request.get('/api/v1/itsm/tickets?pageSize=1&type=incident&view=all')
  ).json()) as {
    items: { reference: string }[];
  };
  const changes = (await (
    await request.get('/api/v1/itsm/tickets?pageSize=1&type=change&view=all')
  ).json()) as {
    items: { reference: string }[];
  };
  for (const path of [
    '/',
    '/requests',
    '/itsm',
    `/itsm/tickets/${tickets.items[0]!.reference}`,
    `/itsm/tickets/${changes.items[0]!.reference}`,
    '/itsm/report',
    '/itsm/problems',
    '/itsm/changes',
    '/itsm/reports',
    '/itsm/settings',
    '/itsm/settings?tab=sla',
    '/itsm/settings?tab=calendars',
    '/itsm/settings?tab=catalog',
    '/helpdesk-ai',
    '/helpdesk-ai/chat',
    '/admin/ai',
    '/admin/ai?tab=privacy',
    '/admin/ai?tab=usage',
    '/admin/ai?tab=index',
  ])
    await expectFits(page, path);
});
