import { describe, expect, it } from 'vitest';
import {
  changesWiql,
  compareFeed,
  decodeCursor,
  emailOf,
  encodeCursor,
  identityValue,
  joinTags,
  parseIdentityString,
  splitTags,
  textToHtml,
  toDay,
  workItemCatalog,
} from '../src/model';
import { retryAfterSeconds, toHttpError } from '../src/server/client';
import { buildPatch, toRemoteValue } from '../src/server/work-items';

describe('values', () => {
  it('rounds stored date-times to the day someone picked', () => {
    expect(toDay('2026-10-14T16:00:00.000Z')).toBe('2026-10-15'); // Taipei midnight
    expect(toDay('2026-10-15T05:00:00Z')).toBe('2026-10-15'); // New York midnight
    expect(toDay('2026-10-15T00:00:00Z')).toBe('2026-10-15');
    expect(toDay('2026-10-15')).toBe('2026-10-15');
    expect(toDay('soon')).toBeNull();
    expect(toRemoteValue('Microsoft.VSTS.Scheduling.StartDate', '2026-10-15')).toBe(
      '2026-10-15T00:00:00.000Z',
    );
  });

  it('splits and joins tags', () => {
    expect(splitTags('wifi; taipei;;  wifi ')).toEqual(['wifi', 'taipei']);
    expect(joinTags(['a', ' b ', 'a', 'c;d'])).toBe('a; b; c,d');
    expect(toRemoteValue('System.Tags', [])).toBeNull();
  });

  it('reads and writes identities', () => {
    expect(parseIdentityString('Olivia Bennett <CONTOSO\\auditor>')).toEqual({
      displayName: 'Olivia Bennett',
      uniqueName: 'CONTOSO\\auditor',
    });
    expect(parseIdentityString('CONTOSO\\auditor')).toEqual({
      displayName: 'CONTOSO\\auditor',
      uniqueName: 'CONTOSO\\auditor',
    });
    expect(emailOf('Jane@Contoso.com')).toBe('jane@contoso.com');
    expect(emailOf('CONTOSO\\jane')).toBeNull();
    expect(identityValue({ email: 'a@b.example', name: 'A', id: 'CONTOSO\\a' })).toBe('a@b.example');
    expect(identityValue({ email: null, name: 'A', id: 'CONTOSO\\a' })).toBe('CONTOSO\\a');
    expect(identityValue(null)).toBeNull();
  });

  it('checks priorities and numbers', () => {
    expect(toRemoteValue('Microsoft.VSTS.Common.Priority', '2')).toBe(2);
    expect(() => toRemoteValue('Microsoft.VSTS.Common.Priority', '5')).toThrow();
    expect(() => toRemoteValue('Microsoft.VSTS.Scheduling.RemainingWork', 'lots')).toThrow();
  });

  it('escapes plain text comments', () => {
    expect(textToHtml('a < b\n\nc & d\ne')).toBe('<p>a &lt; b</p><p>c &amp; d<br>e</p>');
  });
});

describe('change feed', () => {
  it('round-trips cursors and orders equal times by id', () => {
    const c = { at: '2026-10-07T01:02:03.457Z', id: '42' };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    expect(decodeCursor('nonsense')).toBeNull();
    expect(compareFeed({ at: c.at, id: '9' }, { at: c.at, id: '42' })).toBeLessThan(0);
  });

  it('builds WIQL from normalised values only', () => {
    expect(changesWiql(null)).toBe(
      'SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project ORDER BY [System.ChangedDate] ASC, [System.Id] ASC',
    );
    expect(changesWiql({ at: '2026-10-07T01:02:03.457Z', id: '42' })).toContain(
      "([System.ChangedDate] > '2026-10-07T01:02:03.457Z' OR ([System.ChangedDate] = '2026-10-07T01:02:03.457Z' AND [System.Id] > 42))",
    );
    expect(() => changesWiql({ at: '2026-10-07T00:00:00Z', id: "1' OR 1=1" })).toThrow();
  });
});

