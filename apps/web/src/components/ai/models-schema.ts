import type { AiConfigInfo, UpdateAiConfigInput } from '@isbp/contracts';
import { z } from 'zod';
import { HTTP_URL_RE } from './ai-meta';

export type KeyMode = 'keep' | 'replace' | 'remove';
export type Section = 'chat' | 'embeddings';

const PRICE_RE = /^\d+(?:\.\d+)?$/;

/** Form schema for Administration → AI → Models (both cards share one form and one Save). */
export function modelsSchema(t: (key: string) => string, config: AiConfigInfo) {
  const tooLong = t('validation.tooLong');
  const price = z
    .string()
    .trim()
    .refine((v) => v === '' || (PRICE_RE.test(v) && Number(v) <= 1000), t('validation.price'));
  const keyMode = z.enum(['keep', 'replace', 'remove']);
  const common = {
    baseUrl: z.string().trim().max(500, tooLong),
    model: z.string().trim().max(150, tooLong),
    keyMode,
    apiKey: z.string().max(500, tooLong),
  };
  return z
    .object({
      chat: z.object({
        provider: z.enum(['none', 'anthropic', 'openai-compatible']),
        ...common,
        inputPrice: price,
        outputPrice: price,
      }),
      embeddings: z.object({
        provider: z.enum(['builtin', 'openai-compatible']),
        ...common,
        dimensions: z
          .string()
          .trim()
          .refine((v) => v === '' || (/^\d+$/.test(v) && Number(v) <= 4000), t('validation.dimensions')),
        price,
      }),
    })
    .superRefine((v, ctx) => {
      const issue = (path: (string | number)[], key: string) =>
        ctx.addIssue({ code: 'custom', path, message: t(key) });
      const { chat, embeddings } = v;
      if (chat.provider !== 'none') {
        if (chat.baseUrl && !HTTP_URL_RE.test(chat.baseUrl)) issue(['chat', 'baseUrl'], 'validation.url');
        if (chat.provider === 'openai-compatible') {
          if (!chat.baseUrl) issue(['chat', 'baseUrl'], 'validation.baseUrlRequired');
          if (!chat.model) issue(['chat', 'model'], 'validation.modelRequired');
        }
        if (chat.provider === 'anthropic' && !keyAvailable(chat, config.chat.hasApiKey))
          issue(['chat', 'apiKey'], 'validation.keyRequired');
      }
      if (embeddings.provider === 'openai-compatible') {
        if (!embeddings.baseUrl) issue(['embeddings', 'baseUrl'], 'validation.baseUrlRequired');
        else if (!HTTP_URL_RE.test(embeddings.baseUrl)) issue(['embeddings', 'baseUrl'], 'validation.url');
        if (!embeddings.model) issue(['embeddings', 'model'], 'validation.modelRequired');
      }
    });
}

export type ModelsValues = z.input<ReturnType<typeof modelsSchema>>;

function keyAvailable(s: { keyMode: KeyMode; apiKey: string }, stored: boolean) {
  return (s.keyMode === 'keep' && stored) || (s.keyMode === 'replace' && s.apiKey.trim() !== '');
}

const priceText = (n: number) => (n ? String(n) : '');

export function toModelsValues(c: AiConfigInfo): ModelsValues {
  return {
    chat: {
      provider: c.chat.provider,
      baseUrl: c.chat.baseUrl,
      model: c.chat.model,
      keyMode: c.chat.hasApiKey ? 'keep' : 'replace',
      apiKey: '',
      inputPrice: priceText(c.chat.inputPrice),
      outputPrice: priceText(c.chat.outputPrice),
    },
    embeddings: {
      provider: c.embeddings.provider,
      baseUrl: c.embeddings.baseUrl,
      model: c.embeddings.model,
      keyMode: c.embeddings.hasApiKey ? 'keep' : 'replace',
      apiKey: '',
      dimensions: c.embeddings.dimensions ? String(c.embeddings.dimensions) : '',
      price: priceText(c.embeddings.price),
    },
  };
}

/** True when the stored key may belong to another service than the one now selected. */
export function providerChanged(section: Section, provider: string, c: AiConfigInfo) {
  const offline = section === 'chat' ? 'none' : 'builtin';
  return c[section].hasApiKey && provider !== offline && provider !== c[section].provider;
}

/**
 * The `apiKey` to send: omitted keeps the stored one, `''` removes it. A stored key is never sent on to
 * a different provider unless the admin says so: switching provider without typing a new key removes it.
 */
function keyFor(section: Section, s: ModelsValues[Section], c: AiConfigInfo): string | undefined {
  const offline = section === 'chat' ? 'none' : 'builtin';
  if (s.provider === offline) return undefined;
  if (s.keyMode === 'remove') return '';
  if (s.keyMode === 'replace') {
    const typed = s.apiKey.trim();
    if (typed) return typed;
    return providerChanged(section, s.provider, c) ? '' : undefined;
  }
  return undefined;
}

const num = (v: string) => (v.trim() ? Number(v) : 0);

export function toModelsBody(v: ModelsValues, c: AiConfigInfo): UpdateAiConfigInput {
  const chatKey = keyFor('chat', v.chat, c);
  const embedKey = keyFor('embeddings', v.embeddings, c);
  return {
    chat: {
      provider: v.chat.provider,
      baseUrl: v.chat.baseUrl.trim(),
      model: v.chat.model.trim(),
      inputPrice: num(v.chat.inputPrice),
      outputPrice: num(v.chat.outputPrice),
      ...(chatKey !== undefined && { apiKey: chatKey }),
    },
    embeddings: {
      provider: v.embeddings.provider,
      baseUrl: v.embeddings.baseUrl.trim(),
      model: v.embeddings.model.trim(),
      dimensions: num(v.embeddings.dimensions),
      price: num(v.embeddings.price),
      ...(embedKey !== undefined && { apiKey: embedKey }),
    },
  };
}
