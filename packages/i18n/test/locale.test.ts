import { describe, expect, it } from 'vitest';
import { negotiateLocale, normalizeLocale } from '../src/index';

describe('locale negotiation', () => {
  it.each([
    ['zh-TW,zh;q=0.9,en;q=0.8', 'zh-TW'],
    ['zh-Hant-HK', 'zh-TW'],
    ['ja,en-US;q=0.8', 'ja-JP'],
    ['en-GB,en;q=0.9', 'en'],
    ['fr-FR,de;q=0.9', 'en'],
    ['zh-CN,ja;q=0.5', 'ja-JP'],
    ['de;q=0.9,ja;q=0.95', 'ja-JP'],
    ['', 'en'],
  ])('%s → %s', (header, expected) => {
    expect(negotiateLocale(header)).toBe(expected);
  });

  it('does not map Simplified Chinese onto Traditional', () => {
    expect(normalizeLocale('zh-Hans')).toBeNull();
    expect(normalizeLocale('zh-CN')).toBeNull();
  });
});
