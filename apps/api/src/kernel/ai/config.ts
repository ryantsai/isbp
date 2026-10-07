import { MASK_CATEGORIES, type MaskCategory, parseCustomPatterns } from './masking';
import { BUILTIN_DIMENSIONS, BUILTIN_MODEL } from './embedder';

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
      };
  embeddings: {
    provider: 'builtin' | 'openai-compatible';
    baseUrl: string | null;
    apiKey: string | null;
    model: string;
    dimensions: number;
    price: number;
  };
  masking: { enabled: boolean; categories: MaskCategory[]; custom: RegExp[] };
  monthlyBudgetUsd: number;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Builds the effective configuration from core settings (`ai.*`). */
export function readAiConfig(s: Record<string, unknown>): AiConfig {
  const chatProvider = s['ai.chat.provider'];
  let chat: AiConfig['chat'] = { provider: 'none' };
  if (chatProvider === 'anthropic' || chatProvider === 'openai-compatible') {
    const model = str(s['ai.chat.model']) ?? (chatProvider === 'anthropic' ? DEFAULT_ANTHROPIC_MODEL : null);
    const baseUrl = str(s['ai.chat.baseUrl']);
    if (model && (chatProvider === 'anthropic' || baseUrl)) {
      const known = KNOWN_PRICES[model] ?? [0, 0];
      chat = {
        provider: chatProvider,
        baseUrl,
        apiKey: str(s['ai.chat.apiKey']),
        model,
        prices: [num(s['ai.chat.inputPrice'], 0) || known[0], num(s['ai.chat.outputPrice'], 0) || known[1]],
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
          baseUrl: embedBase,
          apiKey: str(s['ai.embeddings.apiKey']),
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
