import { z } from 'zod';
import { dateTime } from './common';

export const aiChatProviderSchema = z.enum(['none', 'anthropic', 'openai-compatible']);
export const aiEmbeddingProviderSchema = z.enum(['builtin', 'openai-compatible']);
/** Wire format of an OpenAI-compatible chat endpoint: `/chat/completions` or `/responses`. */
export const aiApiStyleSchema = z.enum(['chat-completions', 'responses']);
export type AiApiStyle = z.infer<typeof aiApiStyleSchema>;
/**
 * Reranker API: `cohere` (Cohere, Jina, vLLM, Infinity, LiteLLM `/rerank`), `tei` (Hugging Face Text Embeddings
 * Inference) or `voyage` (Voyage AI). `none` keeps search's fused order.
 */
export const aiRerankProviderSchema = z.enum(['none', 'cohere', 'tei', 'voyage']);
export type AiRerankProvider = z.infer<typeof aiRerankProviderSchema>;
/**
 * Document-extraction service for scans, images and layout: docling-serve, PaddleOCR serving, Azure AI Document
 * Intelligence or Mistral OCR. `none` keeps the builtin readers (PDF text layer, Office files, plain text).
 */
export const aiDocumentProviderSchema = z.enum(['none', 'docling', 'paddleocr', 'azure', 'mistral']);
export type AiDocumentProvider = z.infer<typeof aiDocumentProviderSchema>;
export const aiDocumentModeSchema = z.enum(['fallback', 'always']);
/** OCR languages: BCP 47 tags such as `en`, `zh-TW`, `ja`. */
const languageTag = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'Not a language tag');
export const maskCategorySchema = z.enum(['email', 'phone', 'ip', 'card', 'id', 'secret']);
export type MaskCategory = z.infer<typeof maskCategorySchema>;

/** RFC 9110 field-name characters. */
export const AI_HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/;
/** Headers the platform sets itself (or the transport owns); custom headers may not replace them. */
export const AI_RESERVED_HEADERS = [
  'host',
  'content-length',
  'content-type',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'proxy-connection',
] as const;
export const MAX_AI_HEADERS = 20;

/**
 * A custom header sent to an AI endpoint (a gateway's tenant or routing header, a proxy token). Values may carry
 * credentials, so they are stored sealed and never returned: `value` omitted on update keeps the stored one.
 */
export const aiHeaderInputSchema = z.object({
  name: z
    .string()
    .trim()
    .regex(AI_HEADER_NAME_RE, 'Not a valid header name')
    .refine((n) => !(AI_RESERVED_HEADERS as readonly string[]).includes(n.toLowerCase()), 'Reserved header'),
  value: z
    .string()
    .max(2000)
    .refine((v) => !/[\r\n\0]/.test(v), 'Line breaks are not allowed')
    .optional(),
});
export type AiHeaderInput = z.input<typeof aiHeaderInputSchema>;

export const aiHeadersInputSchema = z
  .array(aiHeaderInputSchema)
  .max(MAX_AI_HEADERS)
  .refine(
    (list) => new Set(list.map((h) => h.name.trim().toLowerCase())).size === list.length,
    'Each header may appear once',
  );

/** What the admin UI sees of a stored header: its name only. */
export const aiHeaderInfoSchema = z.object({ name: z.string() });

/** What every signed-in user may know about the AI setup (features show their mode from it). */
export const aiStatusSchema = z.object({
  chat: z.object({
    available: z.boolean(),
    provider: aiChatProviderSchema,
    model: z.string().nullable(),
  }),
  embeddings: z.object({
    provider: aiEmbeddingProviderSchema,
    model: z.string(),
    dimensions: z.number().int(),
  }),
  vectorStore: z.enum(['pgvector', 'portable']),
});
export type AiStatusInfo = z.input<typeof aiStatusSchema>;

