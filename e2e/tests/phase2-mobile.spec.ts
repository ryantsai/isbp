import { expect, type Page, test } from '@playwright/test';
import { settle } from './helpers';

/** Elements that stick out past the viewport without a scrolling/clipping ancestor (for the failure message). */
async function overflowing(page: Page) {
  return page.evaluate(() => {
    const width = window.innerWidth;
    const offenders: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= width + 1) continue;
      let p = el.parentElement;
      let clipped = false;
      while (p) {
        if (['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(p).overflowX)) {
          clipped = true;
          break;
        }
        p = p.parentElement;
      }
      if (!clipped)
        offenders.push(
          `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} → ${Math.round(r.right)}px`,
        );
    }
    return { overflow: document.documentElement.scrollWidth - width, offenders: offenders.slice(0, 5) };
  });
}

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
