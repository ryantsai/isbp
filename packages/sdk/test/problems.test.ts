import { describe, expect, it } from 'vitest';
import { ErrorCodes, HttpError } from '../src/http';
import { runProblemFromText, runProblemOf } from '../src/problems';

const crm = { id: '0e2f6c1a-0000-4000-8000-000000000001', name: 'CRM (MySQL)' };
const dbError = (kind: string, dbCode: string | null, message: string) =>
  new HttpError(422, ErrorCodes.DATABASE_ERROR, message, { kind, dbCode, message });

describe('runProblemOf', () => {
  it('explains database failures by what to fix, with the connection', () => {
    expect(
      runProblemOf(dbError('connect', 'ENOTFOUND', 'getaddrinfo ENOTFOUND mysql-crm-01.corp.example'), {
        connection: crm,
      }),
    ).toEqual({
      kind: 'db_host_not_found',
      params: { host: 'mysql-crm-01.corp.example', code: 'ENOTFOUND' },
      connection: crm,
    });
    expect(runProblemOf(dbError('connect', 'ECONNREFUSED', 'connect ECONNREFUSED 10.1.2.3:5432')).kind).toBe(
      'db_refused',
    );
    expect(runProblemOf(dbError('auth', '28P01', 'password authentication failed for user x')).kind).toBe(
      'db_login',
    );
    expect(runProblemOf(dbError('timeout', '57014', 'canceling statement')).kind).toBe('db_timeout');
    expect(
      runProblemOf(dbError('other', '22001', 'value too long for type character varying(16)')).kind,
    ).toBe('db_data');
    expect(runProblemOf(dbError('other', null, 'odd')).kind).toBe('db_other');
  });

  it('maps HTTP, sandbox and remote-system failures', () => {
    const upstream = new HttpError(
      502,
      ErrorCodes.UPSTREAM_FAILED,
      'network: getaddrinfo ENOTFOUND feed.example',
      {
        reason: 'network',
        code: 'ENOTFOUND',
      },
    );
    expect(runProblemOf(upstream, { host: 'feed.example' })).toEqual({
      kind: 'http_unreachable',
      params: { host: 'feed.example', code: 'ENOTFOUND' },
      connection: null,
    });
    expect(
      runProblemOf(new HttpError(502, ErrorCodes.UPSTREAM_FAILED, 'timeout: x', { reason: 'timeout' })).kind,
    ).toBe('http_timeout');
    expect(runProblemOf(new HttpError(503, ErrorCodes.SANDBOX_UNAVAILABLE, 'no runner')).kind).toBe(
      'sandbox_unavailable',
    );
    expect(runProblemOf(new HttpError(401, ErrorCodes.REMOTE_AUTH_FAILED, 'refused')).kind).toBe(
      'remote_auth',
    );
  });

  it('keeps a problem the error already carries', () => {
    const problem = { kind: 'db_login' as const, params: {}, connection: crm };
    expect(
      runProblemOf(
        new HttpError(422, ErrorCodes.INVALID_STATE, 'Pipeline run failed', { problem, runId: 'x' }),
      ),
    ).toEqual(problem);
  });

  it('reads the engines’ own phrases and driver codes from stored text', () => {
    expect(runProblemFromText('Unexpected status 502 (expected 200-299)')).toEqual({
      kind: 'http_status',
      params: { status: 502, expected: '200-299' },
      connection: null,
    });
    expect(runProblemFromText('Timed out after 3600 s')).toEqual({
      kind: 'timeout',
      params: { seconds: 3600 },
      connection: null,
    });
    expect(
      runProblemFromText('DATABASE_ERROR ENOTFOUND: getaddrinfo ENOTFOUND mysql-crm-01.corp.example'),
    ).toEqual({
      kind: 'db_host_not_found',
      params: { host: 'mysql-crm-01.corp.example' },
      connection: null,
    });
    expect(runProblemFromText('28P01: password authentication failed for user "etl"').kind).toBe('db_login');
    expect(runProblemFromText('Upstream request failed (network)').kind).toBe('http_unreachable');
    expect(runProblemFromText('The script exited with code 2')).toEqual({
      kind: 'script_exit',
      params: { code: '2' },
      connection: null,
    });
    expect(runProblemFromText('Worker lost: no heartbeat for 2 minutes').kind).toBe('lost');
    expect(runProblemFromText('Cancelled').kind).toBe('cancelled');
    expect(runProblemFromText('Something odd').kind).toBe('other');
  });
});
