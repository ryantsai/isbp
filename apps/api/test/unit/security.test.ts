import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';
import { safeNext } from '../../src/core/util';
import { escapeFilter } from '../../src/core/sso/ldap';

describe('LDAP filter escaping (RFC 4515)', () => {
  it('neutralises filter injection', () => {
    expect(escapeFilter('*)(uid=*')).toBe('\\2a\\29\\28uid=\\2a');
    expect(escapeFilter('a\\b')).toBe('a\\5cb');
    expect(escapeFilter('alice')).toBe('alice');
  });
});

describe('post-login redirects', () => {
  it.each([
    ['/admin/users?q=1', '/admin/users?q=1'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['https://evil.example', '/'],
    ['/api/v1/auth/logout', '/'],
    [undefined, '/'],
  ])('%s → %s', (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });
});

describe('configuration', () => {
  it('refuses to start in production without a master key', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/ISBP_MASTER_KEY/);
  });
  it('derives secure cookies from an https public URL', () => {
    const c = loadConfig({
      NODE_ENV: 'production',
      ISBP_MASTER_KEY: Buffer.alloc(32, 1).toString('base64'),
      PUBLIC_URL: 'https://isbp.example.com',
    });
    expect(c.cookieSecure).toBe(true);
    expect(c.autoMigrate).toBe(false);
  });
});
