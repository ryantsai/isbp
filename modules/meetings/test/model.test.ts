import { describe, expect, it } from 'vitest';
import {
  type Attendee,
  formatMeetingRef,
  matchOwner,
  organiseNotes,
  parseDue,
  parseMeetingRef,
} from '../src/model';

// Tuesday 13 October 2026.
const D = '2026-10-13';

const people: Attendee[] = [
  { id: 'mei', name: 'Mei Lin', email: 'mei.lin@example.com', username: 'mlin' },
  { id: 'ya', name: '林雅婷' },
  { id: 'ken', name: 'Kenji Sato', email: 'kenji@example.com' },
  { id: 'dai', name: '高橋 大輔' },
];

describe('references', () => {
  it('formats and parses MTG-00042', () => {
    expect(formatMeetingRef(42)).toBe('MTG-00042');
    expect(parseMeetingRef('mtg-42')).toEqual({ number: 42 });
    expect(parseMeetingRef('MTG-00042')).toEqual({ number: 42 });
    expect(parseMeetingRef('0199a6f0-1c2d-7e3f-8a4b-5c6d7e8f9a0b')).toEqual({
      id: '0199a6f0-1c2d-7e3f-8a4b-5c6d7e8f9a0b',
    });
    for (const bad of ['MTG-0', 'MTG', '42', "MTG-1' or 1=1", 'NET-12'])
      expect(parseMeetingRef(bad), bad).toBeNull();
  });
});

describe('due dates', () => {
  const due = (text: string) => parseDue(text, D);

  it('reads dates in English, Chinese and Japanese relative to the meeting', () => {
    expect(due('Send the quote by 2026-10-20')).toEqual({ date: '2026-10-20', rest: 'Send the quote' });
    expect(due('update the runbook by 10/24').date).toBe('2026-10-24');
    expect(due('10月24日前完成報價')).toEqual({ date: '2026-10-24', rest: '完成報價' });
    expect(due('ベンダーに10月24日までに連絡').date).toBe('2026-10-24');
    expect(due('Oct 30 go-live check').date).toBe('2026-10-30');
    expect(due('due 5 Nov').date).toBe('2026-11-05');
    // A month long past this year means next year.
    expect(due('renew by Jan 5').date).toBe('2027-01-05');
  });

  it('reads weekdays and relative phrases', () => {
    expect(due('confirm with the vendor by Friday')).toEqual({
      date: '2026-10-16',
      rest: 'confirm with the vendor',
    });
    expect(due('by fri').date).toBe('2026-10-16');
    expect(due('next Friday').date).toBe('2026-10-23');
    expect(due('週五前確認交期')).toEqual({ date: '2026-10-16', rest: '確認交期' });
    expect(due('下週三開會').date).toBe('2026-10-21');
    expect(due('金曜までにベンダーに納期を確認')).toEqual({
      date: '2026-10-16',
      rest: 'ベンダーに納期を確認',
    });
    expect(due('来週の水曜日まで').date).toBe('2026-10-21');
    expect(due('tomorrow').date).toBe('2026-10-14');
    expect(due('明天回覆').date).toBe('2026-10-14');
    expect(due('this week').date).toBe('2026-10-16');
    expect(due('next week').date).toBe('2026-10-23');
    expect(due('下週').date).toBe('2026-10-23');
    expect(due('end of month').date).toBe('2026-10-31');
    expect(due('月底前').date).toBe('2026-10-31');
    expect(due('in 3 days').date).toBe('2026-10-16');
  });

  it("doesn't see dates where there are none", () => {
    for (const text of [
      'Set up monitoring for the core',
      'We may need more licences',
      'Check the 2nd floor AP',
      'Sun Microsystems contract',
    ])
      expect(due(text).date, text).toBeNull();
  });
});

