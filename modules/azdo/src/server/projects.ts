import type { RemoteChangesPage, RemoteRecord } from '@isbp/sdk/server';
import { compareFeed, decodeCursor, encodeCursor } from '../model';
import { type AzdoConn, azdo, collectionUrl, seg } from './client';
import { type AzdoProject, isGuid, listProjects } from './shared';

const iso = (v: string | undefined) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

function toRecord(conn: AzdoConn, p: AzdoProject): RemoteRecord {
  const updatedAt = iso(p.lastUpdateTime) ?? new Date(0).toISOString();
  return {
    id: p.id.toLowerCase(),
    ref: p.name,
    title: p.name,
    url: `${collectionUrl(conn)}/${seg(p.name)}`,
    // The revision changes with every project update; the time keeps versions distinct across servers.
    version: `${p.revision ?? 0}:${updatedAt}`,
    updatedAt,
    values: {
      name: p.name,
      description: p.description?.trim() || null,
      state: p.state ?? null,
      visibility: p.visibility ?? null,
      lastUpdateTime: iso(p.lastUpdateTime),
    },
  };
}

/** Team projects updated after the cursor (by last update time, then id). Collections have few, so one read. */
export async function projectChanges(
  conn: AzdoConn,
  opts: { cursor: string | null; limit: number },
): Promise<RemoteChangesPage> {
  const cursor = decodeCursor(opts.cursor);
  const limit = Math.min(500, Math.max(1, Math.floor(opts.limit) || 100));
  const all = (await listProjects(conn))
    .map((p) => toRecord(conn, p))
    .map((r) => ({ r, pos: { at: r.updatedAt, id: r.id } }))
    .filter(({ pos }) => !cursor || compareFeed(pos, cursor) > 0)
    .sort((a, b) => compareFeed(a.pos, b.pos));
  const page = all.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((x) => x.r),
    cursor: last ? encodeCursor(last.pos) : (opts.cursor ?? null),
    hasMore: all.length > limit,
  };
}

export async function getProject(conn: AzdoConn, id: string): Promise<RemoteRecord | null> {
  if (!isGuid(id)) return null;
  const res = await azdo<AzdoProject>(conn, `_apis/projects/${seg(id)}`, { allow: [404] });
  if (res.status === 404 || !res.body?.id) return null;
  return toRecord(conn, res.body);
}
