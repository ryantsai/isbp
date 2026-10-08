import { defineConfig, devices } from '@playwright/test';

/**
 * Runs against an already-running stack (API + web) seeded with `pnpm db:seed`.
 *   E2E_BASE_URL=http://localhost:3000 pnpm e2e
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  globalSetup: './global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    storageState: '.auth/admin.json',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-US',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /assistant-agent\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    // Switches the platform's AI model to the scripted stand-in (a global setting): runs alone, after the rest.
    {
      name: 'chat-model',
      testMatch: /assistant-agent\.spec\.ts/,
      dependencies: ['chromium'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
});
