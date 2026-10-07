/**
 * Sync adapter (Phase 5): `itam.asset`, so the Integrations Hub can keep hardware in step with another
 * asset system (ServiceDesk Plus assets) without this module knowing it. Writes go through
 * `AssetService` as the hub's agent: the lifecycle, assignment rules, history, audit, events and
 * notifications are the UI's, and `disposed` is only ever reached through the disposal approval.
 */
import {
  type AuthContext,
  type DomainEvent,
  httpErrors,
  type ModuleContext,
  type SyncAdapter,
  type SyncFieldDef,
  type SyncRecord,
} from '@isbp/sdk/server';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { createAssetSchema, updateAssetSchema } from '../contracts';
import {
  ASSET_CATEGORIES,
  ASSET_STATUSES,
  ASSIGNABLE_STATUSES,
  type AssetStatus,
  formatAssetTag,
  manualTransitions,
} from '../model';
import { assetHref } from './assets';
import { type AssetRow, assets, vendors } from './schema';
import { services } from './services';
import {
  approvalRequired,
  assertActiveUsers,
  cursorAt,
  inSyncWrite,
  invalidValues,
  isUuid,
  literal,
  noTransition,
  pageLimit,
  pageOf,
  pageOrder,
  pageWhere,
  parseInput,
  statusPath,
  syncErrors,
  writerAuth,
} from './sync-support';

type Values = Record<string, unknown>;

/** What `itam.assets.sync` stands for (the kernel checked it). */
const WRITER = ['itam.hardware.read', 'itam.hardware.manage'];

/** Module field (REST API) → sync field key, for error details. */
const KEYS: Record<string, string> = {
  vendorId: 'vendor',
  assigneeId: 'assignedTo',
  userId: 'assignedTo',
  toStatus: 'status',
};

/** Fields kept by `AssetService.update` (status and assignment have their own actions). */
const PLAIN = [
  'name',
  'category',
  'serialNumber',
  'location',
  'purchaseDate',
  'purchaseCost',
  'currency',
  'invoiceNumber',
  'warrantyEnd',
  'notes',
] as const;

const label = (key: string) => `itam.sync.fields.${key}`;

function record(a: AssetRow): SyncRecord {
  const tag = formatAssetTag(a.number);
  return {
    id: a.id,
    ref: tag,
    title: a.name,
    href: assetHref(tag),
    updatedAt: a.updatedAt.toISOString(),
    containerId: null,
    values: {
      name: a.name,
      category: a.category,
      serialNumber: a.serialNumber,
      status: a.status,
      assignedTo: a.assignedTo,
      location: a.location,
      vendor: a.vendorId,
      purchaseDate: a.purchaseDate,
      purchaseCost: a.purchaseCost,
      currency: a.currency,
      invoiceNumber: a.invoiceNumber,
      warrantyEnd: a.warrantyEnd,
      notes: a.notes,
      ref: tag,
    },
  };
}

/** Plain fields in the shape of the module's asset schemas. */
function plain(v: Values): Values {
  const out: Values = {};
  for (const k of PLAIN) if (k in v) out[k] = v[k];
  if ('vendor' in v) out.vendorId = v.vendor;
  if (out.currency === null) delete out.currency;
  return out;
}

const disposalOnly = (from: string) =>
  approvalRequired(from, 'disposed', 'An asset is disposed of only through the disposal approval in ISBP');

/** An assignee needs a status in which an asset stays with a person (deployed, in repair, lost). */
function assertKeepsAssignee(v: Values) {
  const status = v.status as AssetStatus | undefined;
  if (typeof v.assignedTo === 'string' && status && !ASSIGNABLE_STATUSES.includes(status))
    throw invalidValues([
      { path: 'assignedTo', message: `an asset that is ${status} is not assigned to anyone` },
    ]);
}

/** Lifecycle steps (`AssetService.changeStatus`) along the shortest path to `to`; never `disposed`. */
async function moveTo(ctx: ModuleContext, auth: AuthContext, a: AssetRow, to: AssetStatus) {
  if (to === a.status) return a;
  if (to === 'disposed') throw disposalOnly(a.status);
  const path = statusPath<AssetStatus>(manualTransitions, a.status, to);
  if (!path) throw noTransition(a.status, to, manualTransitions(a.status), 'An asset');
  let current = a;
  for (const step of path)
    current = await services(ctx).assets.changeStatus(a.id, { status: step, note: null }, auth);
  return current;
}

async function rowOf(ctx: ModuleContext, id: string): Promise<AssetRow> {
  const [row] = isUuid(id) ? await ctx.db.select().from(assets).where(eq(assets.id, id)) : [];
  if (!row) throw httpErrors.notFound('Asset not found');
  return row;
}

async function create(ctx: ModuleContext, auth: AuthContext, v: Values) {
  const status = v.status as AssetStatus | undefined;
  if (status === 'disposed') throw disposalOnly('in_stock');
  assertKeepsAssignee(v);
  const input = parseInput(
    createAssetSchema,
    {
      ...plain(v),
      status: status === 'ordered' || status === 'in_stock' ? status : undefined,
      assigneeId: v.assignedTo ?? undefined,
    },
    KEYS,
  );
  const a = await services(ctx).assets.create(input, auth);
  return status ? moveTo(ctx, auth, a, status) : a;
}

