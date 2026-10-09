import type { AiTicket } from '@isbp/module-itsm/contracts';
import { describe, expect, it } from 'vitest';
import type { MessageRow } from '../src/server/schema';
import {
  builtinKbDraft,
  builtinRationale,
  builtinReply,
  extractiveSummary,
  rankOpenIncidents,
  withSources,
} from '../src/server/assist';
import {
  builtinAnswer,
  builtinProposal,
  chatSystemPrompt,
  displayContent,
  proposalFromCall,
  retrying,
  toDisplayMessages,
} from '../src/server/chat';
import { joinList, text } from '../src/server/text';

const ticket: AiTicket = {
  id: '00000000-0000-4000-8000-000000000001',
  reference: 'INC-00042',
  type: 'incident',
  title: 'VPN drops every few minutes',
  description: 'Since Monday the VPN disconnects. I restarted my laptop. It did not help.',
  status: 'resolved',
  priority: 3,
  impact: 2,
  urgency: 2,
  category: { id: '00000000-0000-4000-8000-0000000000c1', key: 'vpn', path: 'Network › VPN' },
  assignmentGroup: { id: '00000000-0000-4000-8000-0000000000a1', key: 'network', name: 'Network team' },
  assignee: { id: '00000000-0000-4000-8000-0000000000b1', displayName: 'Ken' },
  requester: { id: '00000000-0000-4000-8000-0000000000b2', displayName: '佐藤 美咲', locale: 'ja-JP' },
  cis: [{ id: '00000000-0000-4000-8000-0000000000d1', name: 'GlobalProtect' }],
  resolutionCode: 'solved',
  resolutionNotes: 'Updated the GlobalProtect client to 6.2. The drops stopped.',
  href: '/itsm/tickets/INC-00042',
  createdAt: '2026-10-01T01:00:00Z',
  updatedAt: '2026-10-02T01:00:00Z',
  resolvedAt: '2026-10-02T01:00:00Z',
  activities: [
    {
      kind: 'comment',
      public: true,
      author: '佐藤 美咲',
      body: 'Still happening today.',
      at: '2026-10-01T02:00:00Z',
    },
    {
      kind: 'work_note',
      public: false,
      author: 'Ken',
      body: 'Root cause: old client build with a keep-alive bug.',
      at: '2026-10-01T03:00:00Z',
    },
    { kind: 'status', public: true, author: 'Ken', body: 'Resolved', at: '2026-10-02T01:00:00Z' },
  ],
};

const kb = {
  n: 1,
  id: 'a1',
  reference: 'KB-00007',
  title: 'Fix VPN disconnects',
  href: '/knowledge/KB-00007',
};

describe('server texts', () => {
  it('interpolates catalog templates in each locale', () => {
    expect(text('en', 'chat', 'ticketCreated', { reference: 'INC-1' })).toContain('INC-1');
    expect(text('ja-JP', 'reply', 'greeting', { name: '佐藤' })).toBe('佐藤 様');
    expect(joinList('en', ['A', 'B', 'C'])).toBe('A, B and C');
    expect(joinList('zh-TW', ['A', 'B'])).toBe('A、B');
  });
});

describe('builtin reply draft', () => {
  it("greets in the requester's language, names the article, quotes its numbered steps and links it", () => {
    const body = '## Steps\n1. Quit GlobalProtect.\n2. Install version 6.2.\n3. Sign in again.';
    const reply = builtinReply('ja-JP', ticket, kb, body);
    expect(reply.startsWith('佐藤 美咲 様')).toBe(true);
    expect(reply).toContain('「VPN drops every few minutes」');
    expect(reply).toContain('1. Quit GlobalProtect.\n2. Install version 6.2.\n3. Sign in again.');
    expect(reply).toContain('[KB-00007 Fix VPN disconnects](/knowledge/KB-00007)');
  });

  it('asks a clarifying question when no article matches', () => {
    const reply = builtinReply('en', { ...ticket, requester: null }, null, null);
    expect(reply.startsWith('Hi,')).toBe(true);
    expect(reply).toContain('exact error message');
  });

  it('appends a sources list only for cited articles', () => {
    expect(withSources('Restart [1].', [kb], 'Sources:')).toBe(
      'Restart [1].\n\nSources:\n[1] [KB-00007 Fix VPN disconnects](/knowledge/KB-00007)',
    );
    expect(withSources('No citations.', [kb], 'Sources:')).toBe('No citations.');
  });
});

