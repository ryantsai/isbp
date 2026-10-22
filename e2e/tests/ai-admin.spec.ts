import { deflateSync } from 'node:zlib';
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
  // Deployment internals sit behind "Technical details" (collapsed).
  const technical = page.getByRole('button', { name: 'Technical details' }).first();
  await expect(technical).toHaveAttribute('aria-expanded', 'false');
  await technical.click();
  await expect(technical).toHaveAttribute('aria-expanded', 'true');
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

  await tabs.getByRole('tab', { name: 'Outside agents (MCP)' }).click();
  await expect(page).toHaveURL(/\?tab=mcp$/);
  await expect(page.getByText('Connect Claude Code')).toBeVisible();
  // Protocol revisions are technical details (collapsed), not the decision this tab supports.
  await expect(page.locator('[aria-hidden="true"]').getByText('Protocol revisions')).toBeAttached();

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

test('AI admin: an OpenAI-compatible model over the Responses API, with a custom header', async ({
  page,
  request,
}) => {
  // The scripted chat model of the integration mocks (`pnpm dev:services`).
  const mocks = process.env.E2E_MOCKS_URL ?? 'http://localhost:4100';
  const original = (
    (await (await request.get('/api/v1/ai/config')).json()) as {
      chat: {
        provider: string;
        baseUrl: string;
        model: string;
        apiStyle: string;
        headers: { name: string }[];
      };
    }
  ).chat;
  try {
    await page.goto('/admin/ai');
    const chat = page.getByRole('radiogroup', { name: 'Provider' }).first();
    await chat.getByText('OpenAI-compatible').click();
    // The chat card's fields come in after its transition: until then "first" could be another card's field.
    await expect(page.getByRole('radiogroup', { name: 'API' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Base URL' }).first().fill(`${mocks}/llm/v1`);
    await page.getByRole('textbox', { name: 'Model' }).first().fill('scripted');
    await page.getByRole('radiogroup', { name: 'API' }).getByText('Responses', { exact: true }).click();
    await page.getByRole('button', { name: 'Connection options' }).first().click();
    await page.getByRole('button', { name: 'Add header' }).first().click();
    await page.getByRole('textbox', { name: 'Header name' }).first().fill('X-Tenant');
    await page.getByRole('textbox', { name: 'Value' }).first().fill('e2e-tenant');
    await page.getByRole('checkbox', { name: 'Skip TLS certificate checks' }).first().check();
    await expect(page.getByText(/Certificates are not checked/).first()).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('checkbox', { name: 'Skip TLS certificate checks' }).first().uncheck();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('AI settings saved').first()).toBeVisible();

    // The value is never shown again, only that it is stored.
    await expect(page.getByText('Value stored').first()).toBeVisible();
    await expect(page.locator('input[value="e2e-tenant"]')).toHaveCount(0);
    const saved = (await (await request.get('/api/v1/ai/config')).json()) as {
      chat: Record<string, unknown>;
    };
    expect(saved.chat).toMatchObject({ apiStyle: 'responses', headers: [{ name: 'X-Tenant' }] });
    expect(JSON.stringify(saved)).not.toContain('e2e-tenant');

    await page.getByRole('button', { name: 'Test connection' }).first().click();
    await expect(page.getByText(/Connected · scripted/).first()).toBeVisible();
  } finally {
    const csrf = await csrfOf(request);
    await request.put('/api/v1/ai/config', {
      headers: { 'x-csrf-token': csrf },
      data: {
        chat: {
          provider: original.provider,
          baseUrl: original.baseUrl,
          model: original.model,
          apiStyle: original.apiStyle,
          headers: original.headers,
          insecureTls: false,
        },
      },
    });
  }
});

test('AI admin: a reranker connection, tested against the stand-in', async ({ page, request }) => {
  const mocks = process.env.E2E_MOCKS_URL ?? 'http://localhost:4100';
  try {
    await page.goto('/admin/ai');
    await expect(page.getByText('Reranker', { exact: true }).first()).toBeVisible();
    const providers = page.getByRole('radiogroup', { name: 'Provider' }).nth(2);
    await expect(providers.getByRole('radio', { name: 'none' })).toBeChecked();
    await providers.getByText('Cohere-compatible').click();
    await page.getByRole('textbox', { name: 'Base URL' }).last().fill(`${mocks}/rerank/v1`);
    await page.getByRole('textbox', { name: 'Model' }).last().fill('overlap');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('AI settings saved').first()).toBeVisible();
    // Cards: chat, embeddings, reranker, images, attachments.
    await page.getByRole('button', { name: 'Test connection' }).nth(2).click();
    await expect(page.getByText(/^Connected · [\d,. ]+ ms$/).first()).toBeVisible();
    await expectAccessible(page);
  } finally {
    const csrf = await csrfOf(request);
    await request.put('/api/v1/ai/config', {
      headers: { 'x-csrf-token': csrf },
      data: { rerank: { provider: 'none', baseUrl: '', model: '', headers: [], insecureTls: false } },
    });
  }
});

test('AI admin: a document-extraction service for scans, tested against the Docling stand-in', async ({
  page,
  request,
}) => {
  const mocks = process.env.E2E_MOCKS_URL ?? 'http://localhost:4100';
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/admin/ai');
    await expect(page.getByText('Searchable attachments', { exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Make attachments searchable' })).toBeChecked();
    const services = page.getByRole('radiogroup', { name: 'Document-extraction service' });
    await services.getByText('Docling', { exact: true }).click();
    // Files leave the platform as they are: the card says so.
    await expect(page.getByText(/Files are sent to this service as they are/)).toBeVisible();
    await page.getByRole('textbox', { name: 'Base URL' }).last().fill(`${mocks}/docling`);
    await page.getByRole('textbox', { name: 'API key' }).last().fill('docling-key');
    await expect(
      page.getByRole('group', { name: 'OCR languages' }).getByRole('checkbox', { name: '繁體中文' }),
    ).toBeChecked();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('AI settings saved').first()).toBeVisible();
    await page.getByRole('button', { name: 'Test connection' }).last().click();
    await expect(page.getByText(/^Connected · [\d,. ]+ ms$/).first()).toBeVisible();
    await expectAccessible(page);

    await page.goto('/admin/ai?tab=index');
    await expect(page.getByText('Attachments', { exact: true }).last()).toBeVisible();
    await expect(page.getByText('Scans waiting for OCR')).toBeVisible();
  } finally {
    const csrf = await csrfOf(request);
    await request.put('/api/v1/ai/config', {
      headers: { 'x-csrf-token': csrf },
      data: { documents: { provider: 'none', baseUrl: '', apiKey: '', headers: [], insecureTls: false } },
    });
  }
});

/** A one-colour PNG whose `Text` chunk holds what the stand-in model "reads" in it, like words in a screenshot. */
function screenshot(words: string) {
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) {
      c ^= x;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(64, 0);
  header.writeUInt32BE(32, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.alloc(1 + 64 * 3, 240);
  row[0] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: 32 }, () => row)))),
    chunk('tEXt', Buffer.concat([Buffer.from('Text'), Buffer.from([0]), Buffer.from(words)])),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('AI admin: an image description model, then a screenshot in Ask IS', async ({ page, request }) => {
  const mocks = process.env.E2E_MOCKS_URL ?? 'http://localhost:4100';
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/admin/ai');
    await expect(page.getByText('Image understanding', { exact: true })).toBeVisible();
    const models = page.getByRole('radiogroup', { name: 'Image description model' });
    // Without a chat model, "The chat model" can't describe anything.
    await expect(models.getByRole('radio', { name: /The chat model/ })).toBeDisabled();
    await models.getByText('Another OpenAI-compatible model').click();
    await expect(page.getByText(/Images are sent to the model as they are/)).toBeVisible();
    await page.getByRole('textbox', { name: 'Base URL' }).last().fill(`${mocks}/llm/v1`);
    await page.getByRole('textbox', { name: 'Model' }).last().fill('scripted');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('AI settings saved').first()).toBeVisible();
    // The test sends a red square: the stand-in names the colour only if it sees the image.
    await page.getByRole('button', { name: 'Test connection' }).nth(3).click();
    await expect(page.getByText(/^Connected · [\d,. ]+ ms$/).first()).toBeVisible();
    await expectAccessible(page);

    await page.goto('/helpdesk-ai/chat');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Attach a screenshot' }).click();
    await (
      await chooser
    ).setFiles({
      name: 'vpn-error.png',
      mimeType: 'image/png',
      buffer: screenshot('My VPN keeps disconnecting every few minutes'),
    });
    const send = page.getByRole('button', { name: 'Send' });
    await expect(send).toBeEnabled();
    await send.click();
    // Read by the image description model, the screenshot finds the article without a typed word.
    await expect(page.getByText('VPN disconnects every few minutes').first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole('button', { name: 'Open screenshot vpn-error.png' })).toBeVisible();
    await expectAccessible(page);
  } finally {
    const csrf = await csrfOf(request);
    await request.put('/api/v1/ai/config', {
      headers: { 'x-csrf-token': csrf },
      data: { vision: { provider: 'none', baseUrl: '', model: '', headers: [], insecureTls: false } },
    });
  }
});

test('AI admin tabs have no serious accessibility violations (light and dark)', async ({ page }) => {
  test.setTimeout(150_000);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    for (const path of [
      '/admin/ai',
      '/admin/ai?tab=privacy',
      '/admin/ai?tab=usage',
      '/admin/ai?tab=index',
      '/admin/ai?tab=mcp',
    ]) {
      await page.goto(path);
      await page.evaluate((s) => localStorage.setItem('theme', s), scheme);
      await page.reload();
      await expect(page.getByRole('tablist', { name: 'AI settings' })).toBeVisible();
      await expectAccessible(page);
    }
  }
});
