import { ErrorCodes, HttpError, type RemoteUser } from '@isbp/sdk/server';
import { emailOf, type IdentityRef, identityValue } from '../model';
import { type AzdoConn, azdo, seg } from './client';

/** Azure DevOps list envelope. */
export interface ListOf<T> {
  count?: number;
  value: T[];
}

export interface AzdoProject {
  id: string;
  name: string;
  description?: string;
  url?: string;
  state?: string;
  revision?: number;
  visibility?: string;
  lastUpdateTime?: string;
}

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isGuid = (v: string) => GUID_RE.test(v);

/**
 * Short-lived memo per connection context, so one sync step reads the project list, types and identities
 * once even across records. Entries expire after 30 seconds (the kernel may keep an opened connection for
 * a whole run); the connection's cache holds the longer-lived copies.
 */
const MEMO_MS = 30_000;
const memo = new WeakMap<AzdoConn, Map<string, { at: number; p: Promise<unknown> }>>();
export function once<T>(conn: AzdoConn, key: string, load: () => Promise<T>): Promise<T> {
  let m = memo.get(conn);
  if (!m) {
    m = new Map();
    memo.set(conn, m);
  }
  const hit = m.get(key);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.p as Promise<T>;
  const p = load();
  m.set(key, { at: Date.now(), p });
  p.catch(() => m.delete(key));
  return p;
}

/** Every team project of the collection (paged with the continuation token). */
export async function listProjects(conn: AzdoConn): Promise<AzdoProject[]> {
  const all = new Map<string, AzdoProject>();
  let token: string | undefined;
  for (let page = 0; page < 100; page++) {
    const res = await azdo<ListOf<AzdoProject>>(conn, '_apis/projects', {
      query: { $top: 500, stateFilter: 'wellFormed', continuationToken: token },
    });
    const before = all.size;
    for (const p of res.body?.value ?? []) all.set(p.id.toLowerCase(), p);
    token = res.headers['x-ms-continuationtoken'];
    // Some servers hand back the same page for a token: stop when a page adds nothing.
    if (!token || all.size === before) break;
  }
  return [...all.values()];
}

const PROJECTS_TTL = 300;

/** `{ id, name }` of every team project, cached for five minutes per connection. */
export function projectIndex(conn: AzdoConn): Promise<{ id: string; name: string }[]> {
  return once(conn, 'projects', async () => {
    const cached = await conn.cache.get<{ id: string; name: string }[]>('projects');
    if (cached) return cached;
    const list = (await listProjects(conn)).map((p) => ({ id: p.id.toLowerCase(), name: p.name }));
    await conn.cache.set('projects', list, PROJECTS_TTL);
    return list;
  });
}

/**
 * The project id of a profile's scope: a project id (what `scopes()` returns) or, for hand-written
 * settings, a project name. 400 when missing, 422 `REMOTE_REJECTED` when the collection has no such project.
 */
export async function resolveProject(conn: AzdoConn, scope: string | null | undefined): Promise<string> {
  const value = scope?.trim();
  if (!value)
    throw new HttpError(400, ErrorCodes.VALIDATION_FAILED, 'Choose a team project', {
      issues: [{ path: 'scope', message: 'required' }],
    });
  const projects = await projectIndex(conn);
  const lower = value.toLowerCase();
  const hit = projects.find((p) => p.id === lower) ?? projects.find((p) => p.name.toLowerCase() === lower);
  if (hit) return hit.id;
  // Not in the (cached) list: maybe created a moment ago.
  if (isGuid(value)) return lower;
  const res = await azdo<AzdoProject>(conn, `_apis/projects/${seg(value)}`, { allow: [404] });
  if (res.status === 404 || !res.body?.id)
    throw new HttpError(422, ErrorCodes.REMOTE_REJECTED, `Team project "${value}" was not found`, {
      message: `Team project "${value}" was not found`,
    });
  return res.body.id.toLowerCase();
}

/** Team project id of a name (`System.TeamProject`), or null when it isn't (or no longer) listed. */
export async function projectIdByName(conn: AzdoConn, name: unknown): Promise<string | null> {
  if (typeof name !== 'string' || !name) return null;
  const lower = name.toLowerCase();
  return (await projectIndex(conn)).find((p) => p.name.toLowerCase() === lower)?.id ?? null;
}

/* ───────────────────────────── identities ───────────────────────────── */

interface AzdoIdentity {
  id: string;
  providerDisplayName?: string;
  customDisplayName?: string;
  properties?: Record<string, { $value?: unknown } | undefined>;
}

const IDENTITY_TTL = 24 * 3600;
const UNKNOWN_TTL = 3600;

const identityKey = (ref: IdentityRef) => (ref.id ?? ref.uniqueName ?? ref.displayName ?? '').toLowerCase();

/**
 * Emails of identity references. A unique name that is an email is used as is; on-premises Active
 * Directory accounts (`CONTOSO\jdoe`) are looked up with the Identities API (`Mail` property), cached per
 * connection for a day. Lookups that fail leave the email empty: the hub then logs an unmatched person.
 */
