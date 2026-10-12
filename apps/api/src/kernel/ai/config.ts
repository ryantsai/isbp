import type { AiApiStyle } from '@isbp/contracts';
import { type AiConnection, type AiHeader, parseHeaders } from './connection';
import { BUILTIN_DIMENSIONS, BUILTIN_MODEL } from './embedder';
import { MASK_CATEGORIES, type MaskCategory, parseCustomPatterns } from './masking';

/** Default chat model per provider when the admin leaves the model empty. */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';

/** USD per million tokens [input, output] for known models; admins can override per deployment. */
const KNOWN_PRICES: Record<string, [number, number]> = {
  'claude-fable-5-1': [10, 50],
  'claude-opus-5-5': [4, 20],
  'claude-opus-5': [5, 25],
  'claude-opus-4-8': [5, 25],
  'claude-sonnet-5-5': [2, 10],
  'claude-sonnet-5': [2, 10],
  'claude-sonnet-4-6': [3, 15],
  'claude-haiku-4-5': [1, 5],
};

export interface AiConfig {
  chat:
    | { provider: 'none' }
    | {
        provider: 'anthropic' | 'openai-compatible';
        baseUrl: string | null;
        apiKey: string | null;
        model: string;
        prices: [input: number, output: number];
        /** OpenAI-compatible wire format (Anthropic ignores it). */
        apiStyle: AiApiStyle;
        headers: AiHeader[];
        insecureTls: boolean;
      };
  embeddings: {
    provider: 'builtin' | 'openai-compatible';
    baseUrl: string | null;
    apiKey: string | null;
    model: string;
    dimensions: number;
    price: number;
    headers: AiHeader[];
    insecureTls: boolean;
  };
  masking: { enabled: boolean; categories: MaskCategory[]; custom: RegExp[] };
  monthlyBudgetUsd: number;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** The connection options of one section (`ai.chat`, `ai.embeddings`, …) as stored in settings. */
export function readConnection(s: Record<string, unknown>, section: string, baseUrl: string): AiConnection {
  return {
    baseUrl,
    apiKey: str(s[`ai.${section}.apiKey`]),
    headers: parseHeaders(s[`ai.${section}.headers`]),
    insecureTls: s[`ai.${section}.insecureTls`] === true,
  };
}

/** A configured section's connection (the base URL is known to be set). */
export function connectionOf(c: {
  baseUrl: string | null;
  apiKey: string | null;
  headers: AiHeader[];
  insecureTls: boolean;
}): AiConnection {
  return { baseUrl: c.baseUrl ?? '', apiKey: c.apiKey, headers: c.headers, insecureTls: c.insecureTls };
}

/** Builds the effective configuration from core settings (`ai.*`). */
export function readAiConfig(s: Record<string, unknown>): AiConfig {
  const chatProvider = s['ai.chat.provider'];
  let chat: AiConfig['chat'] = { provider: 'none' };
  if (chatProvider === 'anthropic' || chatProvider === 'openai-compatible') {
    const model = str(s['ai.chat.model']) ?? (chatProvider === 'anthropic' ? DEFAULT_ANTHROPIC_MODEL : null);
    const baseUrl = str(s['ai.chat.baseUrl']);
    if (model && (chatProvider === 'anthropic' || baseUrl)) {
      const known = KNOWN_PRICES[model] ?? [0, 0];
      const conn = readConnection(s, 'chat', baseUrl ?? '');
      chat = {
        provider: chatProvider,
        baseUrl,
        apiKey: conn.apiKey,
        model,
        prices: [num(s['ai.chat.inputPrice'], 0) || known[0], num(s['ai.chat.outputPrice'], 0) || known[1]],
        apiStyle: s['ai.chat.apiStyle'] === 'responses' ? 'responses' : 'chat-completions',
        headers: conn.headers,
        insecureTls: conn.insecureTls,
      };
    }
  }
  const embedProvider = s['ai.embeddings.provider'] === 'openai-compatible' ? 'openai-compatible' : 'builtin';
  const embedBase = str(s['ai.embeddings.baseUrl']);
  const embedModel = str(s['ai.embeddings.model']);
  const embeddings: AiConfig['embeddings'] =
    embedProvider === 'openai-compatible' && embedBase && embedModel
      ? {
          provider: 'openai-compatible',
          ...readConnection(s, 'embeddings', embedBase),
          model: embedModel,
          dimensions: num(s['ai.embeddings.dimensions'], 0),
          price: num(s['ai.embeddings.price'], 0),
        }
      : {
          provider: 'builtin',
          baseUrl: null,
          apiKey: null,
          model: BUILTIN_MODEL,
          dimensions: BUILTIN_DIMENSIONS,
          price: 0,
          headers: [],
          insecureTls: false,
        };
  const categories = (str(s['ai.masking.categories']) ?? MASK_CATEGORIES.join(','))
    .split(',')
    .map((c) => c.trim())
    .filter((c): c is MaskCategory => (MASK_CATEGORIES as readonly string[]).includes(c));
  return {
    chat,
    embeddings,
    masking: {
      enabled: s['ai.masking.enabled'] !== false,
      categories,
      custom: parseCustomPatterns(str(s['ai.masking.custom'])),
    },
    monthlyBudgetUsd: num(s['ai.budget.monthlyUsd'], 0),
  };
}

export function costOf(prices: [number, number], input: number, output: number): number {
  return (input * prices[0] + output * prices[1]) / 1_000_000;
}
