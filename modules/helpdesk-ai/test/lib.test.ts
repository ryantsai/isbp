import { describe, expect, it } from 'vitest';
import {
  CitationRegistry,
  citationsIn,
  citedNumbers,
  RELEVANCE,
  relevantHits,
  teaser,
} from '../src/lib/citations';
import { type StoredTurn, toAiMessages } from '../src/lib/history';
import { detectLanguage, normalizeLocale } from '../src/lib/language';
import { extractNumberedSteps, firstSentence, plainText } from '../src/lib/markdown';
import { createSseParser, formatSse, toChatEvent } from '../src/lib/sse';

describe('extractNumberedSteps', () => {
  it('returns the first ordered list, keeping inline Markdown and joining continuation lines', () => {
    const md = [
      '# Fix VPN drops',
      '',
      'If the VPN disconnects, try this:',
      '',
      '1. Open **Settings › Network**.',
      '2. Turn off *Wi-Fi power saving*,',
      '   then restart the adapter.',
      '   - nested detail that is skipped',
      '3) Reconnect with [GlobalProtect](https://example.com/gp).',
      '',
      'Still failing?',
      '',
      '1. A second list that is ignored',
    ].join('\n');
    expect(extractNumberedSteps(md)).toEqual([
      'Open **Settings › Network**.',
      'Turn off *Wi-Fi power saving*, then restart the adapter.',
      'Reconnect with [GlobalProtect](https://example.com/gp).',
    ]);
  });

  it('continues loose lists across blank lines, ignores code fences and caps the count', () => {
    const md = '```\n1. not a step\n```\n\n1. One\n\n2. Two\n\n3. Three\n4. Four';
    expect(extractNumberedSteps(md, 3)).toEqual(['One', 'Two', 'Three']);
  });

  it('works for CJK articles and returns nothing without a numbered list', () => {
    expect(extractNumberedSteps('## 步驟\n1. 開啟「設定」\n2. 選擇「網路」')).toEqual([
      '開啟「設定」',
      '選擇「網路」',
    ]);
    expect(extractNumberedSteps('- a bullet\n- another')).toEqual([]);
  });
});

describe('plainText / firstSentence', () => {
  it('strips Markdown and cuts at the first sentence in any language', () => {
    expect(plainText('**Bold** and [a link](/x) with `code`')).toBe('Bold and a link with code');
    expect(firstSentence('The VPN drops. It started Monday.')).toBe('The VPN drops.');
    expect(firstSentence('VPN 一直斷線。從週一開始。')).toBe('VPN 一直斷線。');
    expect(firstSentence('a'.repeat(300), 10)).toHaveLength(10);
  });
});

describe('citations', () => {
  it('numbers sources on first sight and keeps numbers stable across turns', () => {
    const r = new CitationRegistry();
    const a = r.add({ id: '1', reference: 'KB-00001', title: 'VPN', href: '/knowledge/KB-00001' });
    const b = r.add({ id: '2', reference: 'KB-00002', title: 'MFA', href: '/knowledge/KB-00002' });
    expect([a.n, b.n]).toEqual([1, 2]);
    expect(r.add({ id: '1', reference: 'kb-00001', title: 'VPN', href: '/knowledge/KB-00001' }).n).toBe(1);

    const next = new CitationRegistry(r.all());
    expect(next.add({ reference: 'KB-00003', title: 'Wi-Fi', href: '/knowledge/KB-00003' }).n).toBe(3);
    expect(next.add({ reference: 'KB-00002', title: 'MFA', href: '/knowledge/KB-00002' }).n).toBe(2);
  });

  it('finds the numbers a text cites, not Markdown links', () => {
    expect(citedNumbers('Restart it [1]. Then sign in again [2][3], see [1, 4] and [docs](/x).')).toEqual([
      1, 2, 3, 4,
    ]);
    const r = new CitationRegistry();
    r.add({ reference: 'KB-1', title: 'a', href: '/a' });
    r.add({ reference: 'KB-2', title: 'b', href: '/b' });
    expect(citationsIn('Only [2] and an unknown [9]', r).map((c) => c.reference)).toEqual(['KB-2']);
  });
});

describe('relevance', () => {
  const hits = [0.12, 0.42, 0.28, 0.31, 0.21].map((similarity, i) => ({ id: i, similarity }));

  it('shows people only clearly relevant articles, close to the best one', () => {
    expect(relevantHits(hits, RELEVANCE.answer).map((h) => h.similarity)).toEqual([0.42, 0.31]);
    expect(relevantHits([{ similarity: 0.19 }, { similarity: 0.16 }], RELEVANCE.answer)).toEqual([]);
  });

  it('gives a model a looser, capped set', () => {
    expect(relevantHits(hits, RELEVANCE.context).map((h) => h.similarity)).toEqual([0.42, 0.31, 0.28]);
    expect(relevantHits(hits, RELEVANCE.context, 5)).toHaveLength(5);
  });

  it('builds Markdown-free teasers, preferring the summary', () => {
    expect(teaser({ summary: 'Fix the **VPN**.', snippet: 'x' })).toBe('Fix the VPN.');
    expect(
      teaser({ summary: '', snippet: '| Case | Fix |\n| --- | --- |\n| Lost phone | Call [the desk](/x) |' }),
    ).toBe('Case Fix Lost phone Call the desk');
    expect(teaser({ snippet: 'a'.repeat(300) }, 20)).toHaveLength(20);
  });
});