describe('extractive summary and KB draft', () => {
  it('summarises issue, latest updates (newest first) and current state', () => {
    const s = extractiveSummary(ticket);
    expect(s.issue).toBe('Since Monday the VPN disconnects. I restarted my laptop.');
    expect(s.updates.map((u) => u.kind)).toEqual(['status', 'work_note', 'comment']);
    expect(s.state).toMatchObject({
      status: 'resolved',
      priority: 3,
      group: 'Network team',
      assignee: 'Ken',
    });
  });

  it('builds Symptoms / Cause / Resolution / Applies to from the ticket', () => {
    const d = builtinKbDraft('en', ticket);
    expect(d.title).toBe(ticket.title);
    expect(d.body).toMatch(
      /## Symptoms\n\nSince Monday[\s\S]*## Cause\n\nRoot cause: old client build[\s\S]*## Resolution\n\nUpdated the GlobalProtect client[\s\S]*## Applies to/,
    );
    expect(d.body).toContain('- Category: Network › VPN');
    expect(d.body).toContain('[INC-00042](/itsm/tickets/INC-00042)');
    expect(builtinKbDraft('zh-TW', { ...ticket, activities: [] }).body).toContain(
      '## 原因\n\n工單中未記錄原因',
    );
  });

  it('names the most similar tickets in the rationale', () => {
    const r = builtinRationale(
      'en',
      [
        {
          id: '1',
          reference: 'INC-00001',
          title: '',
          similarity: 0.91,
          categoryId: null,
          assignmentGroupId: null,
          impact: 2,
          urgency: 2,
          resolutionCode: null,
          href: null,
        },
        {
          id: '2',
          reference: 'INC-00002',
          title: '',
          similarity: 0.8,
          categoryId: null,
          assignmentGroupId: null,
          impact: 2,
          urgency: 2,
          resolutionCode: null,
          href: null,
        },
      ],
      ['urgent'],
    );
    expect(r).toBe(
      'Most similar resolved tickets: INC-00001 (91%) and INC-00002 (80%). Raised by keywords: “urgent”.',
    );
  });
});

