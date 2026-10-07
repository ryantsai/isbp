import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, expect, type Page, test } from './fixtures';
import { settle } from './helpers';

async function expectAccessible(page: Page) {
  await settle(page);
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

async function csrfOf(request: APIRequestContext) {
  return ((await (await request.get('/api/v1/auth/session')).json()) as { csrfToken: string }).csrfToken;
}

interface Masking {
  enabled: boolean;
  categories: string[];
  custom: string;
}

test.describe.configure({ mode: 'serial' });

test('AI admin: status hero and tabs in the URL', async ({ page, request }) => {
  const status = (await (await request.get('/api/v1/ai/status')).json()) as { chat: { available: boolean } };
  await page.goto('/admin/ai');
  await expect(page.getByRole('heading', { name: 'AI', level: 1 })).toBeVisible();

  // The hero says honestly which mode AI features run in.
  if (status.chat.available) {
    await expect(page.getByText('Generative AI', { exact: true })).toBeVisible();
  } else {
    await expect(page.getByText('Builtin mode', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Features use retrieval and templates' })).toBeVisible();
    await expect(page.getByText(/No data leaves the platform/)).toBeVisible();
  }
  await expect(page.getByText('Vector store').first()).toBeVisible();

  const tabs = page.getByRole('tablist', { name: 'AI settings' });
  await expect(page.getByText('Chat model', { exact: true })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Provider' }).first()).toBeVisible();

  await tabs.getByRole('tab', { name: 'Privacy & budget' }).click();
  await expect(page).toHaveURL(/\?tab=privacy$/);
  await expect(page.getByText('What to mask')).toBeVisible();

  await tabs.getByRole('tab', { name: 'Usage' }).click();
  await expect(page).toHaveURL(/\?tab=usage$/);
  await expect(page.getByRole('radiogroup', { name: 'Period' })).toBeVisible();
  await page.getByRole('radio', { name: '7 days' }).click();
  await expect(page).toHaveURL(/days=7/);
  await expect(page.getByText('Recent calls')).toBeVisible();

  await tabs.getByRole('tab', { name: 'Index' }).click();
  await expect(page).toHaveURL(/\?tab=index$/);
  await expect(page.getByText('Indexed content')).toBeVisible();

  await tabs.getByRole('tab', { name: 'Models' }).click();
  await expect(page).toHaveURL(/\/admin\/ai$/);
});

test('AI admin: save a masking change, then revert it', async ({ page, request }) => {
  const original = ((await (await request.get('/api/v1/ai/config')).json()) as { masking: Masking }).masking;
  try {
    await page.goto('/admin/ai?tab=privacy');
    const toggle = page.getByRole('switch', { name: 'Mask data before it leaves the platform' });
    if (!(await toggle.isChecked())) await toggle.click();
    const ip = page.getByRole('checkbox', { name: 'IP addresses' });
    const wasChecked = await ip.isChecked();

    await ip.click();
    await expect(ip).toBeChecked({ checked: !wasChecked });
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Privacy and budget saved').first()).toBeVisible();

    await page.reload();
    await expect(page.getByRole('checkbox', { name: 'IP addresses' })).toBeChecked({ checked: !wasChecked });
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();

    // Revert through the UI as well.
    await page.getByRole('checkbox', { name: 'IP addresses' }).click();
    if (!original.enabled)
      await page.getByRole('switch', { name: 'Mask data before it leaves the platform' }).click();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Privacy and budget saved').first()).toBeVisible();
  } finally {
    const csrf = await csrfOf(request);
    await request.put('/api/v1/ai/config', {
      headers: { 'x-csrf-token': csrf },
      data: { masking: original },
    });
  }
});

test('AI admin tabs have no serious accessibility violations (light and dark)', async ({ page }) => {
  test.setTimeout(150_000);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    for (const path of ['/admin/ai', '/admin/ai?tab=privacy', '/admin/ai?tab=usage', '/admin/ai?tab=index']) {
      await page.goto(path);
      await page.evaluate((s) => localStorage.setItem('theme', s), scheme);
      await page.reload();
      await expect(page.getByRole('tablist', { name: 'AI settings' })).toBeVisible();
      await expectAccessible(page);
    }
  }
});
