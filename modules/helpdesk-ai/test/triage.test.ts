import type { AiTriageOptions } from '@isbp/module-itsm/contracts';
import { describe, expect, it } from 'vitest';
import {
  builtinTriage,
  keywordSignals,
  median,
  type Neighbour,
  validateSuggestion,
  weightedVote,
} from '../src/lib/triage';

const VPN = '00000000-0000-4000-8000-000000000001';
const MAIL = '00000000-0000-4000-8000-000000000002';
const HW = '00000000-0000-4000-8000-000000000003';
const NET = '00000000-0000-4000-8000-0000000000a1';
const DESK = '00000000-0000-4000-8000-0000000000a2';

const options: AiTriageOptions = {
  categories: [
    {
      id: VPN,
      key: 'vpn',
      path: 'Network › VPN',
      ticketTypes: ['incident', 'service_request'],
      defaultGroupId: NET,
    },
    {
      id: MAIL,
      key: 'email',
      path: 'Collaboration › Email',
      ticketTypes: ['incident'],
      defaultGroupId: DESK,
    },
    { id: HW, key: 'hardware', path: 'Hardware', ticketTypes: ['service_request'], defaultGroupId: DESK },
  ],
  groups: [
    { id: NET, key: 'network', name: 'Network team' },
    { id: DESK, key: 'service-desk', name: 'Service desk' },
  ],
};

let n = 0;
const nb = (similarity: number, p: Partial<Neighbour> = {}): Neighbour => ({
  id: `t${++n}`,
  reference: `INC-${String(n).padStart(5, '0')}`,
  title: 'x',
  similarity,
  categoryId: null,
  assignmentGroupId: null,
  impact: 2,
  urgency: 2,
  resolutionCode: 'solved',
  href: null,
  ...p,
});

describe('weightedVote', () => {
  it('weights votes by similarity, not head count', () => {
    const r = weightedVote([
      { value: 'a', weight: 0.9 },
      { value: 'b', weight: 0.3 },
      { value: 'b', weight: 0.3 },
    ]);
    expect(r.value).toBe('a');
    expect(r.share).toBeCloseTo(0.9 / 1.5);
    expect(r.meanSimilarity).toBeCloseTo(0.9);
    expect(r.confidence).toBeCloseTo((0.9 / 1.5) * 0.9);
  });

  it('computes confidence = agreement share × mean similarity of the agreeing neighbours', () => {
    const r = weightedVote([
      { value: 'a', weight: 0.8 },
      { value: 'a', weight: 0.6 },
      { value: 'b', weight: 0.6 },
    ]);
    expect(r.share).toBeCloseTo(1.4 / 2);
    expect(r.meanSimilarity).toBeCloseTo(0.7);
    expect(r.confidence).toBeCloseTo(0.49);
    expect(r.supporters).toBe(2);
  });

  it('lets neighbours without a value dilute the share', () => {
    const r = weightedVote([
      { value: 'a', weight: 0.5 },
      { value: null, weight: 0.5 },
    ]);
    expect(r.value).toBe('a');
    expect(r.share).toBeCloseTo(0.5);
  });

  it('is unanimous and fully confident only with identical twins', () => {
    expect(weightedVote([{ value: 'a', weight: 1 }]).confidence).toBe(1);
    expect(weightedVote([]).value).toBeNull();
    expect(weightedVote([{ value: null, weight: 0.9 }]).confidence).toBe(0);
  });

  it('breaks weight ties by the number of supporters', () => {
    expect(
      weightedVote([
        { value: 'a', weight: 0.6 },
        { value: 'b', weight: 0.3 },
        { value: 'b', weight: 0.3 },
      ]).value,
    ).toBe('b');
  });
});

describe('median', () => {
  it('handles odd, even and empty input', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 3])).toBe(2);
    expect(median([1, 2])).toBe(2);
    expect(median([])).toBeNull();
  });
});

