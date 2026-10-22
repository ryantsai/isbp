import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from './fixtures';
import { settle } from './helpers';

async function expectAccessible(page: Page) {
  await settle(page);
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe.configure({ mode: 'serial' });

test('knowledge home: instant search with highlighted matches, keyboard navigation, categories', async ({
  page,
}) => {
  await page.goto('/knowledge');
  await expect(page.getByRole('heading', { name: 'Knowledge base', level: 1 })).toBeVisible();
  // Writers reach Manage and Categories through the section tabs (no duplicate header buttons or links).
  const sections = page.getByRole('navigation', { name: 'Knowledge base sections' });
  await expect(sections.getByRole('link', { name: 'Browse' })).toHaveAttribute(
    'aria-current',
    /^(page|true)$/,
  );
  await expect(sections.getByRole('link', { name: 'Manage' })).toBeVisible();
  await expect(sections.getByRole('link', { name: 'Categories' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Manage articles' })).toHaveCount(0);
  // An English reader sees no "EN" chip on English articles.
  await expect(page.getByRole('region', { name: 'Popular' }).getByText('EN', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Browse by topic' })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Browse by topic' }).getByRole('link', { name: /Network & VPN/ }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Popular' })).toBeVisible();
  await expectAccessible(page);

  const search = page.getByRole('searchbox', { name: 'How can we help?' });
  await search.fill('vpn keeps dropping');
  const results = page.getByRole('list', { name: 'Search results' });
  await expect(results.getByRole('link', { name: /VPN disconnects every few minutes/ })).toBeVisible();
  await expect(results.locator('mark').first()).toBeVisible();
  await expect(page).toHaveURL(/q=vpn/);
  await expectAccessible(page);

  // ↓ moves into the results; Enter opens the article.
  await search.press('ArrowDown');
  await expect(results.getByRole('link').first()).toBeFocused();

  await search.fill('');
  await page
    .getByRole('region', { name: 'Browse by topic' })
    .getByRole('link', { name: /Network & VPN/ })
    .click();
  await expect(page).toHaveURL(/category=network-vpn/);
  await expect(page.getByRole('heading', { name: 'Network & VPN', level: 2 })).toBeVisible();
});

test('article page: Markdown, translations, related articles and feedback', async ({ page }) => {
  await page.goto('/knowledge?q=reset%20password');
  await page
    .getByRole('link', { name: /Reset your password/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { level: 1, name: /Reset your password/ })).toBeVisible();
  await expect(page.getByRole('table')).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Other languages' }).getByRole('link', { name: '繁體中文' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Related articles' })).toBeVisible();

  // "No" asks what was missing and offers the ways on.
  await page.getByRole('button', { name: 'No', exact: true }).click();
  const stuck = page.getByRole('navigation', { name: 'Still stuck?' });
  await expect(stuck.getByRole('link', { name: 'Ask IS' })).toHaveAttribute('href', '/helpdesk-ai/chat');
  await expect(stuck.getByRole('link', { name: 'Report an issue' })).toHaveAttribute('href', '/itsm/report');
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Yes' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'glad it helped' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Yes' })).toHaveAttribute('aria-pressed', 'true');
  await expect(stuck).toBeHidden();
  await expectAccessible(page);

  await page
    .getByRole('navigation', { name: 'Other languages' })
    .getByRole('link', { name: '繁體中文' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: /重設密碼/ })).toBeVisible();
});

