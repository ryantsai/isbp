import { describe, expect, it } from 'vitest';
import { chunkText } from '../../src/kernel/ai/chunk';
import { DEFAULT_ANTHROPIC_MODEL, costOf, readAiConfig } from '../../src/kernel/ai/config';
import { BUILTIN_DIMENSIONS, builtinEmbed, cosine, stem } from '../../src/kernel/ai/embedder';
import { plainText, textArray } from '../../src/kernel/ai/index-store';
import { idf, queryTerms, searchTerms } from '../../src/kernel/ai/terms';
import { Masker, MASK_CATEGORIES, parseCustomPatterns } from '../../src/kernel/ai/masking';
import { wireName } from '../../src/kernel/ai/tools';

describe('builtin embedder', () => {
  it('is deterministic, unit-length and 384-dimensional', () => {
    const a = builtinEmbed('VPN keeps disconnecting');
    expect(a).toHaveLength(BUILTIN_DIMENSIONS);
    expect(builtinEmbed('VPN keeps disconnecting')).toEqual(a);
    expect(cosine(a, a)).toBeCloseTo(1, 5);
  });

  it('ranks related help-desk texts above unrelated ones', () => {
    const q = builtinEmbed('my vpn connection drops every few minutes');
    const related = builtinEmbed('VPN disconnects frequently when working from home');
    const unrelated = builtinEmbed('Printer on floor 3 is out of toner');
    expect(cosine(q, related)).toBeGreaterThan(cosine(q, unrelated));
  });

  it('stems English words lightly', () => {
    expect(['dropping', 'drops', 'dropped'].map(stem)).toEqual(['drop', 'drop', 'drop']);
    expect(['printers', 'printing', 'printer'].map(stem)).toEqual(['print', 'print', 'print']);
    expect(['access', 'install', 'vpn', 'status', 'policies'].map(stem)).toEqual([
      'access',
      'install',
      'vpn',
      'status',
      'policy',
    ]);
  });

  it('works for Chinese and Japanese text via character n-grams', () => {
    const zh = builtinEmbed('VPN 連線一直斷線');
    const zhRelated = builtinEmbed('從家裡連 VPN 常常斷線怎麼辦');
    const zhOther = builtinEmbed('印表機卡紙');
    expect(cosine(zh, zhRelated)).toBeGreaterThan(cosine(zh, zhOther));
    const ja = builtinEmbed('パスワードをリセットしたい');
    const jaRelated = builtinEmbed('パスワードのリセット方法');
    const jaOther = builtinEmbed('会議室のプロジェクターが映らない');
    expect(cosine(ja, jaRelated)).toBeGreaterThan(cosine(ja, jaOther));
  });
});

describe('masking', () => {
  const all = new Masker({ categories: [...MASK_CATEGORIES] });

  it('replaces personal data with stable placeholders and restores them', () => {
    const text =
      'Contact jane.doe@example.com or +886 2 1234 5678 from 10.0.4.17. Card 4111 1111 1111 1111, ID A123456789.';
    const masked = all.mask(text);
    expect(masked).not.toContain('jane.doe@example.com');
    expect(masked).not.toContain('10.0.4.17');
    expect(masked).not.toContain('4111 1111 1111 1111');
    expect(masked).not.toContain('A123456789');
    expect(masked).not.toContain('1234 5678');
    expect(masked).toContain('[EMAIL_1]');
    expect(all.mask('again jane.doe@example.com')).toBe('again [EMAIL_1]');
    expect(all.unmask(masked)).toBe(text);
  });

  it('masks secrets but keeps dates, times, versions and ticket numbers', () => {
    const m = new Masker({ categories: [...MASK_CATEGORIES] });
    const text =
      'On 2026-10-06 at 09:30 VPN client 10.0.19045.3803 failed (INC-00042). password: hunter2secret, key sk-ant-api03-abcdefghijklmnop';
    const masked = m.mask(text);
    expect(masked).toContain('2026-10-06');
    expect(masked).toContain('09:30');
    expect(masked).toContain('INC-00042');
    expect(masked).not.toContain('hunter2secret');
    expect(masked).not.toContain('sk-ant-api03-abcdefghijklmnop');
  });

  it('only masks enabled categories, plus custom patterns', () => {
    const m = new Masker({ categories: ['email'], custom: parseCustomPatterns('EMP-\\d{5}\n[invalid') });
    const masked = m.mask('jane@example.com from 10.0.0.1, employee EMP-12345');
    expect(masked).toContain('10.0.0.1');
    expect(masked).toContain('[EMAIL_1]');
    expect(masked).toContain('[REDACTED_1]');
    expect(m.count).toBe(2);
  });

  it('ignores numbers that fail the Luhn check', () => {
    expect(new Masker({ categories: ['card'] }).mask('order 1234 5678 9012 3456')).toContain(
      '1234 5678 9012 3456',
    );
  });
});