async function update(ctx: ModuleContext, auth: AuthContext, before: AssetRow, v: Values) {
  const s = services(ctx).assets;
  const status = v.status as AssetStatus | undefined;
  if (status === 'disposed' && before.status !== 'disposed') throw disposalOnly(before.status);
  assertKeepsAssignee(v);
  const fields = plain(v);
  if (Object.keys(fields).length)
    await s.update(before.id, parseInput(updateAssetSchema, fields, KEYS), auth);
  let a = await rowOf(ctx, before.id);
  // Handing over deploys the asset; taking it back returns it to stock (or repair), as in the UI.
  if (typeof v.assignedTo === 'string' && v.assignedTo !== a.assignedTo)
    a = await s.assign(a.id, { userId: v.assignedTo, note: null }, auth);
  else if (v.assignedTo === null && a.assignedTo)
    a = await s.returnAsset(
      a.id,
      { toStatus: status === 'in_repair' ? 'in_repair' : 'in_stock', note: null },
      auth,
    );
  return status ? moveTo(ctx, auth, a, status) : a;
}

export const assetAdapter: SyncAdapter = {
  matchKeys: ['serialNumber'],

  async fields(ctx): Promise<SyncFieldDef[]> {
    const vendorRows = await ctx.db
      .select({ id: vendors.id, name: vendors.name })
      .from(vendors)
      .where(eq(vendors.active, true))
      .orderBy(asc(vendors.name));
    return [
      { key: 'name', label: label('name'), type: 'string', required: true, maxLength: 200 },
      {
        key: 'category',
        label: label('category'),
        type: 'choice',
        required: true,
        choices: ASSET_CATEGORIES.map((c) => ({ value: c, label: `itam.category.${c}` })),
      },
      { key: 'serialNumber', label: label('serialNumber'), type: 'string', maxLength: 100 },
      {
        key: 'status',
        label: label('status'),
        type: 'choice',
        choices: ASSET_STATUSES.map((s) => ({ value: s, label: `itam.status.${s}` })),
      },
      { key: 'assignedTo', label: label('assignedTo'), type: 'user' },
      { key: 'location', label: label('location'), type: 'string', maxLength: 200 },
      {
        key: 'vendor',
        label: label('vendor'),
        type: 'choice',
        choices: vendorRows.map((r) => ({ value: r.id, label: literal(r.name) })),
      },
      { key: 'purchaseDate', label: label('purchaseDate'), type: 'date' },
      { key: 'purchaseCost', label: label('purchaseCost'), type: 'number' },
      { key: 'currency', label: label('currency'), type: 'string', maxLength: 3 },
      { key: 'invoiceNumber', label: label('invoiceNumber'), type: 'string', maxLength: 64 },
      { key: 'warrantyEnd', label: label('warrantyEnd'), type: 'date' },
      { key: 'notes', label: label('notes'), type: 'text', maxLength: 10_000 },
      { key: 'ref', label: label('ref'), type: 'string', readOnly: true },
    ];
  },

  async read(id, ctx) {
    if (!isUuid(id)) return null;
    const [row] = await ctx.db.select().from(assets).where(eq(assets.id, id));
    return row ? record(row) : null;
  },

  async readMany(ids, ctx) {
    const valid = ids.filter(isUuid);
    if (!valid.length) return [];
    return (await ctx.db.select().from(assets).where(inArray(assets.id, valid))).map(record);
  },

  async list(opts, ctx) {
    const limit = pageLimit(opts.limit);
    const rows = await ctx.db
      .select({ a: assets, cursorAt: cursorAt(assets.updatedAt) })
      .from(assets)
      .where(pageWhere(assets.updatedAt, assets.id, opts))
      .orderBy(...pageOrder(assets.updatedAt, assets.id))
      .limit(limit + 1);
    const page = pageOf(
      rows.map((r) => ({ ...r, id: r.a.id })),
      limit,
    );
    return { items: page.rows.map((r) => record(r.a)), next: page.next };
  },

  /** Serial numbers are unique (case-insensitive), so at most one asset matches. */
  async findBy(field, value, _opts, ctx) {
    if (field !== 'serialNumber' || typeof value !== 'string' || !value.trim()) return null;
    const rows = await ctx.db
      .select()
      .from(assets)
      .where(and(sql`lower(${assets.serialNumber}) = lower(${value.trim()})`))
      .limit(2);
    return rows.length === 1 ? record(rows[0]!) : null;
  },

  write(input, opts, ctx) {
    return inSyncWrite(ctx, opts, async (bound) => {
      const v: Values = { ...input.values };
      const auth = writerAuth(opts.auth, WRITER);
      await assertActiveUsers(bound.db, [['assignedTo', v.assignedTo]]);
      return syncErrors(KEYS, async () => {
        if (!input.id) return { id: (await create(bound, auth, v)).id };
        const before = await rowOf(bound, input.id);
        await update(bound, auth, before, v);
        return { id: before.id };
      });
    });
  },

  idFromEvent(event: DomainEvent) {
    const id = (event.payload as { assetId?: unknown }).assetId;
    return isUuid(id) ? id : null;
  },
};

export const sync = { asset: assetAdapter };
