/**
 * The `sdp.server` connector: ManageEngine ServiceDesk Plus on-premises (REST API v3, technician API key) for the
 * Integrations Hub. See the module README for the API details it relies on.
 */
import {
  type ConnectorHandler,
  ErrorCodes,
  HttpError,
  type RemoteChangesPage,
  type RemoteComment,
  type RemoteFieldDef,
  type RemoteRecord,
  type RemoteWriteOptions,
} from '@isbp/sdk/server';
import { assetEndpointsOf, type SdpConfig, type SdpSecrets, serverRoot, singularOf } from '../contracts';
import { NotFound, sdpCall, type SdpConn } from './client';
import {
  advanceCursor,
  compareIds,
  decodeCursor,
  encodeCursor,
  type FeedCursor,
  parseWebhook,
  SDP_ID_RE,
  START,
} from './feed';
import { defaultMapping } from './mapping';
import {
  epochMs,
  fieldDefs,
  type ObjectSpec,
  objectSpec,
  type Raw,
  readValues,
  textToHtml,
  toRemote,
  updatedMs,
  versionOf,
} from './objects';

const PAGE_MAX = 100;
const DETAIL_CONCURRENCY = 4;
const PICKLIST_TTL_S = 600;
/** How long a connection remembers that an object type has to be scanned (then the time feed is tried again). */
const FEED_MODE_TTL_S = 24 * 3600;
/** A scan re-reads this many rows before its cursor, so records deleted meanwhile don't make it skip others. */
const SCAN_OVERLAP = 10;

function spec(objectType: string): ObjectSpec {
  const s = objectSpec(objectType);
  if (!s) throw new HttpError(404, ErrorCodes.NOT_FOUND, `ServiceDesk Plus has no object type ${objectType}`);
  return s;
}

const hostOf = (url: string) => new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '');

/** Errors of the remote system that `test()` reports as a failed test; others (the kernel's guards) propagate. */
const REMOTE_ERRORS = new Set<string>([
  ErrorCodes.REMOTE_AUTH_FAILED,
  ErrorCodes.REMOTE_REJECTED,
  ErrorCodes.REMOTE_RATE_LIMITED,
  ErrorCodes.UPSTREAM_FAILED,
]);

const rejected = (message: string) =>
  new HttpError(422, ErrorCodes.REMOTE_REJECTED, 'ServiceDesk Plus refused the request', { message });

/** The record's page in the ServiceDesk Plus web UI. */
function webUrl(conn: SdpConn, s: ObjectSpec, id: string): string {
  const portal = conn.config.portalId ? `&PORTALID=${conn.config.portalId}` : '';
  return `${serverRoot(conn.config)}/${s.page(id)}${portal}`;
}

function toRecord(conn: SdpConn, s: ObjectSpec, raw: Raw): RemoteRecord {
  const id = String(raw.id);
  const values = readValues(s, raw);
  const title = values[s.titleKey];
  // Records without an update time report when they were created (or 1970): "newest wins" can't use them.
  const ms = updatedMs(s, raw) ?? epochMs(raw.created_time) ?? epochMs(raw.reported_time) ?? 0;
  return {
    id,
    ref: s.ref(raw),
    title: typeof title === 'string' && title ? title : s.ref(raw),
    url: webUrl(conn, s, id),
    version: versionOf(s, raw, values),
    updatedAt: new Date(ms).toISOString(),
    values,
  };
}

/** The record in a response: under one of `keys`, else the only other object carrying an id. */
function recordOf(body: Record<string, unknown>, keys: string[]): Raw {
  const isRecord = (v: unknown): v is Raw =>
    typeof v === 'object' && v !== null && !Array.isArray(v) && 'id' in v;
  for (const k of keys) if (isRecord(body[k])) return body[k];
  const others = Object.entries(body).filter(
    ([k, v]) => k !== 'response_status' && k !== 'list_info' && isRecord(v),
  );
  if (others.length === 1) return others[0]![1] as Raw;
  throw new HttpError(502, ErrorCodes.UPSTREAM_FAILED, `ServiceDesk Plus returned no ${keys[0]}`, {
    reason: 'response',
  });
}

/* ───────────────────────────── assets (build 15100 API) ───────────────────────────── */

