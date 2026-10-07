import { recordLinks, users } from '@isbp/db/schema';
import {
  type AuthContext,
  type Db,
  ErrorCodes,
  formatRecordRef,
  HttpError,
  type ModuleContext,
  type Principal,
  type RecordLinkInfo,
  type RecordRef,
  type RecordsService,
  type RecordTypeDef,
  type ResolvedRecord,
  recordModule,
  type ServerModule,
} from '@isbp/sdk/server';
import { and, eq, inArray, or, type SQL } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { currentPrincipal } from './context';
import type { ModuleRegistry } from './modules';

/** Resolver calls are capped so one slow module can't stall a page of links. */
const RESOLVE_TIMEOUT_MS = 2_000;

export interface RecordTypeEntry {
  type: string;
  moduleId: string;
  module: ServerModule;
  def: RecordTypeDef;
}

const timeout = <T>(p: Promise<T>, fallback: T) =>
  Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), RESOLVE_TIMEOUT_MS))]);

/** The user behind a principal (a person, or the person an agent acts for). */
const actingUser = (p: Principal) => (p.type === 'user' ? p.id : (p.onBehalfOf?.id ?? null));

/** Ends of a link in canonical order (byte order of `type:id`, as the table's check constraint). */
export function orderRefs(a: RecordRef, b: RecordRef): [RecordRef, RecordRef] {
  return formatRecordRef(a) < formatRecordRef(b) ? [a, b] : [b, a];
}

/**
 * The record registry behind `ctx.records`: module-declared record types with their resolvers, and the
 * symmetric links between records (`core.record_links`).
 */
export class RecordRegistry {
  constructor(
    private readonly deps: {
      db: Db;
      registry: ModuleRegistry;
      logger: FastifyBaseLogger;
      core: () => ModuleContext;
      /** Soft-deletes a record's attachments (wired to the file store). */
      forgetFiles: (ref: RecordRef, tx: Db) => Promise<void>;
    },
  ) {}

  /** A declared record type, whether or not its module is enabled. */
  entry(type: string): RecordTypeEntry | null {
    const moduleId = recordModule(type);
    const module = this.deps.registry.get(moduleId);
    const local = type.slice(moduleId.length + 1);
    const def = module?.manifest.records?.types.find((t) => t.type === local);
    return module && def ? { type, moduleId, module, def } : null;
  }

  private usable(type: string): RecordTypeEntry | null {
    const e = this.entry(type);
    return e && this.deps.registry.isEnabled(e.moduleId) ? e : null;
  }

  /** Types of enabled modules the caller may pick from. */
  types(auth: AuthContext): RecordTypeEntry[] {
    return this.deps.registry
      .enabledModules()
      .flatMap((m) =>
        (m.manifest.records?.types ?? [])
          .filter((t) => auth.permissions.hasAny(t.permission))
          .map((def) => ({ type: `${m.manifest.id}.${def.type}`, moduleId: m.manifest.id, module: m, def })),
      );
  }

  private toResolved(e: RecordTypeEntry, s: Awaited<ReturnType<RecordResolverFn>>[number]): ResolvedRecord {
    return {
      type: e.type,
      moduleId: e.moduleId,
      icon: e.def.icon ?? null,
      id: s.id,
      reference: s.reference ?? null,
      title: s.title,
      subtitle: s.subtitle ?? null,
      status: s.status ?? null,
      href: s.href,
      editable: s.editable,
    };
  }

  async resolve(refs: readonly RecordRef[], auth: AuthContext): Promise<Map<string, ResolvedRecord>> {
    const byType = new Map<string, Set<string>>();
    for (const r of refs) {
      const ids = byType.get(r.type) ?? new Set<string>();
      ids.add(r.id);
      byType.set(r.type, ids);
    }
    const out = new Map<string, ResolvedRecord>();
    await Promise.all(
      [...byType].map(async ([type, idSet]) => {
        const e = this.usable(type);
        const resolver = e?.module.records?.[e.def.type];
        if (!e || !resolver) return;
        try {
          const summaries = await timeout(
            resolver.resolve([...idSet], this.deps.registry.context(e.moduleId), auth),
            [],
          );
          for (const s of summaries)
            if (idSet.has(s.id)) out.set(formatRecordRef({ type, id: s.id }), this.toResolved(e, s));
        } catch (err) {
          this.deps.logger.warn({ err, type }, 'record resolver failed');
        }
      }),
    );
    return out;
  }

  async get(ref: RecordRef, auth: AuthContext): Promise<ResolvedRecord | null> {
    return (await this.resolve([ref], auth)).get(formatRecordRef(ref)) ?? null;
  }

