import { describe, expect, it } from 'vitest';
import {
  choiceToLocal,
  choiceToRemote,
  type ConvertResolver,
  dateTimeToDate,
  dateToDateTime,
  decodeEntities,
  htmlToMarkdown,
  htmlToText,
  markdownToHtml,
  splitTags,
  textToHtml,
  toLocal,
  toRemote,
  UNMAPPABLE,
} from '../src/server/convert';

const users = new Map([
  ['01900000-0000-7000-8000-000000000001', { email: 'dana@corp.example', name: 'Dana Lee' }],
]);
const resolver: ConvertResolver = {
  userIdByEmail: async (email) =>
    [...users].find(([, u]) => u.email === email.trim().toLowerCase())?.[0] ?? null,
  user: async (id) => users.get(id) ?? null,
  localParent: async (remoteId) => (remoteId === 'R1' ? 'L1' : null),
  remoteParent: async (localId) => (localId === 'L1' ? 'R1' : null),
};

describe('HTML from outside systems', () => {
  it('becomes Markdown without scripts, styles or unsafe links', () => {
    const md = htmlToMarkdown(
      '<h2>Steps</h2><script>alert(1)</script><style>p{}</style><p>Open <b>Settings</b> &amp; <a href="https://x.example/a">docs</a> <a href="javascript:alert(1)">click</a></p><ul><li>one</li><li>two</li></ul><img src="data:image/png;base64,xx" alt="shot"><iframe src="https://evil.example"></iframe>',
    );
    expect(md).toContain('## Steps');
    expect(md).toContain('**Settings**');
    expect(md).toContain('[docs](https://x.example/a)');
    expect(md).toContain('click');
    expect(md).not.toMatch(/javascript:|alert|<script|iframe|data:image/);
    expect(md).toMatch(/-\s+one/);
  });

  it('becomes plain text', () => {
    expect(htmlToText('<p>Line 1<br>Line&nbsp;2</p><script>x()</script><ul><li>a</li><li>b</li></ul>')).toBe(
      'Line 1\nLine 2\n\n- a\n- b',
    );
    expect(decodeEntities('&lt;b&gt; &#39;x&#39; &#x263A; &unknown;')).toBe("<b> 'x' ☺ &unknown;");
    expect(htmlToText('')).toBe('');
  });
});

describe('Markdown and text going out', () => {
  it('renders Markdown with raw HTML escaped and unsafe links dropped', () => {
    const html = markdownToHtml(
      'Hello **world**\n\n<script>alert(1)</script>\n\n[a](javascript:alert(1)) [b](https://ok.example)',
    );
    expect(html).toContain('<strong>world</strong>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="https://ok.example"');
  });

  it('escapes plain text into paragraphs', () => {
    expect(textToHtml('a < b\nc\n\nd')).toBe('<p>a &lt; b<br>c</p><p>d</p>');
  });
});