/** Basic fields `asset_assets` reads and writes; the others need the product type's own API. */
const BASIC_ASSET_FIELDS = new Set([
  'name',
  'asset_tag',
  'org_serial_number',
  'product',
  'product_type',
  'state',
  'user',
  'department',
]);

const typeName = (raw: Raw): string | null => {
  const t = raw.product_type as { name?: unknown } | null | undefined;
  return typeof t?.name === 'string' && t.name ? t.name : null;
};

/** The product type's own API (`asset_servers`), from the connection's map. */
function assetApi(conn: SdpConn, productType: string | null): string | null {
  return productType ? (assetEndpointsOf(conn.config)[productType] ?? null) : null;
}

/* ───────────────────────────── reads ───────────────────────────── */

async function getRaw(conn: SdpConn, s: ObjectSpec, id: string): Promise<Raw | null> {
  if (!SDP_ID_RE.test(id)) return null;
  try {
    const raw = recordOf(await sdpCall(conn, 'GET', `${s.path}/${id}`), [s.single]);
    if (s.type !== 'asset') return raw;
    // `asset_assets` has the basic fields only: add the full record from the product type's API.
    const api = assetApi(conn, typeName(raw));
    if (!api) return raw;
    try {
      const full = recordOf(await sdpCall(conn, 'GET', `/${api}/${id}`), [singularOf(api)]);
      return { ...raw, ...full };
    } catch (err) {
      if (err instanceof NotFound) return raw;
      throw err;
    }
  } catch (err) {
    if (err instanceof NotFound) return null;
    throw err;
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const invalid = (issues: { path: string; message: string }[]) =>
  new HttpError(422, ErrorCodes.VALIDATION_FAILED, 'Invalid ServiceDesk Plus values', { issues });

/** Picklist names from a setup endpoint, cached per connection; null when they can't be read. */
async function picklist(conn: SdpConn, path: string, key: string): Promise<string[] | null> {
  const cacheKey = `picklist:${path}`;
  const cached = await conn.cache.get<string[]>(cacheKey);
  if (cached) return cached;
  try {
    const names: string[] = [];
    for (let start = 1; start < 1000; start += PAGE_MAX) {
      const body = await sdpCall(conn, 'GET', path, {
        list_info: { row_count: PAGE_MAX, start_index: start, sort_field: 'name', sort_order: 'asc' },
      });
      const items = Array.isArray(body[key]) ? (body[key] as Raw[]) : [];
      for (const i of items) if (typeof i.name === 'string' && i.name && !i.deleted) names.push(i.name);
      const info = body.list_info as { has_more_rows?: unknown } | undefined;
      if (!info?.has_more_rows || !items.length) break;
    }
    const unique = [...new Set(names)];
    await conn.cache.set(cacheKey, unique, PICKLIST_TTL_S);
    return unique;
  } catch (err) {
    // Credentials that don't work are worth reporting; a missing setup scope or endpoint is not.
    if (err instanceof HttpError && err.code === ErrorCodes.REMOTE_AUTH_FAILED) throw err;
    return null;
  }
}

/** Assets need a product: when only the product type is given, use that type's first product. */
async function withProduct(conn: SdpConn, body: Raw): Promise<Raw> {
  if (body.product || !body.product_type) return body;
  const type = (body.product_type as { name?: string }).name;
  const found = await sdpCall(conn, 'GET', '/products', {
    list_info: {
      row_count: 1,
      start_index: 1,
      sort_field: 'name',
      sort_order: 'asc',
      search_criteria: { field: 'product_type.name', condition: 'is', value: type },
    },
  });
  const product = (Array.isArray(found.products) ? (found.products as Raw[]) : [])[0];
  if (!product?.name)
    throw new HttpError(422, ErrorCodes.REMOTE_REJECTED, 'ServiceDesk Plus refused the request', {
      message: `No product of type "${type}" exists in ServiceDesk Plus; add one or map a product`,
    });
  return { ...body, product: { name: product.name } };
}

function noteToComment(raw: Raw): RemoteComment {
  const by = (raw.created_by ?? {}) as Raw;
  const ms = epochMs(raw.created_time) ?? 0;
  return {
    id: String(raw.id),
    body: typeof raw.description === 'string' ? raw.description : '',
    format: 'html',
    author: {
      email: typeof by.email_id === 'string' && by.email_id ? by.email_id : null,
      name: typeof by.name === 'string' && by.name ? by.name : 'ServiceDesk Plus',
      id: by.id === undefined || by.id === null ? null : String(by.id),
    },
    createdAt: new Date(ms).toISOString(),
    internal: raw.show_to_requester !== true,
  };
}

/* ───────────────────────────── change feeds ───────────────────────────── */

const listOf = (s: ObjectSpec, body: Record<string, unknown>) =>
  Array.isArray(body[s.plural]) ? (body[s.plural] as Raw[]) : [];
const hasMoreRows = (body: Record<string, unknown>) =>
  Boolean((body.list_info as { has_more_rows?: unknown } | undefined)?.has_more_rows);

/** Reads each record in full (the list view leaves out descriptions, resolutions and most lookups). */
async function details(
  conn: SdpConn,
  s: ObjectSpec,
  items: { raw: Raw; id: string }[],
): Promise<RemoteRecord[]> {
  return mapLimit(items, DETAIL_CONCURRENCY, async (item) => {
    const full = await getRaw(conn, s, item.id);
    return full ? toRecord(conn, s, full) : { ...toRecord(conn, s, item.raw), deleted: true };
  });
}

/**
 * Records updated since the cursor, by the update time (sort and `search_criteria` "greater than t − 1"). Null when
 * the records come without an update time (the caller scans instead).
 */
async function timeFeed(
  conn: SdpConn,
  s: ObjectSpec,
  cursor: Extract<FeedCursor, { m: 'time' }>,
  limit: number,
): Promise<RemoteChangesPage | null> {
  const seen = new Set(cursor.ids);
  const fresh: { raw: Raw; t: number; id: string }[] = [];
  let more = false;
  let start = 1;
  for (let page = 0; page < 50; page++) {
    const listInfo: Raw = {
      row_count: Math.min(PAGE_MAX, limit + seen.size),
      start_index: start,
      sort_field: s.updatedField,
      sort_order: 'asc',
      get_total_count: false,
    };
    // "greater than t − 1": records updated at the cursor's millisecond too, minus the ids already seen.
    if (cursor.t !== null)
      listInfo.search_criteria = {
        field: s.updatedField,
        condition: 'greater than',
        value: String(cursor.t - 1),
      };
    const body = await sdpCall(conn, 'GET', s.path, { list_info: listInfo });
    const items = listOf(s, body);
    if (items.length && items.every((raw) => updatedMs(s, raw) === null)) return null;
    more = hasMoreRows(body);
    for (const raw of items) {
      const id = String(raw.id ?? '');
      const t = updatedMs(s, raw) ?? epochMs(raw.created_time);
      if (!SDP_ID_RE.test(id) || t === null) continue;
      if (cursor.t !== null && t < cursor.t) continue;
      if (t === cursor.t && seen.has(id)) continue;
      fresh.push({ raw, t, id });
    }
    // A full page of records already handed out (many sharing one millisecond): look further.
    if (fresh.length || !more || !items.length) break;
    start += items.length;
  }
  fresh.sort((a, b) => a.t - b.t || compareIds(a.id, b.id));
  const taken = fresh.slice(0, limit);
  const next = advanceCursor(
    cursor,
    taken.map(({ id, t }) => ({ id, t })),
  );
  return {
    items: await details(conn, s, taken),
    cursor: next.t === null ? null : encodeCursor(next),
    hasMore: more || fresh.length > taken.length,
  };
}

/**
 * A full pass over every record, sorted by id, for objects without an update time. Versions are hashes of the
 * values, so the hub skips what didn't change. When a pass ends, the cursor starts the next one from the top.
 */
async function scanFeed(
  conn: SdpConn,
  s: ObjectSpec,
  cursor: Extract<FeedCursor, { m: 'scan' }>,
  limit: number,
): Promise<RemoteChangesPage> {
  let index = cursor.after ? Math.max(1, cursor.index - SCAN_OVERLAP) : 1;
  const fresh: { raw: Raw; id: string; position: number }[] = [];
  let more = false;
  for (let page = 0; page < 50 && fresh.length < limit; page++) {
    const body = await sdpCall(conn, 'GET', s.path, {
      list_info: {
        row_count: Math.min(PAGE_MAX, limit + SCAN_OVERLAP),
        start_index: index,
        sort_field: 'id',
        sort_order: 'asc',
        get_total_count: false,
      },
    });
    const items = listOf(s, body);
    more = hasMoreRows(body);
    items.forEach((raw, i) => {
      const id = String(raw.id ?? '');
      if (SDP_ID_RE.test(id) && (cursor.after === null || compareIds(id, cursor.after) > 0))
        fresh.push({ raw, id, position: index + i });
    });
    if (!more || !items.length) break;
    index += items.length;
  }
  fresh.sort((a, b) => compareIds(a.id, b.id));
  const taken = fresh.slice(0, limit);
  const hasMore = more || fresh.length > taken.length;
  const last = taken[taken.length - 1];
  const next: FeedCursor =
    hasMore && last ? { m: 'scan', after: last.id, index: last.position + 1 } : START.scan;
  return { items: await details(conn, s, taken), cursor: encodeCursor(next), hasMore };
}

export const sdpConnector: ConnectorHandler<SdpConfig, SdpSecrets> = {
  hosts(config) {
    return [hostOf(serverRoot(config))];
  },

  async test(conn) {
    const root = serverRoot(conn.config);
    const host = new URL(root).host;
    const portal = conn.config.portalId;
    try {
      await sdpCall(conn, 'GET', '/requests', {
        list_info: { row_count: 1, start_index: 1, sort_field: 'created_time', sort_order: 'desc' },
      });
      return { ok: true, account: `ServiceDesk Plus on ${host}${portal ? ` (portal ${portal})` : ''}` };
    } catch (err) {
      if (err instanceof NotFound)
        return {
          ok: false,
          message: portal
            ? `No service desk instance with portal ID ${portal} on ${host}`
            : `No REST API v3 at ${root}/api/v3 (check the server URL)`,
        };
      if (err instanceof HttpError && REMOTE_ERRORS.has(err.code)) {
        const detail = (err.details as { message?: unknown } | undefined)?.message;
        return { ok: false, message: typeof detail === 'string' ? `${err.message}: ${detail}` : err.message };
      }
      throw err;
    }
  },

  async fields(conn, objectType): Promise<RemoteFieldDef[]> {
    const s = spec(objectType);
    const fetched: Record<string, string[]> = {};
    for (const f of s.fields) {
      if (!f.setup) continue;
      const names = await picklist(conn, f.setup.path, f.setup.key);
      if (names?.length) fetched[f.key] = names;
    }
    return fieldDefs(s, fetched);
  },

  async changes(conn, objectType, opts): Promise<RemoteChangesPage> {
    const s = spec(objectType);
    const limit = Math.min(Math.max(1, Math.floor(opts.limit) || 1), PAGE_MAX);
    const cursor = decodeCursor(opts.cursor);
    const modeKey = `feed:${s.type}`;
    if ((await conn.cache.get<string>(modeKey)) !== 'scan') {
      try {
        const page = await timeFeed(conn, s, cursor?.m === 'time' ? cursor : START.time, limit);
        if (page) return page;
      } catch (err) {
        // The server refuses to sort or search by the update time for this module: scan instead.
        const status = (err as HttpError).details as { status?: unknown } | undefined;
        if (!(err instanceof HttpError && err.code === ErrorCodes.REMOTE_REJECTED && status?.status === 400))
          throw err;
      }
      await conn.cache.set(modeKey, 'scan', FEED_MODE_TTL_S);
    }
    return scanFeed(conn, s, cursor?.m === 'scan' ? cursor : START.scan, limit);
  },

  async get(conn, objectType, id) {
    const s = spec(objectType);
    const raw = await getRaw(conn, s, id);
    return raw ? toRecord(conn, s, raw) : null;
  },

  async create(conn, objectType, values) {
    const s = spec(objectType);
    const { body, issues } = toRemote(s, values, 'create');
    if (issues.length) throw invalid(issues);
    let path = s.path;
    let keys = [s.single];
    let payload = body;
    if (s.type === 'asset') {
      // `asset_assets` can't add: assets are added through their product type's API.
      const type = typeName(body);
      if (!type) throw rejected('A product type is needed to create an asset in ServiceDesk Plus');
      const api = assetApi(conn, type);
      if (!api)
        throw rejected(
          `No API name is set for the product type "${type}": add it to the connection's asset endpoints`,
        );
      path = `/${api}`;
      keys = [singularOf(api)];
      payload = await withProduct(conn, body);
    }
    const created = recordOf(await sdpCall(conn, 'POST', path, { [keys[0]!]: payload }), keys);
    // The add response may leave out fields the detail view has.
    const full = (await getRaw(conn, s, String(created.id))) ?? created;
    return toRecord(conn, s, full);
  },

  async update(conn, objectType, id, values, opts: RemoteWriteOptions) {
    const s = spec(objectType);
    const current = await getRaw(conn, s, id);
    if (!current) throw new NotFound(`${s.single} ${id} was not found in ServiceDesk Plus`);
    // Re-read and compare: the update time, or the hash of the values for records without one.
    const record = toRecord(conn, s, current);
    if (opts.expectedVersion && record.version !== opts.expectedVersion)
      throw new HttpError(409, ErrorCodes.REMOTE_CONFLICT, `${record.ref} changed in ServiceDesk Plus`, {
        expectedVersion: opts.expectedVersion,
        currentVersion: record.version,
      });
    // Create-only fields may be sent unchanged (a full push); a different value can't be applied.
    const changes = Object.fromEntries(
      Object.entries(values).filter(([key, value]) => {
        const f = s.fields.find((x) => x.key === key);
        return !(
          f?.createOnly && JSON.stringify(record.values[key] ?? null) === JSON.stringify(value ?? null)
        );
      }),
    );
    if (!Object.keys(changes).length) return record;
    const { body, issues } = toRemote(s, changes, 'update');
    if (issues.length) throw invalid(issues);
    let path = `${s.path}/${id}`;
    let keys = [s.single];
    if (s.type === 'asset') {
      // Basic fields through `asset_assets`; the others through the product type's API when it is known.
      const api = assetApi(conn, typeName(current));
      if (api && Object.keys(body).some((k) => !BASIC_ASSET_FIELDS.has(k))) {
        path = `/${api}/${id}`;
        keys = [singularOf(api)];
      }
    }
    const updated = recordOf(await sdpCall(conn, 'PUT', path, { [keys[0]!]: body }), keys);
    const full = (await getRaw(conn, s, String(updated.id))) ?? updated;
    return toRecord(conn, s, full);
  },

  comments: {
    async list(conn, objectType, id) {
      const s = spec(objectType);
      if (!s.notes)
        throw new HttpError(409, ErrorCodes.NOT_SUPPORTED, `Notes on ${objectType} are not supported`);
      if (!SDP_ID_RE.test(id)) throw new NotFound();
      const notes: RemoteComment[] = [];
      for (let start = 1; start < 10_000; start += PAGE_MAX) {
        const body = await sdpCall(conn, 'GET', `${s.path}/${id}/notes`, {
          list_info: {
            row_count: PAGE_MAX,
            start_index: start,
            sort_field: 'created_time',
            sort_order: 'asc',
          },
        });
        const items = Array.isArray(body[s.notes.plural]) ? (body[s.notes.plural] as Raw[]) : [];
        notes.push(...items.map(noteToComment));
        const info = body.list_info as { has_more_rows?: unknown } | undefined;
        if (!info?.has_more_rows || !items.length) break;
      }
      return notes.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    },

    async add(conn, objectType, id, comment) {
      const s = spec(objectType);
      if (!s.notes)
        throw new HttpError(409, ErrorCodes.NOT_SUPPORTED, `Notes on ${objectType} are not supported`);
      if (!SDP_ID_RE.test(id)) throw new NotFound();
      const html = comment.format === 'html' ? comment.body : textToHtml(comment.body);
      if (!html.trim()) throw invalid([{ path: 'body', message: 'required' }]);
      const body = await sdpCall(conn, 'POST', `${s.path}/${id}/notes`, {
        [s.notes.single]: {
          description: html,
          show_to_requester: !comment.internal,
          notify_technician: false,
          mark_first_response: false,
          add_to_linked_requests: false,
        },
      });
      const note = body[s.notes.single];
      if (typeof note !== 'object' || note === null)
        throw new HttpError(502, ErrorCodes.UPSTREAM_FAILED, 'ServiceDesk Plus returned no note', {
          reason: 'response',
        });
      return noteToComment(note as Raw);
    },
  },

  async webhook(_conn, req) {
    return parseWebhook(req.body);
  },

  defaultMapping,
};