describe('patches', () => {
  const base = 'https://ado.contoso.local/tfs/DefaultCollection';
  const current = {
    id: 7,
    rev: 3,
    fields: {
      'System.WorkItemType': 'Task',
      'System.Title': 'x',
      'System.AssignedTo': { uniqueName: 'CONTOSO\\a' },
    },
    relations: [
      { rel: 'System.LinkTypes.Related', url: `${base}/_apis/wit/workItems/1` },
      { rel: 'System.LinkTypes.Hierarchy-Reverse', url: `${base}/_apis/wit/workItems/5` },
    ],
  };

  it('replaces the parent relation and clears fields that have a value', () => {
    const ops = buildPatch(
      { 'System.AssignedTo': null, 'System.Description': null, parent: '9' },
      { current, typeFields: null, parent: '9', base },
    );
    expect(ops).toEqual([
      { op: 'remove', path: '/fields/System.AssignedTo' },
      { op: 'remove', path: '/relations/1' },
      {
        op: 'add',
        path: '/relations/-',
        value: {
          rel: 'System.LinkTypes.Hierarchy-Reverse',
          url: `${base}/_apis/wit/workItems/9`,
          attributes: { comment: '' },
        },
      },
    ]);
  });

  it('skips fields the type lacks and refuses read-only ones', () => {
    const typeFields = new Set(['System.Title', 'Microsoft.VSTS.Scheduling.RemainingWork']);
    expect(
      buildPatch(
        {
          'Microsoft.VSTS.Scheduling.TargetDate': '2026-01-01',
          'Microsoft.VSTS.Scheduling.RemainingWork': 3,
        },
        { current, typeFields, parent: undefined, base },
      ),
    ).toEqual([{ op: 'add', path: '/fields/Microsoft.VSTS.Scheduling.RemainingWork', value: 3 }]);
    expect(() =>
      buildPatch(
        { 'System.CreatedDate': '2026-01-01T00:00:00Z' },
        { current, typeFields: null, parent: undefined, base },
      ),
    ).toThrow();
    expect(() => buildPatch({}, { current, typeFields: null, parent: '7', base })).toThrow();
  });
});

describe('errors', () => {
  const err = (status: number, body: unknown = null, headers: Record<string, string> = {}) =>
    toHttpError({ status, headers }, body);

  it('maps remote failures to the hub’s codes', () => {
    expect(err(401).code).toBe('REMOTE_AUTH_FAILED');
    expect(err(302, null, { location: 'https://ado/_signin?x' }).code).toBe('REMOTE_AUTH_FAILED');
    expect(err(302, null, { location: 'https://other/tfs' }).code).toBe('UPSTREAM_FAILED');
    expect(err(412, { typeKey: 'TestPatchOperationFailedException', message: 'VS403351: …' }).code).toBe(
      'REMOTE_CONFLICT',
    );
    expect(err(429, null, { 'retry-after': '12' }).details).toMatchObject({ retryAfterSeconds: 12 });
    expect(err(503, null, { 'retry-after': '5' }).code).toBe('REMOTE_RATE_LIMITED');
    expect(err(503).code).toBe('UPSTREAM_FAILED');
    const rejected = err(400, {
      typeKey: 'RuleValidationException',
      message: 'TF401320: Rule Error for field State.',
    });
    expect([rejected.statusCode, rejected.code, (rejected.details as { message: string }).message]).toEqual([
      422,
      'REMOTE_REJECTED',
      'TF401320: Rule Error for field State.',
    ]);
    expect(err(404).details).toMatchObject({ message: expect.stringContaining('collection URL') });
  });

  it('reads Retry-After as seconds or a date', () => {
    expect(retryAfterSeconds('30')).toBe(30);
    expect(retryAfterSeconds(new Date(Date.now() + 90_000).toUTCString())).toBeGreaterThanOrEqual(89);
    expect(retryAfterSeconds(undefined)).toBe(60);
    expect(retryAfterSeconds('999999')).toBe(3600);
  });

  it('describes the system processes without a project', () => {
    const states = workItemCatalog(null)
      .find((f) => f.key === 'System.State')!
      .choices!.map((c) => c.value);
    expect(states).toEqual(
      expect.arrayContaining(['New', 'Active', 'To Do', 'Doing', 'Approved', 'Proposed']),
    );
  });
});