export async function resolveEmails(
  conn: AzdoConn,
  refs: IdentityRef[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const missing = new Map<string, IdentityRef>();
  const byAccount = new Map<string, string>();
  for (const ref of refs) {
    const key = identityKey(ref);
    if (!key || out.has(key)) continue;
    const direct = emailOf(ref.uniqueName);
    if (direct) {
      out.set(key, direct);
      continue;
    }
    const cached = await conn.cache.get<{ email: string | null }>(`identity:${key}`);
    if (cached) out.set(key, cached.email);
    else if (ref.id && isGuid(ref.id)) missing.set(key, ref);
    else if (ref.uniqueName?.includes('\\')) byAccount.set(key, ref.uniqueName);
    else out.set(key, null);
  }
  // Text identities (older versions) carry no id: look the account up by name.
  for (const [key, account] of byAccount) {
    let email: string | null = null;
    try {
      const res = await azdo<ListOf<AzdoIdentity | null>>(conn, '_apis/identities', {
        query: { searchFilter: 'AccountName', filterValue: account, queryMembership: 'None' },
        allow: [400, 404],
      });
      const mail = res.status < 300 ? res.body?.value?.find(Boolean)?.properties?.Mail?.$value : undefined;
      email = typeof mail === 'string' && mail.includes('@') ? mail.trim().toLowerCase() : null;
    } catch (err) {
      const code = (err as HttpError).code;
      if (code === ErrorCodes.REMOTE_RATE_LIMITED || code === ErrorCodes.REMOTE_AUTH_FAILED) throw err;
    }
    out.set(key, email);
    await conn.cache.set(`identity:${key}`, { email }, email ? IDENTITY_TTL : UNKNOWN_TTL);
  }
  const ids = [...missing.values()].map((r) => r.id!);
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    let found: AzdoIdentity[] = [];
    try {
      const res = await azdo<ListOf<AzdoIdentity | null>>(conn, '_apis/identities', {
        query: { identityIds: chunk.join(','), queryMembership: 'None' },
        allow: [400, 404],
      });
      if (res.status < 300) found = (res.body?.value ?? []).filter((x): x is AzdoIdentity => Boolean(x));
    } catch (err) {
      // Rate limits and refused credentials stop the call; anything else just leaves emails empty.
      const code = (err as HttpError).code;
      if (code === ErrorCodes.REMOTE_RATE_LIMITED || code === ErrorCodes.REMOTE_AUTH_FAILED) throw err;
    }
    const byId = new Map(found.map((x) => [x.id.toLowerCase(), x]));
    for (const id of chunk) {
      const key = id.toLowerCase();
      const mail = byId.get(key)?.properties?.Mail?.$value;
      const email = typeof mail === 'string' && mail.includes('@') ? mail.trim().toLowerCase() : null;
      out.set(key, email);
      await conn.cache.set(`identity:${key}`, { email }, email ? IDENTITY_TTL : UNKNOWN_TTL);
    }
  }
  return out;
}

/** An identity reference as the hub's remote user (`id`: the unique name, which writes accept). */
export function toRemoteUser(ref: IdentityRef, emails: Map<string, string | null>): RemoteUser {
  return {
    email: emails.get(identityKey(ref)) ?? emailOf(ref.uniqueName),
    name: ref.displayName ?? ref.uniqueName ?? '',
    id: ref.uniqueName ?? ref.id ?? null,
  };
}

/** `DOMAIN\\alias` (or the email) of an identity read from the Identities API. */
function accountName(identity: AzdoIdentity): string | null {
  const account = identity.properties?.Account?.$value;
  const domain = identity.properties?.Domain?.$value;
  if (typeof account !== 'string' || !account) return null;
  if (account.includes('\\') || account.includes('@')) return account;
  return typeof domain === 'string' && /^[A-Za-z0-9._-]+$/.test(domain) ? `${domain}\\${account}` : account;
}

/**
 * What to write into an identity field (`System.AssignedTo`). On-premises servers resolve Active Directory
 * accounts reliably but not always emails, so an email is first looked up (Identities API, `MailAddress`)
 * and written as `Display Name <DOMAIN\\alias>`; cached per connection. An unknown email is written as is:
 * the server then accepts it or refuses the change (422 `REMOTE_REJECTED`).
 */
export async function identityForWrite(conn: AzdoConn, value: unknown): Promise<string | null> {
  if (value === null || value === undefined || value === '') return null;
  const user = typeof value === 'object' ? (value as Partial<RemoteUser>) : null;
  if (user?.id && user.id.includes('\\')) return user.name ? `${user.name} <${user.id}>` : user.id;
  const email = user ? (user.email ?? null) : emailOf(String(value)) ? String(value).trim() : null;
  if (!email) return identityValue(value);
  const key = `mail:${email.toLowerCase()}`;
  const cached = await conn.cache.get<{ value: string | null }>(key);
  if (cached) return cached.value ?? email;
  let resolved: string | null = null;
  try {
    const res = await azdo<ListOf<AzdoIdentity | null>>(conn, '_apis/identities', {
      query: { searchFilter: 'MailAddress', filterValue: email, queryMembership: 'None' },
      allow: [400, 404],
    });
    const hit =
      res.status < 300
        ? (res.body?.value ?? []).find(
            (x): x is AzdoIdentity =>
              Boolean(x) && String(x!.properties?.Mail?.$value ?? '').toLowerCase() === email.toLowerCase(),
          )
        : undefined;
    const unique = hit ? accountName(hit) : null;
    if (hit && unique) resolved = `${hit.providerDisplayName ?? hit.customDisplayName ?? unique} <${unique}>`;
  } catch (err) {
    const code = (err as HttpError).code;
    if (code === ErrorCodes.REMOTE_RATE_LIMITED || code === ErrorCodes.REMOTE_AUTH_FAILED) throw err;
  }
  await conn.cache.set(key, { value: resolved }, resolved ? IDENTITY_TTL : UNKNOWN_TTL);
  return resolved ?? email;
}
