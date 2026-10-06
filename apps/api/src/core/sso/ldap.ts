import type { LdapConfig } from '@isbp/db/schema';
import { Client, type Entry } from 'ldapts';
import type { ExternalIdentity, IdpRow } from './provisioning';

/** RFC 4515 escaping for values interpolated into LDAP filters. */
export function escapeFilter(value: string): string {
  return value.replace(/[\\*()\0]/g, (c) => `\\${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

function attrs(cfg: LdapConfig) {
  return {
    username: cfg.attributes?.username ?? 'sAMAccountName',
    email: cfg.attributes?.email ?? 'mail',
    name: cfg.attributes?.name ?? 'displayName',
    memberOf: cfg.attributes?.memberOf ?? 'memberOf',
  };
}

function client(cfg: LdapConfig) {
  return new Client({
    url: cfg.url,
    timeout: 10_000,
    connectTimeout: 5_000,
    tlsOptions: { rejectUnauthorized: cfg.tls?.rejectUnauthorized ?? true },
  });
}

function first(v: Entry[string] | undefined): string | null {
  if (v === undefined) return null;
  const x = Array.isArray(v) ? v[0] : v;
  if (x === undefined) return null;
  return Buffer.isBuffer(x) ? x.toString('utf8') : String(x);
}

function many(v: Entry[string] | undefined): string[] {
  if (v === undefined) return [];
  return (Array.isArray(v) ? v : [v]).map((x) => (Buffer.isBuffer(x) ? x.toString('utf8') : String(x)));
}

/** AD objectGUID / OpenLDAP entryUUID are stable across renames; the DN is the fallback. */
function subjectOf(e: Entry): string {
  const guid = e.objectGUID;
  if (Buffer.isBuffer(guid)) return guid.toString('hex');
  if (Array.isArray(guid) && Buffer.isBuffer(guid[0])) return guid[0].toString('hex');
  return first(e.entryUUID) ?? e.dn;
}

function toIdentity(cfg: LdapConfig, e: Entry): ExternalIdentity {
  const a = attrs(cfg);
  return {
    subject: subjectOf(e),
    email: first(e[a.email]),
    displayName: first(e[a.name]),
    username: first(e[a.username]),
    givenName: first(e.givenName),
    familyName: first(e.sn),
    jobTitle: first(e.title),
    groups: many(e[a.memberOf]),
  };
}

function searchAttributes(cfg: LdapConfig) {
  const a = attrs(cfg);
  return ['objectGUID', 'entryUUID', a.username, a.email, a.name, a.memberOf, 'givenName', 'sn', 'title'];
}

/** Service-bind, find the user, then bind as the user to verify the password. */
export async function ldapAuthenticate(
  idp: IdpRow,
  bindPassword: string,
  username: string,
  password: string,
): Promise<ExternalIdentity> {
  // An empty password would be an *anonymous* bind, which many servers accept. Never allow it.
  if (!password) throw new Error('Empty password');
  const cfg = idp.config as LdapConfig;
  const svc = client(cfg);
  try {
    await svc.bind(cfg.bindDn, bindPassword);
    const filter = cfg.userFilter.replaceAll('{{username}}', escapeFilter(username));
    const { searchEntries } = await svc.search(cfg.baseDn, {
      scope: 'sub',
      filter,
      sizeLimit: 2,
      attributes: searchAttributes(cfg),
      explicitBufferAttributes: ['objectGUID'],
    });
    if (searchEntries.length !== 1) throw new Error('User not found or not unique');
    const entry = searchEntries[0]!;
    const userClient = client(cfg);
    try {
      await userClient.bind(entry.dn, password);
    } finally {
      await userClient.unbind().catch(() => undefined);
    }
    return toIdentity(cfg, entry);
  } finally {
    await svc.unbind().catch(() => undefined);
  }
}

export async function ldapTest(idp: IdpRow, bindPassword: string) {
  const cfg = idp.config as LdapConfig;
  const svc = client(cfg);
  try {
    await svc.bind(cfg.bindDn, bindPassword);
    const { searchEntries } = await svc.search(cfg.baseDn, {
      scope: 'sub',
      filter: cfg.userFilter.replaceAll('{{username}}', '*'),
      sizeLimit: 5,
      attributes: ['dn'],
    });
    return { sampleUsers: searchEntries.map((e) => e.dn) };
  } finally {
    await svc.unbind().catch(() => undefined);
  }
}

/** Full directory read for scheduled sync (paged). */
export async function ldapDirectory(idp: IdpRow, bindPassword: string): Promise<ExternalIdentity[]> {
  const cfg = idp.config as LdapConfig;
  const svc = client(cfg);
  try {
    await svc.bind(cfg.bindDn, bindPassword);
    const { searchEntries } = await svc.search(cfg.baseDn, {
      scope: 'sub',
      filter: cfg.userFilter.replaceAll('{{username}}', '*'),
      paged: { pageSize: 500 },
      attributes: searchAttributes(cfg),
      explicitBufferAttributes: ['objectGUID'],
    });
    return searchEntries.map((e) => toIdentity(cfg, e));
  } finally {
    await svc.unbind().catch(() => undefined);
  }
}
