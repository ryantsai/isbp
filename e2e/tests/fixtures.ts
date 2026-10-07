import { test as base, type Page } from '@playwright/test';

export * from '@playwright/test';

/**
 * The app marks `<html data-hydrated="1">` once React has hydrated, and `data-module-page="loading"` until a
 * lazily loaded module page has mounted. Clicking earlier hits server-rendered markup without handlers (the
 * dev server is slow to hydrate), so every full page load waits for both.
 */
async function ready(page: Page) {
  await page
    .waitForFunction(
      () =>
        document.documentElement.dataset.hydrated === '1' &&
        document.documentElement.dataset.modulePage !== 'loading',
      null,
      { timeout: 30_000 },
    )
    .catch(() => undefined); // not an app page (e.g. a JSON response)
}

export const test = base.extend({
  page: async ({ page }, use) => {
    const goto = page.goto.bind(page);
    const reload = page.reload.bind(page);
    page.goto = (async (...args: Parameters<Page['goto']>) => {
      const response = await goto(...args);
      await ready(page);
      return response;
    }) as Page['goto'];
    page.reload = (async (...args: Parameters<Page['reload']>) => {
      const response = await reload(...args);
      await ready(page);
      return response;
    }) as Page['reload'];
    await use(page);
  },
});