  async search(
    query: string,
    opts: { auth: AuthContext; types?: readonly string[]; limit?: number },
  ): Promise<ResolvedRecord[]> {
    const limit = Math.min(Math.max(opts.limit ?? 10, 1), 25);
    const wanted = opts.types?.length ? new Set(opts.types) : null;
    const types = this.types(opts.auth).filter((t) => !wanted || wanted.has(t.type));
    const q = query.trim();
    const results = await Promise.all(
      types.map(async (e) => {
        const resolver = e.module.records?.[e.def.type];
        if (!resolver) return [];
        try {
          const hits = await timeout(
            resolver.search(q, this.deps.registry.context(e.moduleId), opts.auth, limit),
            [],
          );
          return hits.slice(0, limit).map((s) => this.toResolved(e, s));
        } catch (err) {
          this.deps.logger.warn({ err, type: e.type }, 'record search failed');
          return [];
        }
      }),
    );
    // Round-robin across types so one chatty module doesn't crowd out the rest; exact references first.
    const merged: ResolvedRecord[] = [];
    for (let i = 0; merged.length < limit && results.some((r) => r.length > i); i++)
      for (const r of results) if (r[i] && merged.length < limit) merged.push(r[i]!);
    const exact = q.toLowerCase();
    return merged.sort(
      (a, b) => Number(b.reference?.toLowerCase() === exact) - Number(a.reference?.toLowerCase() === exact),
    );
  }

  private assertType(ref: RecordRef) {
    if (!this.entry(ref.type))
      throw new HttpError(400, ErrorCodes.RELATIONSHIP_INVALID, `Unknown record type "${ref.type}"`);
  }

  private pairWhere(a: RecordRef, b: RecordRef): SQL {
    const [x, y] = orderRefs(a, b);
    return and(
      eq(recordLinks.aType, x.type),
      eq(recordLinks.aId, x.id),
      eq(recordLinks.bType, y.type),
      eq(recordLinks.bId, y.id),
    )!;
  }

  private touches(ref: RecordRef): SQL {
    return or(
      and(eq(recordLinks.aType, ref.type), eq(recordLinks.aId, ref.id)),
      and(eq(recordLinks.bType, ref.type), eq(recordLinks.bId, ref.id)),
    )!;
  }

  async link(a: RecordRef, b: RecordRef, opts: { tx?: Db } = {}) {
    this.assertType(a);
    this.assertType(b);
    if (a.type === b.type && a.id === b.id)
      throw new HttpError(400, ErrorCodes.RELATIONSHIP_INVALID, 'A record cannot be linked to itself');
    const [x, y] = orderRefs(a, b);
    const run = async (tx: Db) => {
      const principal = currentPrincipal();
      const [row] = await tx
        .insert(recordLinks)
        .values({ aType: x.type, aId: x.id, bType: y.type, bId: y.id, createdBy: actingUser(principal) })
        .onConflictDoNothing()
        .returning({ id: recordLinks.id });
      if (!row) {
        const [existing] = await tx
          .select({ id: recordLinks.id })
          .from(recordLinks)
          .where(this.pairWhere(a, b));
        return { id: existing!.id, created: false };
      }
      const core = this.deps.core();
      await core.audit.record(
        {
          action: 'core.record.linked',
          entityType: 'record_link',
          entityId: row.id,
          entityLabel: `${formatRecordRef(x)} ↔ ${formatRecordRef(y)}`,
          metadata: { a: x, b: y },
        },
        { tx },
      );
      await core.events.publish('core.record.linked', { linkId: row.id, a: x, b: y }, { tx });
      return { id: row.id, created: true };
    };
    return opts.tx ? run(opts.tx) : this.deps.db.transaction((tx) => run(tx as unknown as Db));
  }

  /** Removes one link; returns the pair, or null when the id is unknown. */
  async unlinkById(id: string, opts: { tx?: Db } = {}): Promise<{ a: RecordRef; b: RecordRef } | null> {
    const run = async (tx: Db) => {
      const [row] = await tx.delete(recordLinks).where(eq(recordLinks.id, id)).returning();
      if (!row) return null;
      const a = { type: row.aType, id: row.aId };
      const b = { type: row.bType, id: row.bId };
      const core = this.deps.core();
      await core.audit.record(
        {
          action: 'core.record.unlinked',
          entityType: 'record_link',
          entityId: row.id,
          entityLabel: `${formatRecordRef(a)} ↔ ${formatRecordRef(b)}`,
          metadata: { a, b },
        },
        { tx },
      );
      await core.events.publish('core.record.unlinked', { linkId: row.id, a, b }, { tx });
      return { a, b };
    };
    return opts.tx ? run(opts.tx) : this.deps.db.transaction((tx) => run(tx as unknown as Db));
  }