describe('field conversions', () => {
  const f = (type: Parameters<typeof toLocal>[1]['type'], extra = {}) => ({ key: 'k', type, ...extra });

  it('map choices through the value map, then identical values (case-insensitive)', () => {
    const map = [{ remote: 'In Progress', local: 'in_progress' }];
    const local = [{ value: 'open' }, { value: 'in_progress' }];
    expect(choiceToLocal('in progress', map, local)).toBe('in_progress');
    expect(choiceToLocal('OPEN', map, local)).toBe('open');
    expect(choiceToLocal('Frozen', map, local)).toBe(UNMAPPABLE);
    expect(choiceToRemote('in_progress', map, [{ value: 'In Progress' }])).toBe('In Progress');
    expect(choiceToRemote('open', map, [{ value: 'Open' }])).toBe('Open');
    expect(choiceToRemote('closed', map, [{ value: 'Open' }])).toBe(UNMAPPABLE);
    expect(choiceToRemote('closed', map, undefined)).toBe('closed');
  });

  it('use only the value-map rows of the direction being applied', () => {
    const map = [
      { remote: 'Resolved', local: 'resolved' },
      { remote: 'Resolved', local: 'fulfilled', direction: 'push' as const },
      { remote: 'Assigned', local: 'in_progress', direction: 'pull' as const },
      { remote: 'In Progress', local: 'in_progress' },
    ];
    const local = [{ value: 'resolved' }, { value: 'fulfilled' }, { value: 'in_progress' }];
    expect(choiceToLocal('Resolved', map, local)).toBe('resolved');
    expect(choiceToLocal('Assigned', map, local)).toBe('in_progress');
    expect(choiceToRemote('fulfilled', map, undefined)).toBe('Resolved');
    expect(choiceToRemote('resolved', map, undefined)).toBe('Resolved');
    expect(choiceToRemote('in_progress', map, undefined)).toBe('In Progress');
  });

  it('split and join tags when one side is text', async () => {
    expect(splitTags('a; b ;A;; c')).toEqual(['a', 'b', 'c']);
    expect(await toLocal('x; y', f('string'), f('tags'), {}, resolver)).toEqual(['x', 'y']);
    expect(await toRemote(['x', 'y'], f('tags'), f('string'), {}, resolver)).toBe('x; y');
    expect(await toLocal(null, f('string'), f('tags'), {}, resolver)).toEqual([]);
  });

  it('convert dates and date-times', async () => {
    expect(dateToDateTime('2026-10-07')).toBe('2026-10-07T00:00:00.000Z');
    expect(dateTimeToDate('2026-10-07T23:30:00-02:00')).toBe('2026-10-08');
    expect(await toLocal('2026-11-03T15:00:00Z', f('datetime'), f('date'), {}, resolver)).toBe('2026-11-03');
    expect(await toRemote('2026-11-03', f('date'), f('datetime'), {}, resolver)).toBe(
      '2026-11-03T00:00:00.000Z',
    );
    expect(await toLocal('nope', f('datetime'), f('datetime'), {}, resolver)).toBe(UNMAPPABLE);
  });

  it('match people by email, and skip people ISBP doesn’t know', async () => {
    expect(
      await toLocal({ email: 'DANA@corp.example', name: 'Dana' }, f('user'), f('user'), {}, resolver),
    ).toBe('01900000-0000-7000-8000-000000000001');
    expect(await toLocal({ email: 'x@corp.example', name: 'X' }, f('user'), f('user'), {}, resolver)).toBe(
      UNMAPPABLE,
    );
    expect(await toLocal({ email: null, name: 'No mail' }, f('user'), f('user'), {}, resolver)).toBe(
      UNMAPPABLE,
    );
    expect(
      await toRemote('01900000-0000-7000-8000-000000000001', f('user'), f('user'), {}, resolver),
    ).toEqual({
      email: 'dana@corp.example',
      name: 'Dana Lee',
      id: null,
    });
  });

  it('map parents through the link table', async () => {
    expect(await toLocal('R1', f('parent'), f('parent'), {}, resolver)).toBe('L1');
    expect(await toLocal('R2', f('parent'), f('parent'), {}, resolver)).toBe(UNMAPPABLE);
    expect(await toRemote('L1', f('parent'), f('parent'), {}, resolver)).toBe('R1');
  });

  it('convert text between HTML, Markdown and single-line strings', async () => {
    expect(await toLocal('<p>Hi <b>there</b></p>', f('html'), f('markdown'), {}, resolver)).toBe(
      'Hi **there**',
    );
    expect(
      await toLocal('<p>Hi</p><p>there</p>', f('html'), f('string', { maxLength: 5 }), {}, resolver),
    ).toBe('Hi t…');
    expect(await toRemote('Hi **there**', f('markdown'), f('html'), {}, resolver)).toBe(
      '<p>Hi <strong>there</strong></p>',
    );
    expect(await toRemote('a\nb', f('text'), f('html'), {}, resolver)).toBe('<p>a<br>b</p>');
    expect(await toLocal('1,234.5', f('string'), f('number'), {}, resolver)).toBe(1234.5);
    expect(await toLocal('yes', f('string'), f('boolean'), {}, resolver)).toBe(true);
    expect(await toLocal('{"a":1}', f('string'), f('json'), {}, resolver)).toEqual({ a: 1 });
  });
});
