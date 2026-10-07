import { z } from 'zod';
import { dateTime } from './common';

export const aiChatProviderSchema = z.enum(['none', 'anthropic', 'openai-compatible']);
export const aiEmbeddingProviderSchema = z.enum(['builtin', 'openai-compatible']);
export const maskCategorySchema = z.enum(['email', 'phone', 'ip', 'card', 'id', 'secret']);
export type MaskCategory = z.infer<typeof maskCategorySchema>;

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
  }),
  embeddings: z.object({
    provider: aiEmbeddingProviderSchema,
    baseUrl: z.string(),
    model: z.string(),
    hasApiKey: z.boolean(),
    dimensions: z.number().int(),
    price: z.number(),
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
      kind: z.enum(['chat', 'embed', 'tool']),
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
});
export type AiIndexInfo = z.input<typeof aiIndexInfoSchema>;
