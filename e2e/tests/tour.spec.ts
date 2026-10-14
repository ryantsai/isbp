import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from './fixtures';
import { overflowing, settle } from './helpers';

/**
 * The animated product tour (`/tour`, Traditional Chinese for now): its content is plain data, so these specs cover the
 * page's behaviour: every area is told, the pictures load, the stories play and pause, and it holds up for keyboards,
 * phones, dark mode and "reduce motion". Wording is the tour's own (zh-TW), whatever the signed-in language.
 */

const AREAS = 12;

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

test('the tour tells all twelve areas, each with real screenshots that load', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/tour');
  await expect(page.getByRole('heading', { level: 1, name: /一個平台/ })).toBeVisible();
  await expect(page).toHaveTitle(/產品導覽/);

  const chapters = page.locator('section.tour-area');
  await expect(chapters).toHaveCount(AREAS);
  for (let i = 0; i < AREAS; i++) {
    const chapter = chapters.nth(i);
    await chapter.scrollIntoViewIfNeeded();
    await expect(chapter.getByRole('heading', { level: 3 }).first()).toBeVisible();
    // The window shows the active step's screenshot (the others are in the page, hidden from assistive technology).
    const shown = chapter.locator('.tour-frame[data-active="true"] img');
    await expect(shown).toBeVisible();
    await expect
      .poll(() => shown.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
      .toBe(true);
  }

  // Every picture of the tour is a capture served from /help/<locale>/tour/ (no drawn imitations of the product).
  const sources = await page
    .locator('.tour img')
    .evaluateAll((imgs) => imgs.map((i) => i.getAttribute('src')));
  expect(sources.length).toBeGreaterThan(60);
  for (const src of sources) expect(src).toMatch(/^\/help\/(en|zh-TW|ja-JP)\/tour\/[a-z0-9-]+\.jpg$/);
});

test('the bar and the map take you to the chapters', async ({ page }) => {
  await page.goto('/tour');
  const nav = page.getByRole('navigation', { name: '產品導覽' });
  await nav.getByRole('link', { name: '架構' }).click();
  await expect(page).toHaveURL(/#architecture$/);
  await expect(page.locator('#architecture')).toBeInViewport();

  await page.locator('#overview').scrollIntoViewIfNeeded();
  await page
    .getByRole('link', { name: /^服務台：/ })
    .first()
    .click();
  await expect(page).toHaveURL(/#service-desk$/);
  await expect(page.locator('#service-desk')).toBeInViewport();
});

test('a chapter’s window follows its steps and can be stepped by hand', async ({ page }) => {
  await page.goto('/tour#portal');
  const chapter = page.locator('#portal');
  await expect(chapter.locator('.tour-window-bar')).toContainText('1 ／ 6');
  await chapter.getByRole('button', { name: '下一步' }).click();
  // "Next" scrolls the next step to the middle; the window shows its screenshot.
  await expect(chapter.locator('.tour-window-bar')).toContainText('2 ／ 6');
  await chapter.getByRole('button', { name: '放大檢視畫面' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('the request diagram and the stories play, pause and step', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/tour');
  const diagram = page.locator('.tour-seq-layout');
  await diagram.scrollIntoViewIfNeeded();
  // It starts by itself once on screen; pausing keeps the step it is on.
  await expect(diagram.getByRole('button', { name: '暫停' })).toBeVisible();
  await diagram.getByRole('button', { name: '暫停' }).click();
  await expect(diagram.locator('[aria-current="step"]')).toHaveCount(1);
  await diagram.getByRole('button', { name: '下一步' }).click();
  await expect(diagram.locator('[aria-current="step"]')).toContainText('2.');
  await diagram.locator('.tour-seq-steps').getByText('同一個交易寫入').click();
  await expect(diagram.locator('[aria-current="step"]')).toContainText('同一個交易寫入');

  // A story never starts on its own: pick one, press play.
  const journeys = page.locator('#journeys');
  await journeys.scrollIntoViewIfNeeded();
  await expect(journeys.getByRole('button', { name: '播放' })).toBeVisible();
  await expect(journeys.locator('.tour-window-bar')).toContainText('1 ／ 5');
  await journeys.getByRole('radio', { name: /VPN/ }).click();
  await expect(journeys.getByRole('heading', { level: 3, name: /VPN/ })).toBeVisible();
  await journeys.locator('.tour-journey-side').getByRole('button', { name: '下一步' }).click();
  await expect(journeys.locator('.tour-window-bar')).toContainText('2 ／ 4');
});

test('the tour has no accessibility violations (light and dark)', async ({ page }) => {
  test.setTimeout(240_000);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.goto('/tour');
    await page.evaluate((s) => localStorage.setItem('theme', s), scheme);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectAccessible(page, scheme);
  }
});

test('the tour fits a 375px screen', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/tour');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await settle(page);
  const { overflow, offenders } = await overflowing(page);
  expect(overflow, offenders.join('\n')).toBeLessThanOrEqual(1);
  // On a phone every step carries its own screenshot instead of the sticky window.
  await expect(page.locator('#portal .tour-stage')).toBeHidden();
  await expect(page.locator('#portal .tour-step-shot').first()).toBeVisible();
});

test('with “reduce motion” nothing hides, loops or plays by itself', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/tour');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.locator('#journeys').scrollIntoViewIfNeeded();
  await expect(page.locator('.tour-reveal[data-reveal="hidden"]')).toHaveCount(0);
  // The request diagram does not start by itself, and the masking demo shows all four lines.
  await page.locator('.tour-seq-layout').scrollIntoViewIfNeeded();
  await expect(page.locator('.tour-seq-layout').getByRole('button', { name: '播放' })).toBeVisible();
  await page.locator('.tour-mask').scrollIntoViewIfNeeded();
  await expect(page.locator('.tour-mask li[data-shown="false"]')).toHaveCount(0);
});