describe('chunking', () => {
  it('splits Markdown on headings and carries the heading into each chunk', () => {
    const body = `## Symptoms\n${'The VPN drops. '.repeat(70)}\n\n## Fix\n1. Update the client.\n2. Restart.`;
    const chunks = chunkText('VPN drops', body);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.text.startsWith('VPN drops\n'))).toBe(true);
    expect(chunks.some((c) => c.text.includes('Fix\n1. Update the client.'))).toBe(true);
    expect(chunks.map((c) => c.no)).toEqual(chunks.map((_, i) => i));
  });

  it('cuts long CJK paragraphs on sentence boundaries', () => {
    const chunks = chunkText('密碼', '請先開啟設定。'.repeat(200));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.text.length < 1200)).toBe(true);
  });

  it('returns the title alone for empty text', () => {
    expect(chunkText('Only a title', '')).toEqual([{ no: 0, text: 'Only a title' }]);
  });
});

describe('snippets', () => {
  it('strip Markdown syntax but keep the words', () => {
    expect(
      plainText(
        '## Steps\n1. Open **Settings** → *Connection*\n> **Tip:** use [the portal](https://x.example)\n- `vpn --reset`',
      ),
    ).toBe('Steps\nOpen Settings → Connection\nTip: use the portal\nvpn --reset');
  });
});

describe('search terms', () => {
  it('keeps Latin words (stemmed, no stop words), CJK dictionary words and CJK bigrams', () => {
    expect(queryTerms('VPN is down')).toEqual(['vpn', 'down']);
    expect(queryTerms('vpn keeps dropping')).toEqual(['vpn', 'keep', 'drop']);
    expect(queryTerms('VPN 斷線')).toEqual(['斷線', 'vpn']);
    expect(queryTerms('パスワード')).toContain('スワ');
    // ICU word segmentation finds whole words; bigrams still match a differently split phrase.
    const zh = queryTerms('印表機無法列印');
    expect(zh).toEqual(expect.arrayContaining(['印表機', '無法', '列印', '印表', '表機']));
    expect(queryTerms('プリンターが印刷できない')).toEqual(expect.arrayContaining(['プリンター', '印刷']));
  });

  it('keeps identifiers whole as well as their parts', () => {
    const t = queryTerms('INC-1234 fails with 0x80070005 after KB5034441 on 10.1.2.3');
    expect(t.slice(0, 2)).toEqual(['inc-1234', '10.1.2.3']);
    expect(t).toEqual(expect.arrayContaining(['inc', '1234', '0x80070005', 'kb5034441']));
    // Prose with a dot is not an identifier.
    expect(queryTerms('e.g. reset it')).not.toContain('e.g');
  });

  it('indexes a chunk with the same rules (a query term is found in the text it came from)', () => {
    const text = 'VPN 連線一直斷線 — reinstall the GlobalProtect client (error 0x80070005).';
    const indexed = new Set(searchTerms(text));
    for (const t of queryTerms('VPN 斷線 globalprotect 0x80070005')) expect(indexed).toContain(t);
  });

  it('weights rare terms above common ones', () => {
    expect(idf(1, 1000)).toBeGreaterThan(idf(500, 1000));
    expect(idf(1000, 1000)).toBeGreaterThan(0);
  });

  it('builds array literals that survive quotes and backslashes', () => {
    expect(textArray(['a', 'b"c', 'd\\e'])).toBe('{"a","b\\"c","d\\\\e"}');
  });
});

describe('AI config', () => {
  it('defaults to no chat model and the builtin embedder', () => {
    const c = readAiConfig({});
    expect(c.chat.provider).toBe('none');
    expect(c.embeddings.provider).toBe('builtin');
    expect(c.masking.enabled).toBe(true);
    expect(c.masking.categories).toEqual([...MASK_CATEGORIES]);
  });

  it('uses the default Anthropic model and its known prices', () => {
    const c = readAiConfig({ 'ai.chat.provider': 'anthropic', 'ai.chat.apiKey': 'k' });
    expect(c.chat).toMatchObject({ provider: 'anthropic', model: DEFAULT_ANTHROPIC_MODEL, prices: [4, 20] });
    expect(costOf([4, 20], 1_000_000, 500_000)).toBeCloseTo(14);
  });

  it('needs a base URL and model for OpenAI-compatible providers', () => {
    expect(readAiConfig({ 'ai.chat.provider': 'openai-compatible' }).chat.provider).toBe('none');
    expect(
      readAiConfig({
        'ai.chat.provider': 'openai-compatible',
        'ai.chat.baseUrl': 'http://localhost:11434/v1',
        'ai.chat.model': 'llama3',
      }).chat.provider,
    ).toBe('openai-compatible');
  });
});

describe('tool names', () => {
  it('are made wire-safe for providers', () => {
    expect(wireName('itsm.create_ticket')).toBe('itsm__create_ticket');
    expect(wireName('helpdesk-ai.summarize')).toBe('helpdesk-ai__summarize');
  });
});
