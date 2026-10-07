import { describe, expect, it } from 'vitest';
import { type CatalogueField, fitValueMap, type ProfileShape, validateProfile } from '../src/mapping';
import { compatibleTypes, isCompatible } from '../src/model';

const local: CatalogueField[] = [
  { key: 'title', type: 'string', required: true },
  { key: 'description', type: 'markdown' },
  { key: 'status', type: 'choice', choices: [{ value: 'open' }, { value: 'done' }] },
  { key: 'type', type: 'choice', choices: [{ value: 'incident' }], createOnly: true, required: true },
  { key: 'owner', type: 'user' },
  { key: 'ref', type: 'string', readOnly: true },
];
const remote: CatalogueField[] = [
  { key: 'subject', type: 'string', required: true },
  { key: 'body', type: 'html' },
  { key: 'state', type: 'choice', choices: [{ value: 'New' }, { value: 'Closed' }] },
  { key: 'kind', type: 'string' },
  { key: 'assignee', type: 'user' },
  { key: 'number', type: 'number', readOnly: true },
  { key: 'isbpRef', type: 'string' },
];
const traits = {
  object: { create: true, update: true, comments: true },
  entity: { comments: true, matchKeys: ['title'] },
};
const ok: ProfileShape = {
  direction: 'both',
  createLocal: true,
  createRemote: true,
  comments: true,
  matchRule: { local: 'title', remote: 'subject' },
  pushFilter: [{ field: 'status', op: 'neq', value: 'done' }],
  mappings: [
    { local: 'title', remote: 'subject', direction: 'both' },
    { local: 'description', remote: 'body', direction: 'both' },
    {
      local: 'status',
      remote: 'state',
      direction: 'both',
      values: [
        { remote: 'New', local: 'open' },
        { remote: 'Closed', local: 'done' },
      ],
    },
    { local: 'type', remote: 'kind', direction: 'pull' },
    { local: 'owner', remote: 'assignee', direction: 'both' },
    { local: 'ref', remote: 'isbpRef', direction: 'push' },
  ],
};
const codes = (p: Partial<ProfileShape>, t = traits) =>
  validateProfile({ ...ok, ...p }, local, remote, t).map((i) => `${i.path}:${i.code}`);

