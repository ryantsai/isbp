import { describe, expect, it } from 'vitest';
import { format, joinList, text } from '../src/server/text';

describe('server texts', () => {
  it('fills simple and plural arguments the way ICU does', () => {
    const one = '{n, plural, =0 {none} one {# task} other {# tasks}} for {who}';
    expect(format(one, { n: 0, who: 'Mei' }, 'en')).toBe('none for Mei');
    expect(format(one, { n: 1, who: 'Mei' }, 'en')).toBe('1 task for Mei');
    expect(format(one, { n: 7, who: 'Mei' }, 'en')).toBe('7 tasks for Mei');
    expect(format('{n, plural, other {# 項工作}}', { n: 1 }, 'zh-TW')).toBe('1 項工作');
    // Missing arguments stay visible instead of vanishing.
    expect(format('{a} and {b}', { a: 1 }, 'en')).toBe('1 and {b}');
  });

  it('reads the catalogs in the reader’s language, falling back to English', () => {
    expect(text('en', 'reasons.slip', { value: 1 })).toBe('Expected 1 day after the target date');
    expect(text('en', 'reasons.tasks_overdue', { value: 3 })).toBe('3 tasks overdue');
    expect(text('ja-JP', 'reportState.delayed')).toBe('遅延');
    expect(
      text('zh-TW', 'server.report.counts', { total: 2, delayed: 1, atRisk: 0, onTrack: 1, noUpdate: 0 }),
    ).toBe('共 2 個專案：1 個延遲、0 個有風險、1 個進度正常、0 個未回報。');
  });

  it('joins lists per language', () => {
    expect(joinList('en', ['NET', 'ERP', 'ZTA'])).toBe('NET, ERP and ZTA');
    expect(joinList('ja-JP', ['NET', 'ERP'])).toBe('NET、ERP');
  });
});
