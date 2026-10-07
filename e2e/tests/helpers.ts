import type { Page } from '@playwright/test';

/**
 * Waits until entrance animations have finished, so accessibility scans measure final colours rather
 * than mid-fade opacity. Motion drives some animations from JS (inline `opacity`), others via WAAPI;
 * delayed animations start late, so the page must be quiet on two checks in a row.
 */
export async function settle(page: Page) {
  const quiet = () =>
    page.evaluate(() => {
      const cssDone = document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .every((a) => a.playState !== 'running');
      const jsDone = [...document.querySelectorAll<HTMLElement>('[style*="opacity"]')].every((el) => {
        const o = Number.parseFloat(getComputedStyle(el).opacity);
        return o === 1 || el.closest('[aria-hidden="true"]') !== null;
      });
      return cssDone && jsDone;
    });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await quiet()) {
      await page.waitForTimeout(500);
      if (await quiet()) return;
    }
    await page.waitForTimeout(150);
  }
}

/** Elements that stick out past the viewport without a scrolling/clipping ancestor (for the failure message). */
export async function overflowing(page: Page) {
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
