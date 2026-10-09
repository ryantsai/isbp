import { describe, expect, it } from 'vitest';
import {
  joinTemplate,
  jsonEscape,
  renderTemplate,
  renderTemplates,
  templatePaths,
  templateSegments,
  templateValue,
} from '../src/templates';

const context = {
  data: {
    title: 'New firewall rule',
    amount: 1200,
    urgent: true,
    zero: 0,
    tags: ['a', 'b', null, 'c'],
    cis: ['cmdb.ci:1', 'cmdb.ci:2'],
    nested: { deep: { value: 'x' } },
    empty: null,
  },
  records: { cis: { criticality: ['high', 'low'] } },
  requester: { displayName: 'Mei Chen', email: 'mei@example.com' },
  request: { reference: 'REQ-01042', href: '/requests/REQ-01042' },
  when: new Date('2026-10-08T01:02:03.000Z'),
};

describe('renderTemplate', () => {
  it('replaces paths with their values', () => {
    expect(
      renderTemplate('{{request.reference}}: {{data.title}} for {{ requester.displayName }}', context),
    ).toBe('REQ-01042: New firewall rule for Mei Chen');
  });

  it('stringifies numbers, booleans, dates and zero', () => {
    expect(renderTemplate('{{data.amount}} {{data.urgent}} {{data.zero}} {{when}}', context)).toBe(
      '1200 true 0 2026-10-08T01:02:03.000Z',
    );
  });

  it('joins lists and skips empty items', () => {
    expect(renderTemplate('[{{data.tags}}] [{{records.cis.criticality}}]', context)).toBe(
      '[a, b, c] [high, low]',
    );
  });

  it('renders unknown and empty paths as nothing', () => {
    expect(renderTemplate('<{{data.missing}}|{{nope.deeper.still}}|{{data.empty}}>', context)).toBe('<||>');
  });

  it('never evaluates anything', () => {
    expect(renderTemplate('{{1+1}}{{data.title.toUpperCase()}}{{constructor}}', context)).toBe('');
    expect(renderTemplate('{{data.__proto__}}{{data.constructor.name}}{{toString}}', context)).toBe('');
    expect(renderTemplate('{{ data["title"] }}', context)).toBe('');
  });

  it('turns objects into JSON and leaves text without placeholders alone', () => {
    expect(renderTemplate('{{data.nested}}', context)).toBe('{"deep":{"value":"x"}}');
    expect(renderTemplate('plain {text} and {{ unclosed', context)).toBe('plain {text} and {{ unclosed');
  });

  it('escapes substituted values when asked (JSON bodies stay valid)', () => {
    const ctx = { data: { title: 'He said "hi"\nbye' } };
    const body = renderTemplate('{"title":"{{data.title}}"}', ctx, { escape: jsonEscape });
    expect(JSON.parse(body)).toEqual({ title: 'He said "hi"\nbye' });
  });

  it('reads list items by index', () => {
    expect(templateValue(context, 'data.cis.1')).toBe('cmdb.ci:2');
    expect(templateValue(context, 'data.cis.length')).toBeUndefined();
  });
});

describe('renderTemplates', () => {
  it('renders strings recursively and keeps other values', () => {
    const config = {
      title: 'Change for {{data.title}}',
      risk: 'high',
      count: 3,
      submit: true,
      lines: ['{{request.reference}}', 7],
      nested: { body: '{{requester.email}}' },
      secret: { sealed: '{{data.title}}' },
    };
    expect(renderTemplates(config, context, { skip: ['secret'] })).toEqual({
      title: 'Change for New firewall rule',
      risk: 'high',
      count: 3,
      submit: true,
      lines: ['REQ-01042', 7],
      nested: { body: 'mei@example.com' },
      secret: { sealed: '{{data.title}}' },
    });
  });
});

describe('templatePaths', () => {
  it('lists the paths a template uses', () => {
    expect(templatePaths('{{data.a}} and {{ request.reference }} but not {{1+1}}')).toEqual([
      'data.a',
      'request.reference',
    ]);
  });
});

describe('templateSegments', () => {
  it('splits text and placeholders in order', () => {
    expect(templateSegments('{{request.reference}}: {{ data.title }} for {{requester.displayName}}')).toEqual(
      [
        { path: 'request.reference' },
        { text: ': ' },
        { path: 'data.title' },
        { text: ' for ' },
        { path: 'requester.displayName' },
      ],
    );
  });

  it("keeps what isn't a plain path as text, merged with its neighbours", () => {
    expect(templateSegments('a {{ not a path }} b {{x.y}}{{}}')).toEqual([
      { text: 'a {{ not a path }} b ' },
      { path: 'x.y' },
      { text: '{{}}' },
    ]);
    expect(templateSegments('')).toEqual([]);
    expect(templateSegments('no placeholders')).toEqual([{ text: 'no placeholders' }]);
  });

  it('round-trips through joinTemplate (spaces inside braces are dropped)', () => {
    for (const t of ['{{a}}{{b.c}} and {{ d }}', 'line 1\n{{data.items}}\n', '{"t": "{{data.title}}"}'])
      expect(renderTemplate(joinTemplate(templateSegments(t)), context)).toBe(renderTemplate(t, context));
    expect(joinTemplate(templateSegments('x {{ data.title }} y'))).toBe('x {{data.title}} y');
  });
});