describe('owners', () => {
  const owner = (text: string) => matchOwner(text, people);

  it('finds the owner by mention, label, brackets or a leading name', () => {
    expect(owner('@Mei Lin send the quote')).toEqual({
      ownerId: 'mei',
      ownerHint: null,
      rest: 'send the quote',
    });
    expect(owner('@mei send the quote').ownerId).toBe('mei');
    expect(owner('@mlin send the quote').ownerId).toBe('mei');
    expect(owner('Book the window (owner: Kenji Sato)')).toMatchObject({ ownerId: 'ken' });
    expect(owner('Update the runbook (Kenji)')).toEqual({
      ownerId: 'ken',
      ownerHint: null,
      rest: 'Update the runbook',
    });
    expect(owner('林雅婷：準備報價')).toEqual({ ownerId: 'ya', ownerHint: null, rest: '準備報價' });
    expect(owner('林雅婷 負責 確認交期')).toEqual({ ownerId: 'ya', ownerHint: null, rest: '確認交期' });
    expect(owner('Kenji will check the logs')).toEqual({
      ownerId: 'ken',
      ownerHint: null,
      rest: 'check the logs',
    });
    expect(owner('担当：高橋 大輔 ベンダー確認')).toMatchObject({ ownerId: 'dai', rest: 'ベンダー確認' });
    expect(owner('Ask 高橋 大輔 about the licences')).toEqual({
      ownerId: 'dai',
      ownerHint: null,
      rest: 'Ask 高橋 大輔 about the licences',
    });
  });

  it('keeps a name nobody at the meeting has as a hint, and finds nobody where nobody is named', () => {
    expect(owner('@Zoe check the backups')).toEqual({
      ownerId: null,
      ownerHint: 'Zoe',
      rest: 'check the backups',
    });
    expect(owner('Check the backups')).toEqual({ ownerId: null, ownerHint: null, rest: 'Check the backups' });
    // "Meijer" is not Mei.
    expect(owner('Meijer contract renewal').ownerId).toBeNull();
  });
});

describe('the builtin organiser', () => {
  it('reads English minutes with headings, prefixes, checkboxes and mentions', () => {
    const notes = [
      'Weekly infra sync',
      '## Discussion',
      '- Core switch replacement slipped a week because of the vendor',
      '- Wi-Fi rollout on floors 8–11 is on track',
      'Decision: Move the cutover to the weekend of 7 Nov',
      '## Action items',
      '- @Mei Lin confirm the new delivery date with the vendor by Friday',
      '- Kenji: update the cutover runbook by 10/20',
      '- [ ] Book the change window (owner: Kenji Sato) next week',
      'Do we need a second maintenance window?',
    ].join('\n');
    const out = organiseNotes(notes, { attendees: people, meetingDate: D });
    expect(out.decisions).toEqual(['Move the cutover to the weekend of 7 Nov']);
    expect(out.questions).toEqual(['Do we need a second maintenance window?']);
    expect(out.actionItems).toEqual([
      {
        title: 'confirm the new delivery date with the vendor',
        ownerId: 'mei',
        ownerHint: null,
        dueDate: '2026-10-16',
      },
      { title: 'update the cutover runbook', ownerId: 'ken', ownerHint: null, dueDate: '2026-10-20' },
      { title: 'Book the change window', ownerId: 'ken', ownerHint: null, dueDate: '2026-10-23' },
    ]);
    expect(out.summary).toBe(
      '- Weekly infra sync\n- Core switch replacement slipped a week because of the vendor\n- Wi-Fi rollout on floors 8–11 is on track',
    );
  });

  it('reads Chinese and Japanese minutes', () => {
    const zh = organiseNotes(
      [
        '決議：十一月七日週末進行切換',
        '待辦事項',
        '1. 林雅婷 負責 週五前確認交期',
        '2. 更新切換手冊 @Kenji 10/20',
        '待確認：是否需要第二個維護時段',
      ].join('\n'),
      { attendees: people, meetingDate: D },
    );
    expect(zh.decisions).toEqual(['十一月七日週末進行切換']);
    expect(zh.questions).toEqual(['是否需要第二個維護時段']);
    expect(zh.actionItems).toEqual([
      { title: '確認交期', ownerId: 'ya', ownerHint: null, dueDate: '2026-10-16' },
      { title: '更新切換手冊', ownerId: 'ken', ownerHint: null, dueDate: '2026-10-20' },
    ]);

    const ja = organiseNotes(
      [
        '決定事項：',
        '・カットオーバーは11月7日の週末に実施',
        'アクション：高橋 大輔 金曜までにベンダーに納期を確認',
        '課題：二回目のメンテナンス枠が必要か',
      ].join('\n'),
      { attendees: people, meetingDate: D },
    );
    expect(ja.decisions).toEqual(['カットオーバーは11月7日の週末に実施']);
    expect(ja.questions).toEqual(['二回目のメンテナンス枠が必要か']);
    expect(ja.actionItems).toEqual([
      { title: 'ベンダーに納期を確認', ownerId: 'dai', ownerHint: null, dueDate: '2026-10-16' },
    ]);
  });

  it('gives an empty result for empty notes, and caps what it returns', () => {
    expect(organiseNotes('', { attendees: people, meetingDate: D })).toEqual({
      summary: null,
      decisions: [],
      questions: [],
      actionItems: [],
    });
    const many = Array.from({ length: 150 }, (_, i) => `TODO item ${i}`).join('\n');
    expect(organiseNotes(many, { attendees: [], meetingDate: D }).actionItems).toHaveLength(100);
  });
});