describe('keywordSignals', () => {
  it.each([
    ['The VPN is down for everyone in Taipei', ['everyone'], []],
    ['Email outage — all users affected', ['all users', 'outage'], []],
    ["I can't work, my laptop won't boot. URGENT", [], ["can't work", 'urgent']],
    ['I can’t work since this morning', [], ["can't work"]],
    ['全公司都無法連上 VPN，緊急！', ['全公司'], ['緊急']],
    ['所有人都收不到信，我無法工作', ['所有人'], ['無法工作']],
    ['全員がログインできません。至急対応をお願いします', ['全員'], ['至急']],
    ['基幹システムが停止して仕事ができない', ['停止'], ['仕事ができない']],
  ])('%s', (text, impact, urgency) => {
    const s = keywordSignals(text);
    for (const [found, expected] of [
      [s.impact, impact],
      [s.urgency, urgency],
    ] as const) {
      if (expected.length) expect(found).toEqual(expect.arrayContaining(expected));
      else expect(found).toEqual([]);
    }
  });

  it('does not fire on ordinary text', () => {
    expect(keywordSignals('Please install Visio on my laptop. Download page is fine.')).toEqual({
      impact: [],
      urgency: [],
    });
  });
});

describe('builtinTriage', () => {
  const ticket = { type: 'incident', title: 'VPN keeps disconnecting', description: 'Drops every 5 minutes' };

  it('suggests the category and group most similar resolved tickets agree on', () => {
    const r = builtinTriage(
      ticket,
      [
        nb(0.82, { categoryId: VPN, assignmentGroupId: NET, impact: 3, urgency: 2 }),
        nb(0.74, { categoryId: VPN, assignmentGroupId: NET, impact: 3, urgency: 3 }),
        nb(0.4, { categoryId: MAIL, assignmentGroupId: DESK, impact: 2, urgency: 2 }),
      ],
      options,
    );
    expect(r.suggestion.categoryId).toBe(VPN);
    expect(r.suggestion.categoryPath).toBe('Network › VPN');
    expect(r.suggestion.assignmentGroupId).toBe(NET);
    expect(r.suggestion.assignmentGroupName).toBe('Network team');
    expect(r.suggestion.impact).toBe(3);
    expect(r.suggestion.urgency).toBe(2);
    expect(r.suggestion.priority).toBe(4);
    const share = (0.82 + 0.74) / (0.82 + 0.74 + 0.4);
    expect(r.confidence).toBeCloseTo(share * 0.78);
    expect(r.neighbours.map((x) => x.similarity)).toEqual([0.82, 0.74, 0.4]);
  });

  it('never suggests a category that does not apply to the ticket type or is unknown', () => {
    const r = builtinTriage(
      ticket,
      [nb(0.9, { categoryId: HW }), nb(0.8, { categoryId: 'ffffffff-0000-4000-8000-000000000000' })],
      options,
    );
    expect(r.suggestion.categoryId).toBeNull();
    expect(r.confidence).toBe(0);
  });

  it("routes to the category's default group when neighbours have no group", () => {
    const r = builtinTriage(ticket, [nb(0.7, { categoryId: VPN })], options);
    expect(r.suggestion.assignmentGroupId).toBe(NET);
    expect(r.fieldConfidence.group).toBeCloseTo(r.fieldConfidence.category * 0.9);
  });

  it('raises impact and urgency to 1 on keywords, with defaults when nothing is similar', () => {
    const r = builtinTriage(
      { type: 'incident', title: 'Email is down for everyone', description: 'Urgent: we cannot work' },
      [],
      options,
    );
    expect(r.suggestion).toMatchObject({ impact: 1, urgency: 1, priority: 1, categoryId: null });
    expect(r.keywords.impact).toContain('everyone');
    const quiet = builtinTriage({ type: 'incident', title: 'Printer jam', description: '' }, [], options);
    expect(quiet.suggestion).toMatchObject({ impact: 2, urgency: 2, priority: 3 });
  });

  it('ignores noise neighbours below the similarity floor', () => {
    const r = builtinTriage(ticket, [nb(0.05, { categoryId: VPN })], options);
    expect(r.suggestion.categoryId).toBeNull();
    expect(r.neighbours).toHaveLength(0);
  });
});

describe('validateSuggestion', () => {
  it('accepts known ids and rejects invented or mismatched ones', () => {
    expect(
      validateSuggestion(
        { categoryId: VPN, assignmentGroupId: NET, impact: 1, urgency: 3 },
        'incident',
        options,
      ),
    ).toEqual([]);
    expect(
      validateSuggestion(
        { categoryId: null, assignmentGroupId: null, impact: 2, urgency: 2 },
        'incident',
        options,
      ),
    ).toEqual([]);
    expect(
      validateSuggestion(
        { categoryId: HW, assignmentGroupId: 'nope', impact: 4, urgency: 0 },
        'incident',
        options,
      ),
    ).toEqual(['categoryId', 'assignmentGroupId', 'impact', 'urgency']);
  });
});