  async unlink(a: RecordRef, b: RecordRef, opts: { tx?: Db } = {}): Promise<boolean> {
    const db = opts.tx ?? this.deps.db;
    const [row] = await db.select({ id: recordLinks.id }).from(recordLinks).where(this.pairWhere(a, b));
    return row ? Boolean(await this.unlinkById(row.id, opts)) : false;
  }

  /** One link row, if it touches `ref`. */
  async linkOf(ref: RecordRef, linkId: string) {
    const [row] = await this.deps.db
      .select({ id: recordLinks.id })
      .from(recordLinks)
      .where(and(eq(recordLinks.id, linkId), this.touches(ref)));
    return row ?? null;
  }

  private async rows(ref: RecordRef, types: readonly string[] | undefined, db: Db) {
    const rows = await db
      .select({
        id: recordLinks.id,
        aType: recordLinks.aType,
        aId: recordLinks.aId,
        bType: recordLinks.bType,
        bId: recordLinks.bId,
        createdAt: recordLinks.createdAt,
        createdById: recordLinks.createdBy,
        createdByName: users.displayName,
      })
      .from(recordLinks)
      .leftJoin(users, eq(users.id, recordLinks.createdBy))
      .where(this.touches(ref))
      .orderBy(recordLinks.createdAt);
    const wanted = types?.length ? new Set(types) : null;
    return rows
      .map((r) => {
        const other =
          r.aType === ref.type && r.aId === ref.id
            ? { type: r.bType, id: r.bId }
            : { type: r.aType, id: r.aId };
        return { ...r, other };
      })
      .filter((r) => !wanted || wanted.has(r.other.type));
  }

  async links(
    ref: RecordRef,
    opts: { auth: AuthContext; types?: readonly string[] },
  ): Promise<RecordLinkInfo[]> {
    const rows = await this.rows(ref, opts.types, this.deps.db);
    const resolved = await this.resolve(
      rows.map((r) => r.other),
      opts.auth,
    );
    return rows.map((r) => {
      const record = resolved.get(formatRecordRef(r.other)) ?? null;
      return {
        id: r.id,
        ref: r.other,
        record,
        hidden: record ? null : this.usable(r.other.type) ? 'forbidden' : 'unavailable',
        createdAt: r.createdAt,
        createdBy: r.createdById ? { id: r.createdById, name: r.createdByName ?? '' } : null,
      };
    });
  }

  async linked(ref: RecordRef, opts: { types?: readonly string[]; tx?: Db } = {}): Promise<RecordRef[]> {
    return (await this.rows(ref, opts.types, opts.tx ?? this.deps.db)).map((r) => r.other);
  }

  async forget(ref: RecordRef, opts: { tx?: Db } = {}): Promise<void> {
    const run = async (tx: Db) => {
      await tx.delete(recordLinks).where(this.touches(ref));
      await this.deps.forgetFiles(ref, tx);
    };
    await (opts.tx ? run(opts.tx) : this.deps.db.transaction((tx) => run(tx as unknown as Db)));
  }

  /** Counts per record, for list pages that show a link badge. */
  async counts(refs: readonly RecordRef[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!refs.length) return out;
    const types = [...new Set(refs.map((r) => r.type))];
    const ids = [...new Set(refs.map((r) => r.id))];
    const rows = await this.deps.db
      .select({
        aType: recordLinks.aType,
        aId: recordLinks.aId,
        bType: recordLinks.bType,
        bId: recordLinks.bId,
      })
      .from(recordLinks)
      .where(
        or(
          and(inArray(recordLinks.aType, types), inArray(recordLinks.aId, ids)),
          and(inArray(recordLinks.bType, types), inArray(recordLinks.bId, ids)),
        ),
      );
    const keys = new Set(refs.map(formatRecordRef));
    for (const r of rows)
      for (const k of [
        formatRecordRef({ type: r.aType, id: r.aId }),
        formatRecordRef({ type: r.bType, id: r.bId }),
      ])
        if (keys.has(k)) out.set(k, (out.get(k) ?? 0) + 1);
    return out;
  }

  /** `ctx.records` for one module. */
  service(): RecordsService {
    return {
      resolve: (refs, auth) => this.resolve(refs, auth),
      get: (ref, auth) => this.get(ref, auth),
      search: (q, opts) => this.search(q, opts),
      link: (a, b, opts) => this.link(a, b, opts),
      unlink: (a, b, opts) => this.unlink(a, b, opts),
      links: (ref, opts) => this.links(ref, opts),
      linked: (ref, opts) => this.linked(ref, opts),
      counts: (refs) => this.counts(refs),
      forget: (ref, opts) => this.forget(ref, opts),
    };
  }
}

type RecordResolverFn = NonNullable<ServerModule['records']>[string]['resolve'];
