import { expect, type Page, test } from './fixtures';
import { overflowing, settle } from './helpers';

/**
 * Every Phase 3 page — and every tab on it — fits the window on a laptop (1280px) and a phone (375px):
 * wide tables, boards and timelines scroll inside their own container, never the page.
 */
const SIZES = [
  { width: 1280, height: 800 },
  { width: 375, height: 812 },
] as const;

async function expectFits(page: Page, label: string) {
  await settle(page);
  const { overflow, offenders } = await overflowing(page);
  expect(overflow, `${label}\n${offenders.join('\n')}`).toBeLessThanOrEqual(1);
}

async function visit(page: Page, path: string, size: string) {
  await page.goto(path);
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expectFits(page, `${size} ${path}`);
  const tabs = page.getByRole('main').getByRole('tablist').first().getByRole('tab');
  const count = (await page.getByRole('main').getByRole('tablist').count()) ? await tabs.count() : 0;
  for (let i = 1; i < count; i++) {
    const tab = tabs.nth(i);
    const name = (await tab.textContent())?.trim();
    await tab.click();
    await expectFits(page, `${size} ${path} [${name}]`);
  }
}

test('Phase 3 pages and their tabs fit a laptop and a phone screen', async ({ page, request }) => {
  test.setTimeout(600_000);
  const get = async <T>(url: string) => (await (await request.get(url)).json()) as T;
  const license = await get<{ items: { reference: string }[] }>('/api/v1/itam/licenses?pageSize=1');
  const contract = await get<{ items: { reference: string }[] }>('/api/v1/itam/contracts?pageSize=1');
  const paths = [
    '/itam',
    '/itam/hardware',
    '/itam/hardware/AST-00001',
    '/itam/software',
    `/itam/software/${license.items[0]!.reference}`,
    '/itam/contracts',
    `/itam/contracts/${contract.items[0]!.reference}`,
    '/itam/vendors',
    '/itam/mine',
    '/itam/settings',
    '/projects',
    '/projects/my-tasks',
    '/projects/NET',
    '/projects/tasks/NET-1',
    '/alm',
    '/alm/releases',
    '/alm/erp',
    '/alm/erp/releases/12.1.0',
  ];
  for (const size of SIZES) {
    await page.setViewportSize(size);
    for (const path of paths) await visit(page, path, `${size.width}px`);
  }
});
