/**
 * `pnpm docs:screenshots [name-or-guide …]`: captures the user guide's screenshots (docs/guide/shots/<guide>.json) in
 * every language from the running demo stack and writes apps/web/public/help/<locale>/<name>.jpg. Run it against a
 * freshly seeded database (`pnpm db:reset`): the guides use the demo records' numbers.
 *
 *   E2E_BASE_URL=http://localhost:3000 pnpm docs:screenshots            # everything
 *   pnpm docs:screenshots service-desk readme-dashboard                  # one guide, one shot
 *
 * Each demo user is signed in through the API; their language and theme are switched for the run and restored after.
 */
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type APIRequestContext, type Browser, chromium, type Page, request } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const LOCALES = ['en', 'zh-TW', 'ja-JP'] as const;
type Locale = (typeof LOCALES)[number];

const DEMO_PASSWORD = process.env.E2E_DEMO_PASSWORD ?? 'Demo-2026!pass';
const USERS: Record<string, { username: string; password: string }> = {
  admin: {
    username: process.env.E2E_ADMIN_USER ?? 'admin',
    password: process.env.E2E_ADMIN_PASSWORD ?? 'ChangeMe-2026!',
  },
  helpdesk: { username: 'helpdesk', password: DEMO_PASSWORD },
  'hr.partner': { username: 'hr.partner', password: DEMO_PASSWORD },
  auditor: { username: 'auditor', password: DEMO_PASSWORD },
};

type Step =
  | { click: { role: Parameters<Page['getByRole']>[0]; name: Record<Locale, string> } | { css: string } }
  | { wait: number };

interface Shot {
  guide: string;
  name: string;
  as: string;
  path: string;
  waitFor?: string;
  steps?: Step[];
  clip?: string | null;
  theme?: 'light' | 'dark';
}

function loadShots(filters: string[]): Shot[] {
  const dir = join(ROOT, 'docs/guide/shots');
  const shots = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => {
      const guide = f.replace(/\.json$/, '');
      return (JSON.parse(readFileSync(join(dir, f), 'utf8')) as Omit<Shot, 'guide'>[]).map((s) => ({
        ...s,
        guide,
      }));
    });
  const wanted = filters.map((f) => f.toLowerCase());
  return wanted.length
    ? shots.filter((s) => wanted.includes(s.name) || wanted.includes(s.guide.toLowerCase()))
    : shots;
}

/** Like the e2e fixture: wait for hydration and for a lazily loaded module page to mount. */
async function ready(page: Page) {
  await page
    .waitForFunction(
      () =>
        document.documentElement.dataset.hydrated === '1' &&
        document.documentElement.dataset.modulePage !== 'loading',
      null,
      { timeout: 30_000 },
    )
    .catch(() => undefined);
}

/** Network quiet, fonts loaded, no skeletons left: what a person would see after a moment. */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await page
    .waitForFunction(() => !document.querySelector('[data-slot="skeleton"], [aria-busy="true"]'), null, {
      timeout: 10_000,
    })
    .catch(() => undefined);
  await page.waitForTimeout(300);
}

/** A heading is a scroll target: the step brings it to the top of the screen instead of clicking it. */
const scrollsToHeading = (step: Step) =>
  'click' in step && 'role' in step.click && step.click.role === 'heading';

async function runStep(page: Page, step: Step, locale: Locale) {
  if ('wait' in step) return page.waitForTimeout(step.wait);
  const target =
    'css' in step.click
      ? page.locator(step.click.css).first()
      : page.getByRole(step.click.role, { name: step.click.name[locale] ?? step.click.name.en }).first();
  if (scrollsToHeading(step)) {
    await target.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    return;
  }
  await target.click();
  await ready(page);
}

interface Session {
  api: APIRequestContext;
  csrf: string;
  original: { locale: string; preferences: Record<string, unknown> };
}

async function signIn(as: string): Promise<Session> {
  const credentials = USERS[as];
  if (!credentials) throw new Error(`Unknown demo user "${as}" (use admin, helpdesk, hr.partner or auditor)`);
  const api = await request.newContext({ baseURL: BASE_URL });
  const login = await api.post('/api/v1/auth/login', { data: credentials });
  if (!login.ok())
    throw new Error(`Sign-in as ${as} failed (${login.status()}): is the demo stack running and seeded?`);
  const { csrfToken } = (await login.json()) as { csrfToken: string };
  const me = (await (await api.get('/api/v1/me')).json()) as {
    locale: string;
    preferences: Record<string, unknown>;
  };
  return { api, csrf: csrfToken, original: { locale: me.locale, preferences: me.preferences } };
}

async function setPreferences(s: Session, locale: string, preferences: Record<string, unknown>) {
  const res = await s.api.patch('/api/v1/me', {
    data: { locale, preferences },
    headers: { 'x-csrf-token': s.csrf },
  });
  if (!res.ok()) throw new Error(`Could not switch the language to ${locale} (${res.status()})`);
}

async function capture(browser: Browser, s: Session, shot: Shot, locale: Locale) {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    storageState: await s.api.storageState(),
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale,
    timezoneId: 'Asia/Taipei',
    colorScheme: shot.theme ?? 'light',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  try {
    await page.goto(shot.path);
    await ready(page);
    await page
      .locator(shot.waitFor ?? 'main h1')
      .first()
      .waitFor({ timeout: 30_000 });
    await settle(page);
    const steps = shot.steps ?? [];
    for (const step of steps) await runStep(page, step, locale);
    // Clicking scrolls the target into view: show the page from its header again, unless the shot ends by
    // scrolling to a heading on purpose.
    if (steps.length && !scrollsToHeading(steps.at(-1)!))
      await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
    await settle(page);
    const file = join(ROOT, 'apps/web/public/help', locale, `${shot.name}.jpg`);
    const options = { path: file, type: 'jpeg' as const, quality: 80, animations: 'disabled' as const };
    if (shot.clip) await page.locator(shot.clip).first().screenshot(options);
    else await page.screenshot(options);
  } finally {
    await context.close();
  }
}

async function main() {
  const shots = loadShots(process.argv.slice(2));
  if (!shots.length) throw new Error('No screenshots match');
  for (const locale of LOCALES) mkdirSync(join(ROOT, 'apps/web/public/help', locale), { recursive: true });
  const browser = await chromium.launch();
  const failures: string[] = [];
  try {
    for (const as of [...new Set(shots.map((s) => s.as))]) {
      const session = await signIn(as);
      try {
        for (const locale of LOCALES) {
          for (const theme of [...new Set(shots.filter((s) => s.as === as).map((s) => s.theme ?? 'light'))]) {
            await setPreferences(session, locale, {
              ...session.original.preferences,
              theme,
              sidebarCollapsed: false,
            });
            for (const shot of shots.filter((s) => s.as === as && (s.theme ?? 'light') === theme)) {
              try {
                await capture(browser, session, shot, locale);
                console.log(`✓ ${locale}/${shot.name}`);
              } catch (e) {
                failures.push(`${locale}/${shot.name}: ${(e as Error).message.split('\n')[0]}`);
                console.error(`✗ ${locale}/${shot.name}`);
              }
            }
          }
        }
      } finally {
        await setPreferences(session, session.original.locale, session.original.preferences).catch(
          () => undefined,
        );
        await session.api.dispose();
      }
    }
  } finally {
    await browser.close();
  }
  if (failures.length) {
    console.error(`\n${failures.length} screenshot(s) failed:\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
}

await main();
