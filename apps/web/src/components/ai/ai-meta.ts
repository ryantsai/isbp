'use client';

import { useFormatter } from 'next-intl';
import { useCallback } from 'react';

export const CONFIG_PATH = '/ai/config';
export const STATUS_PATH = '/ai/status';
export const USAGE_PATH = '/ai/usage';
export const INDEX_PATH = '/ai/index';
/** Every AI query (status, config, usage, index) starts with this prefix. */
export const AI_PREFIX = '/ai/';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';

/**
 * Suggested Claude models with their list prices (USD per million tokens, input / output). Mirrors the
 * gateway's known-price table for these models: a price left at 0 uses these.
 */
export const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', hint: 'opus', prices: [4, 20] },
  { id: 'claude-sonnet-5-5', hint: 'sonnet', prices: [2, 10] },
  { id: 'claude-haiku-4-5', hint: 'haiku', prices: [1, 5] },
] as const;

export function knownPrices(model: string): readonly [number, number] | null {
  const id = model.trim() || DEFAULT_ANTHROPIC_MODEL;
  return CLAUDE_MODELS.find((m) => m.id === id)?.prices ?? null;
}

/** Base URLs of common OpenAI-compatible chat endpoints (product names are never translated). */
export const CHAT_PRESETS = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  {
    id: 'azure',
    label: 'Azure OpenAI',
    baseUrl: 'https://<resource>.openai.azure.com/openai/deployments/<deployment>',
  },
  { id: 'ollama', label: 'Ollama', baseUrl: 'http://localhost:11434/v1' },
  { id: 'vllm', label: 'vLLM', baseUrl: 'http://localhost:8000/v1' },
  { id: 'lmstudio', label: 'LM Studio', baseUrl: 'http://localhost:1234/v1' },
] as const;

export const EMBEDDING_PRESETS = [
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'text-embedding-3-small',
    dimensions: 1536,
  },
  {
    id: 'voyage',
    label: 'Voyage AI',
    baseUrl: 'https://api.voyageai.com/v1',
    model: 'voyage-3.5',
    dimensions: 1024,
  },
  {
    id: 'ollama',
    label: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: 'nomic-embed-text',
    dimensions: 768,
  },
] as const;

/** `claude-opus-5-5` → "Claude Opus 5.5"; anything else is shown as configured. */
export function modelLabel(model: string | null | undefined): string {
  if (!model) return '';
  const m = /^claude-([a-z]+)-(\d+)-(\d+)$/.exec(model);
  if (!m) return model;
  const family = m[1]!;
  return `Claude ${family.charAt(0).toUpperCase()}${family.slice(1)} ${m[2]}.${m[3]}`;
}

/** USD with 4 decimals for small amounts (AI calls cost fractions of a cent) and 2 otherwise. */
export function useUsd() {
  const format = useFormatter();
  return useCallback(
    (value: number) => {
      const digits = value !== 0 && Math.abs(value) < 1 ? 4 : 2;
      return format.number(value, {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
    },
    [format],
  );
}

export const HTTP_URL_RE = /^https?:\/\/[^\s]+$/i;