describe('mapping validation', () => {
  it('accepts a sound profile', () => {
    expect(codes({})).toEqual([]);
  });

  it('refuses unknown, duplicate and incompatible fields', () => {
    expect(
      codes({
        mappings: [
          { local: 'title', remote: 'subject', direction: 'both' },
          { local: 'title', remote: 'body', direction: 'both' },
          { local: 'nope', remote: 'zip', direction: 'both' },
          { local: 'owner', remote: 'number', direction: 'both' },
        ],
        createLocal: false,
        createRemote: false,
      }),
    ).toEqual([
      'mappings.1.local:duplicate_local',
      'mappings.2.local:unknown_local',
      'mappings.2.remote:unknown_remote',
      'mappings.3.remote:incompatible',
    ]);
  });

  it('refuses rows that can sync in no direction', () => {
    expect(
      codes({
        mappings: [{ local: 'ref', remote: 'number', direction: 'pull' }],
        createLocal: false,
        createRemote: false,
      }),
    ).toContain('mappings.0.direction:no_direction');
  });

  it('checks value maps against both catalogues', () => {
    expect(
      codes({
        mappings: [
          ...ok.mappings.filter((m) => m.local !== 'status'),
          {
            local: 'status',
            remote: 'state',
            direction: 'both',
            values: [
              { remote: 'Gone', local: 'open' },
              { remote: 'New', local: 'nope' },
              { remote: 'New', local: 'done' },
            ],
          },
        ],
      }),
    ).toEqual([
      'mappings.5.values.0.remote:unknown_remote_choice',
      'mappings.5.values.1.local:unknown_local_choice',
      'mappings.5.values.2.remote:duplicate_value',
    ]);
  });

  it('allows many-to-one value maps when each value has one row per direction', () => {
    const status = (values: NonNullable<ProfileShape['mappings'][number]['values']>) =>
      codes({
        mappings: [
          ...ok.mappings.filter((m) => m.local !== 'status'),
          { local: 'status', remote: 'state', direction: 'both', values },
        ],
      });
    // Two remote values become one local value: only one of them may also send it out.
    expect(
      status([
        { remote: 'New', local: 'open' },
        { remote: 'Closed', local: 'open', direction: 'pull' },
      ]),
    ).toEqual([]);
    expect(
      status([
        { remote: 'New', local: 'open' },
        { remote: 'Closed', local: 'open' },
      ]),
    ).toEqual(['mappings.5.values.1.local:duplicate_local_value']);
    // One remote value comes in once, and may stand for another local value going out.
    expect(
      status([
        { remote: 'Closed', local: 'done' },
        { remote: 'Closed', local: 'open', direction: 'push' },
      ]),
    ).toEqual([]);
    expect(
      status([
        { remote: 'Closed', local: 'done', direction: 'pull' },
        { remote: 'Closed', local: 'open', direction: 'pull' },
      ]),
    ).toEqual(['mappings.5.values.1.remote:duplicate_value']);
    // A one-way mapping only checks its own direction.
    expect(
      codes({
        mappings: [
          ...ok.mappings.filter((m) => m.local !== 'status'),
          {
            local: 'status',
            remote: 'state',
            direction: 'pull',
            values: [
              { remote: 'New', local: 'open' },
              { remote: 'Closed', local: 'open' },
            ],
          },
        ],
      }),
    ).toEqual([]);
  });

  it('only refuses values that can’t occur on the side a row writes', () => {
    // A pull-only row naming a remote value the system doesn't have never matches: harmless.
    expect(
      codes({
        mappings: [
          ...ok.mappings.filter((m) => m.local !== 'status'),
          {
            local: 'status',
            remote: 'state',
            direction: 'both',
            values: [
              { remote: 'New', local: 'open' },
              { remote: 'Approved', local: 'open', direction: 'pull' },
              { remote: 'Closed', local: 'archived', direction: 'push' },
            ],
          },
        ],
      }),
    ).toEqual([]);
  });

  it('fits a suggested value map to the live catalogues', () => {
    const lf: CatalogueField = {
      key: 'status',
      type: 'choice',
      choices: [{ value: 'todo' }, { value: 'done' }],
    };
    const rf: CatalogueField = {
      key: 'State',
      type: 'choice',
      choices: [{ value: 'To Do' }, { value: 'Done' }],
    };
    // An Agile-first suggestion on a Basic project: the Agile rows go, Basic's rows take over both ways.
    expect(
      fitValueMap(
        [
          { remote: 'New', local: 'todo' },
          { remote: 'Closed', local: 'done' },
          { remote: 'Done', local: 'done', direction: 'pull' as const },
          { remote: 'To Do', local: 'todo', direction: 'pull' as const },
          { remote: 'Doing', local: 'in_progress', direction: 'pull' as const },
        ],
        lf,
        rf,
      ),
    ).toEqual([
      { remote: 'Done', local: 'done' },
      { remote: 'To Do', local: 'todo' },
    ]);
    // Rows that still have a way out keep their direction.
    expect(
      fitValueMap(
        [
          { remote: 'To Do', local: 'todo' },
          { remote: 'Done', local: 'todo', direction: 'pull' as const },
        ],
        lf,
        rf,
      ),
    ).toEqual([
      { remote: 'To Do', local: 'todo' },
      { remote: 'Done', local: 'todo', direction: 'pull' },
    ]);
  });

  it('requires what creating records needs', () => {
    expect(codes({ mappings: ok.mappings.filter((m) => m.local !== 'type') })).toContain(
      'createLocal:required_unmapped',
    );
    expect(codes({ mappings: ok.mappings.filter((m) => m.remote !== 'subject') })).toContain(
      'createRemote:remote_required_unmapped',
    );
    expect(codes({ direction: 'push' })).toContain('createLocal:create_local_needs_pull');
    expect(codes({ direction: 'pull' })).toContain('createRemote:create_remote_needs_push');
    expect(codes({}, { ...traits, object: { ...traits.object, create: false } })).toContain(
      'createRemote:create_unsupported',
    );
  });

  it('checks the match rule, push filter and comments', () => {
    expect(codes({ matchRule: { local: 'owner', remote: 'nope' } })).toEqual([
      'matchRule.local:match_unsupported',
      'matchRule.remote:unknown_remote',
    ]);
    expect(codes({ pushFilter: [{ field: 'zip', op: 'empty' }] })).toEqual([
      'pushFilter.0.field:unknown_local',
    ]);
    expect(codes({}, { ...traits, entity: { ...traits.entity, comments: false } })).toEqual([
      'comments:comments_unsupported',
    ]);
  });

  it('knows which types convert into which', () => {
    expect(isCompatible('markdown', 'html')).toBe(true);
    expect(isCompatible('tags', 'string')).toBe(true);
    expect(isCompatible('user', 'number')).toBe(false);
    expect(isCompatible('parent', 'string')).toBe(false);
    expect(compatibleTypes('date')).toEqual(['date', 'datetime', 'string']);
  });
});