test('manage articles: tabs filter the table and the editor previews Markdown', async ({ page }) => {
  await page.goto('/knowledge/manage');
  await expect(page.getByRole('heading', { name: 'Manage articles', level: 1 })).toBeVisible();
  // An editor lands on the review queue when it has articles; every tab shows its count.
  await expect(page.getByRole('tab', { name: /In review/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: /My drafts \d+/ })).toBeVisible();
  await page.getByRole('tab', { name: 'Review due' }).click();
  await expect(page).toHaveURL(/tab=due/);
  await expect(page.getByRole('cell', { name: /Clear a stuck print queue/ })).toBeVisible();
  await page.getByRole('tab', { name: 'In review' }).click();
  await expect(page.getByRole('cell', { name: /Microsoft Teams/ })).toBeVisible();
  await expectAccessible(page);

  await page.getByRole('link', { name: 'New article' }).first().click();
  await expect(page.getByRole('heading', { name: 'New article', level: 1 })).toBeVisible();
  // Rare settings wait under "More settings"; its summary names the language (the author's by default).
  const more = page.getByRole('button', { name: /More settings/ });
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await expect(more).toContainText('English');
  // Collapsed content is hidden from assistive technology (role queries skip it).
  await expect(page.getByRole('combobox', { name: 'Classification' })).toHaveCount(0);
  // The main button says what happens: this editor's submission goes live.
  await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();
  await expect(page.getByText('It goes live for its audience right away.')).toBeVisible();
  await expect(page.getByText('You can add attachments after saving.')).toBeVisible();

  await page.getByLabel('Title').fill('E2E: badge reader not working');
  const body = page.getByRole('textbox', { name: 'Article' });
  await body.fill('## Steps\n\n1. Tap the badge again.\n2. Ask reception.');
  // The formatting toolbar inserts Markdown at the selection.
  await body.press('End');
  await body.press('Enter');
  await page.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: 'Bold' }).click();
  await expect(body).toHaveValue(/\*\*bold text\*\*$/);
  await page.keyboard.type('Never share your badge');
  await expect(body).toHaveValue(/\*\*Never share your badge\*\*$/);
  await page.getByRole('tab', { name: 'Preview' }).click();
  await expect(page.getByRole('heading', { name: 'Steps', level: 2 })).toBeVisible();
  await expect(page.locator('strong', { hasText: 'Never share your badge' })).toBeVisible();
  await more.click();
  await expect(page.getByRole('combobox', { name: 'Classification' })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'E2E: badge reader not working' })).toBeVisible();
  await expect(page.getByText('This is a draft.')).toBeVisible();
  // The next step is the primary action; Delete sits in "More actions" and names the article.
  await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('E2E: badge reader not working');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL(/\/knowledge\/manage/);
});

test("categories: full-width list, Edit and Delete in each row's menu, the form in a sheet", async ({
  page,
}) => {
  await page.goto('/knowledge/categories');
  await expect(page.getByRole('heading', { name: 'Knowledge categories', level: 1 })).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'Knowledge base sections' })
      .getByRole('link', { name: 'Categories' }),
  ).toHaveAttribute('aria-current', /^(page|true)$/);
  await page.getByRole('button', { name: 'Actions for Network & VPN' }).click();
  await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await expect(page).toHaveURL(/edit=/);
  const sheet = page.getByRole('dialog', { name: 'Edit category' });
  await expect(sheet).toBeVisible();
  await expectAccessible(page);
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(sheet).toBeHidden();
  await expect(page).not.toHaveURL(/edit=/);
});

test('knowledge pages fit a 375px screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of ['/knowledge', '/knowledge/manage', '/knowledge/new', '/knowledge/categories']) {
    await page.goto(path);
    await settle(page);
    await expectNoHorizontalScroll(page);
  }
  await page.goto('/knowledge?q=vpn');
  await page.getByRole('list', { name: 'Search results' }).getByRole('link').first().click();
  await settle(page);
  await expectNoHorizontalScroll(page);
});

test('in-app help: the user menu opens the user guide, with screenshots and links between guides', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('banner').getByRole('button').last().click();
  await page.getByRole('menuitem', { name: 'Help' }).click();
  // /knowledge/guide/start-here resolves to the guide's article in the reader's language.
  await expect(page).toHaveURL(/\/knowledge\/KB-\d{5}$/);
  await expect(page.getByRole('heading', { name: 'Start here', level: 1 })).toBeVisible();
  await expect(page.getByText(/Part of the IS Big Platform user guide/)).toBeVisible();
  // The guide's screenshots load (served by the web app, inline only for /help/).
  const shot = page.getByRole('main').locator('img[src^="/help/en/"]').first();
  await shot.scrollIntoViewIfNeeded();
  await expect.poll(() => shot.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expectAccessible(page);

  // A link to a section of another guide opens that guide at the section.
  await page.getByRole('link', { name: 'Personal settings' }).first().click();
  await expect(page).toHaveURL(/\/knowledge\/KB-\d{5}#set-your-language-time-zone-and-sessions$/);
  await expect(page.locator('#set-your-language-time-zone-and-sessions')).toBeInViewport();
});