describe('Server-Sent Events', () => {
  it('formats one frame per event and parses frames split across chunks', () => {
    const wire =
      formatSse('delta', { text: 'Hello\nworld' }) +
      ': ping\n\n' +
      formatSse('citations', { items: [{ n: 1, reference: 'KB-1', title: 't', href: '/k' }] }) +
      formatSse('done', { messageId: 'm1', mode: 'builtin', model: null });
    expect(wire.startsWith('event: delta\ndata: {"text":"Hello\\nworld"}\n\n')).toBe(true);
    const events: unknown[] = [];
    const parser = createSseParser((raw) => events.push(toChatEvent(raw)));
    for (let i = 0; i < wire.length; i += 7) parser.push(wire.slice(i, i + 7));
    parser.flush();
    expect(events).toEqual([
      { event: 'delta', data: { text: 'Hello\nworld' } },
      { event: 'citations', data: { items: [{ n: 1, reference: 'KB-1', title: 't', href: '/k' }] } },
      { event: 'done', data: { messageId: 'm1', mode: 'builtin', model: null } },
    ]);
  });

  it('handles CRLF, multi-line data and drops unknown events or bad JSON', () => {
    const got: unknown[] = [];
    const p = createSseParser((raw) => got.push(raw));
    p.push('event: x\r\ndata: a\r\ndata: b\r\n\r\nretry: 5000\n\n');
    expect(got).toEqual([{ event: 'x', data: 'a\nb' }]);
    expect(toChatEvent({ event: 'x', data: '{}' })).toBeNull();
    expect(toChatEvent({ event: 'delta', data: '{oops' })).toBeNull();
  });
});

describe('stored turns → AiMessage', () => {
  const turn = (t: Partial<StoredTurn> & Pick<StoredTurn, 'role'>): StoredTurn => ({
    content: '',
    toolCalls: null,
    toolCallId: null,
    isError: false,
    native: null,
    ...t,
  });

  it('replays user, assistant (with native content) and tool turns in order', () => {
    const native = { provider: 'anthropic', model: 'm', content: [{ type: 'text', text: 'hi' }] };
    const msgs = toAiMessages([
      turn({ role: 'user', content: 'VPN?' }),
      turn({
        role: 'assistant',
        content: 'Let me look.',
        toolCalls: [{ id: 'c1', name: 'knowledge.search_articles', input: { query: 'vpn' } }],
        native,
      }),
      turn({ role: 'tool', toolCallId: 'c1', content: '{"items":[]}' }),
      turn({ role: 'assistant', content: 'Nothing found.', native }),
    ]);
    expect(msgs).toEqual([
      { role: 'user', content: 'VPN?' },
      {
        role: 'assistant',
        content: 'Let me look.',
        toolCalls: [{ id: 'c1', name: 'knowledge.search_articles', input: { query: 'vpn' } }],
        native,
      },
      { role: 'tool', toolCallId: 'c1', content: '{"items":[]}' },
      { role: 'assistant', content: 'Nothing found.', native },
    ]);
  });

  it('repairs an interrupted tool loop: unanswered calls and their native copy are dropped', () => {
    const native = { provider: 'anthropic', model: 'm', content: [] };
    const msgs = toAiMessages([
      turn({ role: 'user', content: 'q' }),
      turn({
        role: 'assistant',
        content: 'Checking',
        toolCalls: [
          { id: 'a', name: 'itsm.my_tickets', input: {} },
          { id: 'b', name: 'knowledge.get_article', input: {} },
        ],
        native,
      }),
      turn({ role: 'tool', toolCallId: 'a', content: '[]', isError: true }),
      turn({ role: 'tool', toolCallId: 'zzz', content: 'stray' }),
      turn({ role: 'assistant', content: '', toolCalls: [{ id: 'c', name: 'x', input: {} }] }),
      turn({ role: 'user', content: 'again' }),
    ]);
    expect(msgs).toEqual([
      { role: 'user', content: 'q' },
      {
        role: 'assistant',
        content: 'Checking',
        toolCalls: [{ id: 'a', name: 'itsm.my_tickets', input: {} }],
      },
      { role: 'tool', toolCallId: 'a', content: '[]', isError: true },
      { role: 'user', content: 'again' },
    ]);
  });
});

describe('language detection', () => {
  it.each([
    ['My VPN keeps dropping', 'en'],
    ['VPN 一直斷線，怎麼辦？', 'zh-TW'],
    ['VPN に接続できません', 'ja-JP'],
    ['会議室のプリンター', 'ja-JP'],
    ['印表機無法列印', 'zh-TW'],
    ['12345 !!!', 'ja-JP'],
  ])('%s → %s', (text, expected) => {
    expect(detectLanguage(text, 'ja-JP')).toBe(expected);
  });

  it('normalizes profile locales', () => {
    expect(normalizeLocale('zh-Hant-TW')).toBe('zh-TW');
    expect(normalizeLocale('ja')).toBe('ja-JP');
    expect(normalizeLocale('en-GB')).toBe('en');
    expect(normalizeLocale('fr-FR', 'ja-JP')).toBe('ja-JP');
    expect(normalizeLocale(null)).toBe('en');
  });
});