/** Administration → AI. Secrets are never returned: `hasApiKey` tells whether one is stored. */
export const aiConfigSchema = z.object({
  chat: z.object({
    provider: aiChatProviderSchema,
    baseUrl: z.string(),
    model: z.string(),
    hasApiKey: z.boolean(),
    inputPrice: z.number(),
    outputPrice: z.number(),
    /** The model used when `model` is empty (provider default). */
    defaultModel: z.string().nullable(),
    /** OpenAI-compatible only: Chat Completions or the Responses API. */
    apiStyle: aiApiStyleSchema,
    headers: z.array(aiHeaderInfoSchema),
    /** TLS certificates are not verified (self-signed gateways); audited and shown as a warning. */
    insecureTls: z.boolean(),
  }),
  embeddings: z.object({
    provider: aiEmbeddingProviderSchema,
    baseUrl: z.string(),
    model: z.string(),
    hasApiKey: z.boolean(),
    dimensions: z.number().int(),
    price: z.number(),
    headers: z.array(aiHeaderInfoSchema),
    insecureTls: z.boolean(),
  }),
  rerank: z.object({
    provider: aiRerankProviderSchema,
    baseUrl: z.string(),
    model: z.string(),
    hasApiKey: z.boolean(),
    /** USD per 1 000 searches. */
    price: z.number(),
    headers: z.array(aiHeaderInfoSchema),
    insecureTls: z.boolean(),
  }),
  documents: z.object({
    enabled: z.boolean(),
    provider: aiDocumentProviderSchema,
    baseUrl: z.string(),
    model: z.string(),
    hasApiKey: z.boolean(),
    headers: z.array(aiHeaderInfoSchema),
    insecureTls: z.boolean(),
    mode: aiDocumentModeSchema,
    /** USD per 1 000 pages. */
    price: z.number(),
    languages: z.array(z.string()),
    maxPages: z.number().int(),
  }),
  masking: z.object({ enabled: z.boolean(), categories: z.array(maskCategorySchema), custom: z.string() }),
  monthlyBudgetUsd: z.number(),
  spentThisMonthUsd: z.number(),
});
export type AiConfigInfo = z.input<typeof aiConfigSchema>;

const url = z
  .string()
  .trim()
  .max(500)
  .refine((v) => !v || /^https?:\/\/[^\s]+$/i.test(v), 'Enter an http(s) URL');

export const updateAiConfigSchema = z.object({
  chat: z
    .object({
      provider: aiChatProviderSchema,
      baseUrl: url,
      model: z.string().trim().max(150),
      /** Omit to keep the stored key; empty string removes it. */
      apiKey: z.string().max(500).optional(),
      inputPrice: z.number().min(0).max(1000),
      outputPrice: z.number().min(0).max(1000),
      apiStyle: aiApiStyleSchema,
      /** Replaces the list; a header without `value` keeps its stored value. Omit to keep all. */
      headers: aiHeadersInputSchema,
      insecureTls: z.boolean(),
    })
    .partial()
    .optional(),
  embeddings: z
    .object({
      provider: aiEmbeddingProviderSchema,
      baseUrl: url,
      model: z.string().trim().max(150),
      apiKey: z.string().max(500).optional(),
      dimensions: z.number().int().min(0).max(4000),
      price: z.number().min(0).max(1000),
      headers: aiHeadersInputSchema,
      insecureTls: z.boolean(),
    })
    .partial()
    .optional(),
  rerank: z
    .object({
      provider: aiRerankProviderSchema,
      baseUrl: url,
      model: z.string().trim().max(150),
      apiKey: z.string().max(500).optional(),
      price: z.number().min(0).max(1000),
      headers: aiHeadersInputSchema,
      insecureTls: z.boolean(),
    })
    .partial()
    .optional(),
  documents: z
    .object({
      enabled: z.boolean(),
      provider: aiDocumentProviderSchema,
      baseUrl: url,
      model: z.string().trim().max(150),
      apiKey: z.string().max(500).optional(),
      headers: aiHeadersInputSchema,
      insecureTls: z.boolean(),
      mode: aiDocumentModeSchema,
      price: z.number().min(0).max(1000),
      languages: z.array(languageTag).min(1).max(8),
      maxPages: z.number().int().min(1).max(2000),
    })
    .partial()
    .optional(),
  masking: z
    .object({
      enabled: z.boolean(),
      categories: z.array(maskCategorySchema),
      /** One regular expression per line. */
      custom: z.string().max(5000),
    })
    .partial()
    .optional(),
  monthlyBudgetUsd: z.number().min(0).max(1_000_000).optional(),
});
export type UpdateAiConfigInput = z.input<typeof updateAiConfigSchema>;

