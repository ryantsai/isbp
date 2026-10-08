import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from './fixtures';
import { overflowing, settle } from './helpers';

/**
 * ITSM for ISMS-style processes against the seeded demo: the change "Upgrade Wi-Fi controller wlc-01 to 8.10" is in
 * its post-implementation review, waiting for its requester's acceptance. (Accepting, reporting a problem and the
 * resolution sign-off are covered by `apps/api/test/integration/itsm-isms.test.ts`.)
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

test.describe.configure({ mode: 'serial' });

test('a change in review shows the requester acceptance, accessible in light and dark and at 375px', async ({
  page,
  request,
}) => {
  const res = await request.get('/api/v1/itsm/tickets?type=change&status=review&q=wlc-01');
  expect(res.ok()).toBeTruthy();
  const change = ((await res.json()) as { items: { reference: string }[] }).items[0]!;
  await page.goto(`/itsm/tickets/${change.reference}`);
  const panel = page.getByRole('region', { name: /Requester acceptance/ });
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Waiting for acceptance')).toBeVisible();

  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.evaluate((s) => localStorage.setItem('theme', s), scheme);
    await page.reload();
    await expect(panel).toBeVisible();
    await expectAccessible(page, `${scheme} change in review`);
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await settle(page);
  const { overflow, offenders } = await overflowing(page);
  expect(overflow, offenders.join(' | ')).toBeLessThanOrEqual(1);
});
