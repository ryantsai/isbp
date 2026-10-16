import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from './fixtures';
import { overflowing, settle } from './helpers';

async function openConfig(page: Page) {
  await page.goto('/integrations');
  await page.getByRole('button', { name: 'Add connection', exact: true }).first().click();
  await page.getByText('HR database sync', { exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Add a HR database sync connection' });
  await expect(sheet.getByLabel('HR database', { exact: false })).toBeVisible();
  await expect(sheet.getByRole('textbox', { name: 'Employee query', exact: true })).toBeVisible();
  return sheet;
}

test('HR source settings support keyboard, light/dark themes and mobile layout', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const sheet = await openConfig(page);
  await expect(sheet.getByRole('checkbox', { name: 'Sync employment status', exact: true })).toBeChecked();
  await expect(sheet.getByRole('switch', { name: /Allow insecure HTTP/ })).toHaveCount(0);
  const employedValues = sheet.getByRole('textbox', { name: 'Employed status values', exact: true });
  await employedValues.fill('');
  await employedValues.pressSequentially('on staff, active');
  await expect(employedValues).toHaveValue('on staff, active');
  await sheet.getByRole('textbox', { name: 'Employee query', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(sheet.getByRole('textbox', { name: 'Employee query', exact: true })).not.toBeFocused();
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.evaluate((mode) => {
      localStorage.setItem('theme', mode);
    }, theme);
    await page.reload();
    const dialog = await openConfig(page);
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await settle(page);
      const layout = await overflowing(page);
      expect(layout.overflow).toBeLessThanOrEqual(1);
      expect(layout.offenders).toEqual([]);
      expect(
        (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze())
          .violations,
      ).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`hr-sync-${theme}-${width}.png`) });
    }
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
});

test('configure an HR source, preview a People rule and import it', async ({ page, request }) => {
  test.setTimeout(180_000);
  test.skip(
    !process.env.E2E_HR_DATABASE_URL,
    'Set E2E_HR_DATABASE_URL to an isolated local SQL test database',
  );
  const url = new URL(process.env.E2E_HR_DATABASE_URL!);
  const key = `hr-e2e-${Date.now()}`;
  const csrf = (await (await request.get('/api/v1/auth/session')).json()).csrfToken as string;
  const headers = { 'x-csrf-token': csrf };
  const createdDb = await request.post('/api/v1/databases', {
    headers,
    data: {
      key,
      name: key,
      engine: 'postgres',
      host: url.hostname,
      port: Number(url.port || 5432),
      database: url.pathname.slice(1),
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      options: { tls: 'off' },
      readOnly: true,
      purposes: ['data'],
    },
  });
  expect(createdDb.ok(), await createdDb.text()).toBeTruthy();
  const db = (await createdDb.json()) as { id: string };
  let connectionId: string | undefined;
  let userId: string | undefined;
  try {
    const sheet = await openConfig(page);
    await sheet.getByLabel('Connection name').fill(key);
    await sheet.getByRole('combobox', { name: /HR database/ }).click();
    await page.getByRole('option', { name: key, exact: true }).click();
    const query = `SELECT '${key}' AS "employeeId", '${key}@example.test' AS email, '${key}' AS username, 'HR browser test' AS "displayName", 'employed' AS status`;
    await sheet.getByRole('textbox', { name: 'Employee query', exact: true }).fill(query);
    await sheet.getByRole('button', { name: 'Test connection', exact: true }).click();
    await expect(sheet.getByText('The connection works.', { exact: true })).toBeVisible();
    const response = page.waitForResponse(
      (r) => r.url().endsWith('/integrations/connections') && r.request().method() === 'POST',
    );
    await sheet.getByRole('button', { name: 'Add connection', exact: true }).click();
    const created = await response;
    expect(created.ok(), await created.text()).toBeTruthy();
    connectionId = ((await created.json()) as { id: string }).id;
    await expect(page).toHaveURL(new RegExp(`/integrations/connections/${connectionId}$`));
    await expect(page.getByText('Setup: instant updates', { exact: true })).toHaveCount(0);
    const mapping = await (
      await request.get(
        `/api/v1/integrations/profiles/default-mapping?connectionId=${connectionId}&objectType=employee&entity=core.person`,
      )
    ).json();
    const profileResponse = await request.post('/api/v1/integrations/profiles', {
      headers,
      data: {
        name: key,
        connectionId,
        objectType: 'employee',
        entity: 'core.person',
        intervalMinutes: 0,
        matchRule: { local: 'employeeId', remote: 'employeeId' },
        mappings: mapping.mappings,
      },
    });
    expect(profileResponse.ok(), await profileResponse.text()).toBeTruthy();
    const profile = (await profileResponse.json()) as { id: string };
    await page.goto(`/integrations/connections/${connectionId}/profiles/${profile.id}`);
    const previewResponse = page.waitForResponse((r) => r.url().endsWith(`/profiles/${profile.id}/preview`));
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    expect((await previewResponse).ok()).toBeTruthy();
    await expect(page.getByText('HR browser test').first()).toBeVisible();
    const peopleBefore = await (await request.get(`/api/v1/users?q=${key}`)).json();
    expect(peopleBefore.items).toHaveLength(0);
    await page.getByRole('button', { name: 'Run now', exact: true }).click();
    await expect(page).toHaveURL(/\/integrations\/runs\//);
    await expect
      .poll(
        async () => {
          const people = await (await request.get(`/api/v1/users?q=${key}`)).json();
          userId = people.items[0]?.id;
          return people.items[0]?.status;
        },
        { timeout: 30_000 },
      )
      .toBe('active');
  } finally {
    if (connectionId) await request.delete(`/api/v1/integrations/connections/${connectionId}`, { headers });
    if (userId)
      await request.post(`/api/v1/users/${userId}/offboard`, {
        headers,
        data: { reason: 'HR browser test cleanup' },
      });
    await request.delete(`/api/v1/databases/${db.id}`, { headers });
  }
});