describe('virtual agent (builtin parts)', () => {
  it('leads into the article cards without repeating them, and offers a ticket when nothing was found', () => {
    const a = builtinAnswer('en', [{ ...kb, snippet: 'Update the client.' }], true);
    expect(a).toBe("Here's what I found in the knowledge base:");
    expect(builtinAnswer('zh-TW', [], false)).toBe('我找不到符合這個問題的知識庫文章。');
    expect(builtinAnswer('en', [], true)).toContain('I can raise a ticket');
  });

  it('prefills a plain-text proposal from the first message (title) and the conversation (description)', () => {
    const p = builtinProposal(
      'en',
      ["I can't work: Outlook crashes on start\nsince the update", 'Safe mode crashes too'],
      [kb],
    );
    expect(p.title).toBe("I can't work: Outlook crashes on start");
    expect(p.description).toBe(
      [
        'Raised from Ask IT.',
        'What I described:',
        "I can't work: Outlook crashes on start since the update",
        'Safe mode crashes too',
        "Ask IT suggested “Fix VPN disconnects” (KB-00007), but that didn't solve it.",
      ].join('\n\n'),
    );
    expect(p.description).not.toMatch(/\*\*|^- /m);
    expect(builtinProposal('ja-JP', ['VPN が切れる'], [kb]).description).toContain(
      '「Fix VPN disconnects」(KB-00007)',
    );
    expect(p.urgency).toBe(1);
    expect(p.type).toBe('incident');
    expect(builtinProposal('zh-TW', ['我需要申請 SAP 權限'], []).type).toBe('service_request');
  });

  it("turns a model's create-ticket call into a proposal, falling back field by field", () => {
    const fallback = builtinProposal('en', ['VPN broken'], []);
    expect(
      proposalFromCall(
        { title: 'VPN fails with error 809', description: 'Tried rebooting', urgency: 1, type: 'incident' },
        fallback,
      ),
    ).toEqual({
      title: 'VPN fails with error 809',
      description: 'Tried rebooting',
      urgency: 1,
      type: 'incident',
    });
    expect(proposalFromCall({ title: 'x', urgency: 9 }, fallback)).toEqual(fallback);
  });

  it('keeps the system prompt on IT topics, grounded, confidential and in the right language', () => {
    const s = chatSystemPrompt('ja-JP', [{ ...kb, snippet: 'Update the client.' }], {
      canPropose: true,
      nudge: true,
      tools: ['itsm.my_tickets'],
    });
    expect(s).toContain('Only help with IT');
    expect(s).toContain('Never reveal');
    expect(s).toContain('[1] KB-00007 — Fix VPN disconnects');
    expect(s).toContain('end this answer by proposing a ticket');
    expect(s).toContain('Reply in Japanese.');
  });

  it('shows one bubble per answer: tool turns hidden, assistant rounds merged', () => {
    const row = (seq: number, r: Partial<MessageRow>): MessageRow =>
      ({
        id: `m${seq}`,
        conversationId: 'c',
        seq,
        role: 'user',
        content: '',
        citations: [],
        proposal: null,
        native: null,
        toolCalls: null,
        toolCallId: null,
        isError: false,
        mode: null,
        model: null,
        createdAt: new Date(0),
        ...r,
      }) as MessageRow;
    const shown = toDisplayMessages([
      row(0, { role: 'user', content: 'VPN?' }),
      row(1, { role: 'assistant', content: 'Let me check.', mode: 'llm' }),
      row(2, { role: 'tool', content: '{}' }),
      row(3, { role: 'assistant', content: 'Do this [1].', citations: [kb], mode: 'llm', model: 'm' }),
    ]);
    expect(shown).toHaveLength(2);
    expect(shown[1]).toMatchObject({
      id: 'm3',
      content: 'Let me check.\n\nDo this [1].',
      citations: [kb],
      model: 'm',
    });
    // A message after a finished answer ("I've raised …") is its own bubble.
    const escalated = toDisplayMessages([
      row(0, { role: 'user', content: 'VPN?' }),
      row(1, { role: 'assistant', content: "Here's what I found", citations: [kb], mode: 'builtin' }),
      row(2, { role: 'assistant', content: "I've raised INC-00001 for you.", mode: 'builtin' }),
    ]);
    expect(escalated.map((m) => m.content)).toEqual([
      'VPN?',
      "Here's what I found",
      "I've raised INC-00001 for you.",
    ]);
  });

  it('drops the article list older builtin answers repeated in their text (the cards show them)', () => {
    const legacy = [
      "Here's what I found in the knowledge base:",
      '- **[1]** [Fix VPN disconnects](/knowledge/KB-00007) — Update the client.',
      text('en', 'chat', 'offerTicket'),
    ].join('\n\n');
    expect(displayContent({ content: legacy, mode: 'builtin', citations: [kb] })).toBe(
      "Here's what I found in the knowledge base:",
    );
    // Model answers and answers without sources keep their text.
    expect(displayContent({ content: legacy, mode: 'llm', citations: [kb] })).toBe(legacy);
    expect(displayContent({ content: 'Nothing found.', mode: 'builtin', citations: [] })).toBe(
      'Nothing found.',
    );
  });

  it('retries a failing step and gives up after the last attempt', async () => {
    let calls = 0;
    await expect(
      retrying(3, async () => {
        calls++;
        if (calls < 3) throw new Error('busy');
        return 'ok';
      }),
    ).resolves.toBe('ok');
    expect(calls).toBe(3);
    calls = 0;
    await expect(
      retrying(2, async () => {
        calls++;
        throw new Error('down');
      }),
    ).rejects.toThrow('down');
    expect(calls).toBe(2);
  });
});

describe('similar open incidents on a problem', () => {
  const t = (id: string, title: string) => ({
    id,
    reference: `INC-0000${id}`,
    type: 'incident' as const,
    title,
    status: 'in_progress' as const,
    priority: 3,
    requester: null,
    assignee: null,
    updatedAt: '2026-10-01T00:00:00Z',
    resolutionNotes: null,
    href: `/itsm/tickets/INC-0000${id}`,
  });

  it('ranks by embedding similarity, best first, and leaves out weak matches', () => {
    const ranked = rankOpenIncidents(
      [t('1', 'Printer jam'), t('2', 'VPN drops'), t('3', 'VPN slow')],
      [1, 0],
      [
        [0.1, 0.99],
        [0.95, 0.31],
        [0.6, 0.8],
      ],
    );
    expect(ranked.map((r) => r.reference)).toEqual(['INC-00002', 'INC-00003']);
    expect(ranked[0]).toMatchObject({ status: 'in_progress', type: 'incident', resolutionCode: null });
    expect(ranked[0]!.similarity).toBeCloseTo(0.95);
  });
});
