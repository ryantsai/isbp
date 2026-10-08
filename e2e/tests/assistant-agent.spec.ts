import AxeBuilder from '@axe-core/playwright';
import type { APIRequestContext } from '@playwright/test';
import { expect, test } from './fixtures';
import { settle } from './helpers';

/**
 * The built-in agent with a chat model: Administration → AI points at the scripted stand-in model of
 * `tooling/integration-mocks` (`/llm/v1`, `INTEGRATION_MOCKS_URL`), which reads proposals from a ```json block. The
 * agent streams its tool calls through the platform's own MCP tools, builds a change set, asks to apply it, and
 * applies it only after the person confirms in the panel; a change set with a form is answered with the form's own
 * link. The tests restore builtin mode and roll their changes back.
 *   E2E_BASE_URL=http://localhost:3000 pnpm e2e assistant-agent
 */

const MOCKS = process.env.INTEGRATION_MOCKS_URL ?? 'http://localhost:4100';
const stamp = Date.now().toString(36);
const key = `agent${stamp}`;
const label = `Agent field ${stamp}`;

async function csrfOf(request: APIRequestContext) {
  return ((await (await request.get('/api/v1/auth/session')).json()) as { csrfToken: string }).csrfToken;
}

async function useModel(request: APIRequestContext, on: boolean) {
  const res = await request.put('/api/v1/ai/config', {
    headers: { 'x-csrf-token': await csrfOf(request) },
    data: {
      chat: on
        ? { provider: 'openai-compatible', baseUrl: `${MOCKS}/llm/v1`, model: 'scripted' }
        : { provider: 'none' },
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

async function groupFields(request: APIRequestContext) {
  const res = await request.get('/api/v1/custom-fields?entityType=core.group');
  return ((await res.json()) as { items: { field: { key: string } }[] }).items.map((f) => f.field.key);
}

test('the built-in agent prepares a change and applies it once the person confirms', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await useModel(request, true);
  try {
    await page.goto('/admin/groups');
    await page.getByRole('banner').getByRole('button', { name: 'Assistant', exact: true }).click();
    const panel = page.getByRole('dialog', { name: 'Assistant' });
    await expect(panel.getByText('AI model: scripted').first()).toBeVisible();

    const proposal = {
      kind: 'core.custom-field',
      op: 'create',
      value: {
        entityType: 'core.group',
        field: {
          key,
          type: 'text',
          label: { en: label, 'zh-TW': `代理欄位 ${stamp}`, 'ja-JP': `エージェント項目 ${stamp}` },
        },
      },
    };
    const input = panel.getByRole('textbox', { name: 'Message to the assistant' });
    await input.fill(`Add a field to groups and apply it:\n\`\`\`json\n${JSON.stringify(proposal)}\n\`\`\``);
    await panel.getByRole('button', { name: 'Send' }).click();

    // The agent asks; nothing has run yet.
    const card = panel.getByRole('region', { name: /^Confirmation: Apply CS-\d{5} \(1 change\)$/ });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByText('Confirm it in the card to apply it', { exact: false })).toBeVisible();
    expect(await groupFields(request)).not.toContain(key);
    await expect(card.getByRole('link', { name: 'Review the changes before you confirm' })).toBeVisible();
    const href = await card
      .getByRole('link', { name: 'Review the changes before you confirm' })
      .getAttribute('href');
    const changeSetId = href!.split('/').at(-1)!;

    await settle(page);
    const { violations } = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual(
      [],
    );

    await card.getByRole('button', { name: /^Confirm: Apply CS-\d{5}/ }).click();
    await expect(panel.getByText(/^Done: Apply CS-\d{5} \(1 change\)\.$/)).toBeVisible();
    await expect(card.getByText('Confirmed', { exact: true })).toBeVisible();
    expect(await groupFields(request)).toContain(key);

    // Leave the demo as it was.
    const rolled = await request.post(`/api/v1/assistant/change-sets/${changeSetId}/rollback`, {
      headers: { 'x-csrf-token': await csrfOf(request) },
      data: { confirm: true, reason: 'e2e cleanup' },
    });
    expect(rolled.ok(), await rolled.text()).toBe(true);
  } finally {
    await useModel(request, false);
  }
});

test('after applying a change set with a form, the agent answers with the form’s own link', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await useModel(request, true);
  const formKey = `agent-form-${stamp}`;
  const t3 = (en: string) => ({ en, 'zh-TW': en, 'ja-JP': en });
  try {
    await page.goto('/admin/forms');
    await page.getByRole('banner').getByRole('button', { name: 'Assistant', exact: true }).click();
    const panel = page.getByRole('dialog', { name: 'Assistant' });
    const proposals = [
      {
        kind: 'core.workflow',
        op: 'create',
        ref: 'approval',
        value: {
          name: `Agent approval ${stamp}`,
          description: null,
          triggerKey: 'core.form-submission',
          isDefault: false,
          graph: {
            steps: [
              {
                id: 'manager',
                type: 'approval',
                name: t3('Manager approval'),
                approvers: [{ type: 'manager' }],
                mode: 'any',
                ifNoApprover: 'skip',
              },
            ],
          },
        },
      },
      {
        kind: 'core.form',
        op: 'create',
        ref: 'form',
        value: {
          key: formKey,
          name: t3(`Agent request ${stamp}`),
          description: null,
          icon: 'file-text',
          category: null,
          schema: { elements: [{ id: 'why', key: 'why', type: 'text', label: t3('Why'), required: true }] },
          workflowId: '$ref:approval',
          audience: { type: 'everyone' },
          active: true,
        },
      },
    ];
    await panel
      .getByRole('textbox', { name: 'Message to the assistant' })
      .fill(
        `Create a request form with its approval and apply it:\n\`\`\`json\n${JSON.stringify(proposals)}\n\`\`\``,
      );
    await panel.getByRole('button', { name: 'Send' }).click();

    const card = panel.getByRole('region', { name: /^Confirmation: Apply CS-\d{5} \(2 changes\)$/ });
    await expect(card).toBeVisible({ timeout: 30_000 });
    const href = await card
      .getByRole('link', { name: 'Review the changes before you confirm' })
      .getAttribute('href');
    const changeSetId = href!.split('/').at(-1)!;
    await card.getByRole('button', { name: /^Confirm: Apply CS-\d{5}/ }).click();

    // The reply names where requesters go, besides the change set.
    await expect(panel.getByText(/^Done: Apply CS-\d{5} \(2 changes\)\.$/)).toBeVisible();
    await expect(panel.getByText('Ready to use:')).toBeVisible();
    const open = panel.getByRole('link', { name: 'Open the form', exact: true });
    await expect(open).toHaveAttribute('href', `/requests/forms/${formKey}`);
    // The change set card links to it too, once applied.
    await expect(panel.getByRole('link', { name: `Open the form: Agent request ${stamp}` })).toBeVisible();
    await settle(page);
    const { violations } = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual(
      [],
    );
    await open.click();
    await expect(page).toHaveURL(new RegExp(`/requests/forms/${formKey}$`));
    await expect(page.getByRole('heading', { name: `Agent request ${stamp}` })).toBeVisible();

    const rolled = await request.post(`/api/v1/assistant/change-sets/${changeSetId}/rollback`, {
      headers: { 'x-csrf-token': await csrfOf(request) },
      data: { confirm: true, reason: 'e2e cleanup' },
    });
    expect(rolled.ok(), await rolled.text()).toBe(true);
  } finally {
    await useModel(request, false);
  }
});