export const aiTestResultSchema = z.object({
  chat: z.object({
    ok: z.boolean(),
    model: z.string().nullable(),
    latencyMs: z.number().int(),
    error: z.string().optional(),
  }),
  embeddings: z.object({
    ok: z.boolean(),
    dimensions: z.number().int(),
    latencyMs: z.number().int(),
    error: z.string().optional(),
  }),
  /** Null when no reranker is configured. */
  rerank: z.object({ ok: z.boolean(), latencyMs: z.number().int(), error: z.string().optional() }).nullable(),
  /** Null when no document-extraction service is configured (a one-page PDF is sent). */
  documents: z
    .object({ ok: z.boolean(), latencyMs: z.number().int(), error: z.string().optional() })
    .nullable(),
});
export type AiTestResult = z.input<typeof aiTestResultSchema>;

export const aiUsageQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

export const aiUsageReportSchema = z.object({
  days: z.number().int(),
  totals: z.object({
    calls: z.number().int(),
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
    costUsd: z.number(),
    errors: z.number().int(),
    blocked: z.number().int(),
    masked: z.number().int(),
    toolCalls: z.number().int(),
  }),
  /** One point per day (UTC). */
  daily: z.array(z.object({ date: z.string(), calls: z.number().int(), costUsd: z.number() })),
  byFeature: z.array(
    z.object({
      moduleId: z.string(),
      feature: z.string(),
      calls: z.number().int(),
      inputTokens: z.number().int(),
      outputTokens: z.number().int(),
      costUsd: z.number(),
      avgLatencyMs: z.number().nullable(),
      errors: z.number().int(),
    }),
  ),
  byModel: z.array(
    z.object({
      provider: z.string(),
      model: z.string().nullable(),
      calls: z.number().int(),
      costUsd: z.number(),
    }),
  ),
  recent: z.array(
    z.object({
      id: z.uuid(),
      feature: z.string(),
      kind: z.enum(['chat', 'embed', 'tool', 'rerank', 'extract']),
      principal: z.object({ type: z.string(), name: z.string().nullable() }),
      provider: z.string(),
      model: z.string().nullable(),
      inputTokens: z.number().int(),
      outputTokens: z.number().int(),
      costUsd: z.number(),
      latencyMs: z.number().int().nullable(),
      status: z.enum(['ok', 'error', 'refused', 'blocked']),
      error: z.string().nullable(),
      masked: z.number().int(),
      createdAt: dateTime,
    }),
  ),
});
export type AiUsageReport = z.input<typeof aiUsageReportSchema>;

export const aiIndexInfoSchema = z.object({
  vectorStore: z.enum(['pgvector', 'portable']),
  embeddingModel: z.string(),
  types: z.array(
    z.object({ type: z.string(), model: z.string(), documents: z.number().int(), chunks: z.number().int() }),
  ),
  /** Documents still embedded with another model (re-embedded in the background). */
  stale: z.number().int(),
  /** Attachments of indexed records that index them (`attachments`), by extraction state. */
  attachments: z.object({
    files: z.number().int(),
    searchable: z.number().int(),
    waiting: z.number().int(),
    needsOcr: z.number().int(),
    unsupported: z.number().int(),
    failed: z.number().int(),
    pages: z.number().int(),
  }),
});
export type AiIndexInfo = z.input<typeof aiIndexInfoSchema>;
