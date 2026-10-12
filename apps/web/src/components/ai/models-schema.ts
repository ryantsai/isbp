import {
  AI_HEADER_NAME_RE,
  AI_RESERVED_HEADERS,
  type AiConfigInfo,
  type AiHeaderInput,
  type UpdateAiConfigInput,
} from '@isbp/contracts';
import { z } from 'zod';
import { HTTP_URL_RE } from './ai-meta';
import type { HeaderRow } from './connection-fields';

export type KeyMode = 'keep' | 'replace' | 'remove';
export type Section = 'chat' | 'embeddings' | 'rerank' | 'vision' | 'documents';

/** The provider value that means "nothing configured" in a section. */
export const offlineProvider = (section: Section) => (section === 'embeddings' ? 'builtin' : 'none');

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
    headers: headersSchema(t),
    insecureTls: z.boolean(),
  };
  return z
    .object({
      chat: z.object({
        provider: z.enum(['none', 'anthropic', 'openai-compatible']),
        apiStyle: z.enum(['chat-completions', 'responses']),
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
      rerank: z.object({
        provider: z.enum(['none', 'cohere', 'tei', 'voyage']),
        ...common,
        price,
      }),
      images: z.object({ chat: z.boolean() }),
      vision: z.object({
        provider: z.enum(['none', 'chat', 'openai-compatible']),
        apiStyle: z.enum(['chat-completions', 'responses']),
        ...common,
        inputPrice: price,
        outputPrice: price,
      }),
      documents: z.object({
        enabled: z.boolean(),
        provider: z.enum(['none', 'docling', 'paddleocr', 'azure', 'mistral']),
        ...common,
        mode: z.enum(['fallback', 'always']),
        price,
        languages: z.array(z.string()).min(1, t('validation.languages')),
        maxPages: z
          .string()
          .trim()
          .refine((v) => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 2000, t('validation.maxPages')),
      }),
    })
    .superRefine((v, ctx) => {
      const issue = (path: (string | number)[], key: string) =>
        ctx.addIssue({ code: 'custom', path, message: t(key) });
      const { chat, embeddings, rerank, vision, documents } = v;
      if (vision.provider === 'openai-compatible') {
        if (!vision.baseUrl) issue(['vision', 'baseUrl'], 'validation.baseUrlRequired');
        else if (!HTTP_URL_RE.test(vision.baseUrl)) issue(['vision', 'baseUrl'], 'validation.url');
        if (!vision.model) issue(['vision', 'model'], 'validation.modelRequired');
      }
      if (documents.provider !== 'none') {
        if (!documents.baseUrl) issue(['documents', 'baseUrl'], 'validation.baseUrlRequired');
        else if (!HTTP_URL_RE.test(documents.baseUrl)) issue(['documents', 'baseUrl'], 'validation.url');
        // The hosted APIs need a key; services on your network may not.
        if (
          (documents.provider === 'azure' || documents.provider === 'mistral') &&
          !keyAvailable(documents, config.documents.hasApiKey)
        )
          issue(['documents', 'apiKey'], 'validation.keyRequiredService');
      }
      if (rerank.provider !== 'none') {
        if (!rerank.baseUrl) issue(['rerank', 'baseUrl'], 'validation.baseUrlRequired');
        else if (!HTTP_URL_RE.test(rerank.baseUrl)) issue(['rerank', 'baseUrl'], 'validation.url');
        // TEI serves one model, so it needs no name; the hosted APIs do.
        if (rerank.provider !== 'tei' && !rerank.model)
          issue(['rerank', 'model'], 'validation.modelRequired');
      }
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

/** Header rows: valid, unique names; a new (or replaced) header needs a value without line breaks. */
export function headersSchema(t: (key: string) => string) {
  return z
    .array(
      z.object({
        name: z
          .string()
          .trim()
          .min(1, t('validation.headerName'))
          .regex(AI_HEADER_NAME_RE, t('validation.headerName'))
          .refine(
            (n) => !(AI_RESERVED_HEADERS as readonly string[]).includes(n.toLowerCase()),
            t('validation.headerReserved'),
          ),
        value: z
          .string()
          .max(2000, t('validation.tooLong'))
          .refine((v) => !/[\r\n\0]/.test(v), t('validation.headerValue')),
        stored: z.boolean(),
      }),
    )
    .superRefine((rows, ctx) => {
      const seen = new Set<string>();
      rows.forEach((r, i) => {
        const key = r.name.trim().toLowerCase();
        if (key && seen.has(key))
          ctx.addIssue({ code: 'custom', path: [i, 'name'], message: t('validation.headerDuplicate') });
        seen.add(key);
        if (!r.stored && !r.value)
          ctx.addIssue({ code: 'custom', path: [i, 'value'], message: t('validation.headerValueRequired') });
      });
    });
}

/** Stored headers as rows (values stay on the server). */
export const headerRows = (headers: { name: string }[]): HeaderRow[] =>
  headers.map((h) => ({ name: h.name, value: '', stored: true }));

/**
 * The headers to send: a stored row without a new value keeps its value, unless the provider changed (a stored
 * value is never sent on to another service, like the key).
 */
export function headersBody(rows: HeaderRow[], providerSwitched: boolean): AiHeaderInput[] {
  return rows
    .filter((r) => r.value || (r.stored && !providerSwitched))
    .map((r) => (r.value ? { name: r.name.trim(), value: r.value } : { name: r.name.trim() }));
}

function keyAvailable(s: { keyMode: KeyMode; apiKey: string }, stored: boolean) {
  return (s.keyMode === 'keep' && stored) || (s.keyMode === 'replace' && s.apiKey.trim() !== '');
}

const priceText = (n: number) => (n ? String(n) : '');

export function toModelsValues(c: AiConfigInfo): ModelsValues {
  return {
    chat: {
      provider: c.chat.provider,
      apiStyle: c.chat.apiStyle,
      baseUrl: c.chat.baseUrl,
      model: c.chat.model,
      keyMode: c.chat.hasApiKey ? 'keep' : 'replace',
      apiKey: '',
      headers: headerRows(c.chat.headers),
      insecureTls: c.chat.insecureTls,
      inputPrice: priceText(c.chat.inputPrice),
      outputPrice: priceText(c.chat.outputPrice),
    },
    embeddings: {
      provider: c.embeddings.provider,
      baseUrl: c.embeddings.baseUrl,
      model: c.embeddings.model,
      keyMode: c.embeddings.hasApiKey ? 'keep' : 'replace',
      apiKey: '',
      headers: headerRows(c.embeddings.headers),
      insecureTls: c.embeddings.insecureTls,
      dimensions: c.embeddings.dimensions ? String(c.embeddings.dimensions) : '',
      price: priceText(c.embeddings.price),
    },
    rerank: {
      provider: c.rerank.provider,
      baseUrl: c.rerank.baseUrl,
      model: c.rerank.model,
      keyMode: c.rerank.hasApiKey ? 'keep' : 'replace',
      apiKey: '',
      headers: headerRows(c.rerank.headers),
      insecureTls: c.rerank.insecureTls,
      price: priceText(c.rerank.price),
    },
    images: { chat: c.images.chat },
    vision: {
      provider: c.vision.provider,
      apiStyle: c.vision.apiStyle,
      baseUrl: c.vision.baseUrl,
      model: c.vision.model,
      keyMode: c.vision.hasApiKey ? 'keep' : 'replace',
      apiKey: '',
      headers: headerRows(c.vision.headers),
      insecureTls: c.vision.insecureTls,
      inputPrice: priceText(c.vision.inputPrice),
      outputPrice: priceText(c.vision.outputPrice),
    },
    documents: {
      enabled: c.documents.enabled,
      provider: c.documents.provider,
      baseUrl: c.documents.baseUrl,
      model: c.documents.model,
      keyMode: c.documents.hasApiKey ? 'keep' : 'replace',
      apiKey: '',
      headers: headerRows(c.documents.headers),
      insecureTls: c.documents.insecureTls,
      mode: c.documents.mode,
      price: priceText(c.documents.price),
      languages: [...c.documents.languages],
      maxPages: String(c.documents.maxPages),
    },
  };
}

/** True when the stored key may belong to another service than the one now selected. */
export function providerChanged(section: Section, provider: string, c: AiConfigInfo) {
  return c[section].hasApiKey && hasConnection(section, provider) && provider !== c[section].provider;
}

/** The section calls a service of its own (builtin, none and "the chat model" have no connection to keep). */
const hasConnection = (section: Section, provider: string) =>
  provider !== offlineProvider(section) && !(section === 'vision' && provider === 'chat');

/**
 * The `apiKey` to send: omitted keeps the stored one, `''` removes it. A stored key is never sent on to
 * a different provider unless the admin says so: switching provider without typing a new key removes it.
 */
function keyFor(section: Section, s: ModelsValues[Section], c: AiConfigInfo): string | undefined {
  if (!hasConnection(section, s.provider)) return undefined;
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
  const rerankKey = keyFor('rerank', v.rerank, c);
  const documentsKey = keyFor('documents', v.documents, c);
  const visionKey = keyFor('vision', v.vision, c);
  const visionOwn = v.vision.provider === 'openai-compatible';
  const documentsOffline = v.documents.provider === 'none';
  const chatOffline = v.chat.provider === 'none';
  const embedOffline = v.embeddings.provider === 'builtin';
  const rerankOffline = v.rerank.provider === 'none';
  return {
    chat: {
      provider: v.chat.provider,
      apiStyle: v.chat.apiStyle,
      baseUrl: v.chat.baseUrl.trim(),
      model: v.chat.model.trim(),
      inputPrice: num(v.chat.inputPrice),
      outputPrice: num(v.chat.outputPrice),
      // Builtin mode keeps what was configured (switching back restores it); the switch is only sent when used.
      ...(!chatOffline && {
        headers: headersBody(v.chat.headers, providerChanged('chat', v.chat.provider, c)),
        insecureTls: v.chat.insecureTls,
      }),
      ...(chatKey !== undefined && { apiKey: chatKey }),
    },
    embeddings: {
      provider: v.embeddings.provider,
      baseUrl: v.embeddings.baseUrl.trim(),
      model: v.embeddings.model.trim(),
      dimensions: num(v.embeddings.dimensions),
      price: num(v.embeddings.price),
      ...(!embedOffline && {
        headers: headersBody(v.embeddings.headers, providerChanged('embeddings', v.embeddings.provider, c)),
        insecureTls: v.embeddings.insecureTls,
      }),
      ...(embedKey !== undefined && { apiKey: embedKey }),
    },
    rerank: {
      provider: v.rerank.provider,
      baseUrl: v.rerank.baseUrl.trim(),
      model: v.rerank.model.trim(),
      price: num(v.rerank.price),
      ...(!rerankOffline && {
        headers: headersBody(v.rerank.headers, providerChanged('rerank', v.rerank.provider, c)),
        insecureTls: v.rerank.insecureTls,
      }),
      ...(rerankKey !== undefined && { apiKey: rerankKey }),
    },
    images: { chat: v.images.chat },
    vision: {
      provider: v.vision.provider,
      apiStyle: v.vision.apiStyle,
      baseUrl: v.vision.baseUrl.trim(),
      model: v.vision.model.trim(),
      inputPrice: num(v.vision.inputPrice),
      outputPrice: num(v.vision.outputPrice),
      ...(visionOwn && {
        headers: headersBody(v.vision.headers, providerChanged('vision', v.vision.provider, c)),
        insecureTls: v.vision.insecureTls,
      }),
      ...(visionKey !== undefined && { apiKey: visionKey }),
    },
    documents: {
      enabled: v.documents.enabled,
      provider: v.documents.provider,
      baseUrl: v.documents.baseUrl.trim(),
      model: v.documents.model.trim(),
      mode: v.documents.mode,
      price: num(v.documents.price),
      languages: v.documents.languages,
      maxPages: Number(v.documents.maxPages),
      ...(!documentsOffline && {
        headers: headersBody(v.documents.headers, providerChanged('documents', v.documents.provider, c)),
        insecureTls: v.documents.insecureTls,
      }),
      ...(documentsKey !== undefined && { apiKey: documentsKey }),
    },
  };
}
