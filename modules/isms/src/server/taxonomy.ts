/**
 * The register's configuration: asset classes (with sub-classes and C/I/A scoring guidance), sites and
 * classification labels. A fresh install gets generic defaults (texts from the module's catalogs) the first time
 * anything reads the taxonomy. Classes, sites and labels are archived, never deleted: assets keep pointing at them.
 */
import {
  type AuthContext,
  type Db,
  httpErrors,
  type LocalizedText,
  type ModuleContext,
} from '@isbp/sdk/server';
import { asc, count, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import type {
  createLabelSchema,
  createSiteSchema,
  Guidance,
  OptionalLocalized,
  updateClassSchema,
  updateLabelSchema,
  updateSiteSchema,
  upsertClassSchema,
} from '../contracts';
import { CIA_DIMENSIONS, CIA_LEVELS } from '../model';
import { P } from './access';
import { assets, classes, labels, sites, subclasses } from './schema';
import { type Catalog, invalidField, pgCode, pgConstraint, textOf, UNIQUE_VIOLATION } from './support';

export type UpsertClassData = z.output<typeof upsertClassSchema>;
export type UpdateClassData = z.output<typeof updateClassSchema>;
type CreateSiteData = z.output<typeof createSiteSchema>;
type UpdateSiteData = z.output<typeof updateSiteSchema>;
type CreateLabelData = z.output<typeof createLabelSchema>;
type UpdateLabelData = z.output<typeof updateLabelSchema>;

/* ───────────────────────────── defaults ───────────────────────────── */

type DefaultClass = keyof Catalog['defaults']['classes'];

/** Default classes and sub-classes (codes and keys; names and guidance come from the catalogs). */
export const DEFAULT_TAXONOMY: { code: DefaultClass; subclasses: string[] }[] = [
  { code: 'PE', subclasses: ['internal-people', 'external-people'] },
  {
    code: 'HW',
    subclasses: ['servers', 'network-devices', 'portable-media', 'mobile-devices', 'iot-devices'],
  },
  { code: 'SW', subclasses: ['operating-systems', 'packaged-software'] },
  {
    code: 'DA',
    subclasses: ['operational-documents', 'system-documents', 'electronic-records', 'contracts'],
  },
  { code: 'SV', subclasses: ['internal-services', 'external-services'] },
];

export const DEFAULT_LABELS = [
  { key: 'strictly-confidential', rank: 40 },
  { key: 'customer-confidential', rank: 30 },
  { key: 'confidential', rank: 20 },
  { key: 'internal-use-only', rank: 10 },
] as const;

export const DEFAULT_SITE = { code: 'HQ01', name: 'Head office' };

type CatalogClass = Catalog['defaults']['classes']['PE'];
type Dim = 'c' | 'i' | 'a';
type Lvl = '1' | '2' | '3' | '4';

/** The default guidance of a class, in three languages, from the catalogs. */
export function defaultGuidance(code: DefaultClass): Guidance {
  const out = {} as Guidance;
  for (const d of CIA_DIMENSIONS as readonly Dim[]) {
    out[d] = {} as Guidance[Dim];
    for (const l of CIA_LEVELS.map(String) as Lvl[])
      out[d][l] = textOf((c) => (c.defaults.classes[code] as CatalogClass).guidance[d][l]);
  }
  return out;
}

export function defaultClassValue(code: DefaultClass, sortOrder: number): UpsertClassData {
  const subs = CATALOG_SUBCLASSES(code);
  return {
    code,
    name: textOf((c) => c.defaults.classes[code].name),
    description: textOf((c) => c.defaults.classes[code].description),
    guidance: defaultGuidance(code),
    sortOrder,
    subclasses: DEFAULT_TAXONOMY.find((t) => t.code === code)!.subclasses.map((key) => ({
      key,
      name: subs(key, 'name'),
      description: subs(key, 'description'),
    })),
  };
}

function CATALOG_SUBCLASSES(code: DefaultClass) {
  return (key: string, field: 'name' | 'description'): LocalizedText =>
    textOf((c) => {
      const all = c.defaults.classes[code].subclasses as Record<
        string,
        { name: string; description: string }
      >;
      return all[key]![field];
    });
}

const ensured = new WeakSet<Db>();

/**
 * Creates the default classes, labels and site when none exist (idempotent, safe to race: unique codes). Runs
 * once per database handle and process.
 */
export async function ensureDefaults(ctx: ModuleContext): Promise<void> {
  if (ensured.has(ctx.db)) return;
  const [[c], [l], [s]] = await Promise.all([
    ctx.db.select({ n: count() }).from(classes),
    ctx.db.select({ n: count() }).from(labels),
    ctx.db.select({ n: count() }).from(sites),
  ]);
  if (c!.n && l!.n && s!.n) {
    ensured.add(ctx.db);
    return;
  }
  await ctx.transaction(async (tx) => {
    const created: string[] = [];
    if (!c!.n) {
      let order = 0;
      for (const { code } of DEFAULT_TAXONOMY) {
        const value = defaultClassValue(code, (order += 10));
        const [row] = await tx
          .insert(classes)
          .values({
            code,
            name: value.name,
            description: value.description ?? null,
            guidance: value.guidance,
            sortOrder: value.sortOrder ?? 0,
          })
          .onConflictDoNothing()
          .returning({ id: classes.id });
        if (!row) continue;
        created.push(`class:${code}`);
        await tx.insert(subclasses).values(
          value.subclasses.map((sc, i) => ({
            classId: row.id,
            key: sc.key,
            name: sc.name,
            description: sc.description ?? null,
            sortOrder: (i + 1) * 10,
          })),
        );
      }
    }
    if (!l!.n) {
      const rows = await tx
        .insert(labels)
        .values(
          DEFAULT_LABELS.map((d) => ({
            key: d.key,
            rank: d.rank,
            name: textOf((cat) => cat.defaults.labels[d.key].name),
            description: textOf((cat) => cat.defaults.labels[d.key].description),
          })),
        )
        .onConflictDoNothing()
        .returning({ key: labels.key });
      created.push(...rows.map((r) => `label:${r.key}`));
    }
    if (!s!.n) {
      const rows = await tx.insert(sites).values(DEFAULT_SITE).onConflictDoNothing().returning();
      created.push(...rows.map((r) => `site:${r.code}`));
    }
    if (created.length)
      await ctx.audit.record(
        { action: 'isms.taxonomy.defaults_created', entityType: 'isms.taxonomy', metadata: { created } },
        { tx },
      );
  });
  ensured.add(ctx.db);
}

/* ───────────────────────────── DTOs ───────────────────────────── */

type ClassRow = typeof classes.$inferSelect;
type SubclassRow = typeof subclasses.$inferSelect;
type SiteRow = typeof sites.$inferSelect;
type LabelRow = typeof labels.$inferSelect;

const subclassDto = (s: SubclassRow) => ({
  id: s.id,
  key: s.key,
  name: s.name,
  description: s.description ?? null,
  sortOrder: s.sortOrder,
  archived: s.archived,
});

export function classDto(c: ClassRow, subs: SubclassRow[], assetCount: number) {
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    description: c.description ?? null,
    guidance: c.guidance,
    sortOrder: c.sortOrder,
    archived: c.archived,
    subclasses: subs.filter((s) => s.classId === c.id).map(subclassDto),
    assetCount,
  };
}

export const siteDto = (s: SiteRow, assetCount: number) => ({
  id: s.id,
  code: s.code,
  name: s.name,
  description: s.description,
  archived: s.archived,
  assetCount,
});

export const labelDto = (l: LabelRow) => ({
  id: l.id,
  key: l.key,
  name: l.name,
  description: l.description ?? null,
  rank: l.rank,
  archived: l.archived,
});

const cleanLocalized = (t: OptionalLocalized | null | undefined): OptionalLocalized | null => {
  if (!t) return null;
  const out: OptionalLocalized = {};
  for (const k of ['en', 'zh-TW', 'ja-JP'] as const) if (t[k]?.trim()) out[k] = t[k]!.trim();
  return Object.keys(out).length ? out : null;
};

/* ───────────────────────────── service ───────────────────────────── */

export class TaxonomyService {
  constructor(private readonly ctx: ModuleContext) {}

  private get db() {
    return this.ctx.db;
  }

  /** Everything the register's forms and filters need (`all` includes archived entries). */
  async taxonomy(all = false) {
    await ensureDefaults(this.ctx);
    const [cls, sts, lbls] = await Promise.all([this.classes(all), this.sites(all), this.labels(all)]);
    return { classes: cls, sites: sts, labels: lbls };
  }

  async classes(includeArchived: boolean) {
    await ensureDefaults(this.ctx);
    const [rows, subs, counts] = await Promise.all([
      this.db
        .select()
        .from(classes)
        .where(includeArchived ? undefined : eq(classes.archived, false))
        .orderBy(asc(classes.sortOrder), asc(classes.code)),
      this.db.select().from(subclasses).orderBy(asc(subclasses.sortOrder), asc(subclasses.key)),
      this.db.select({ id: assets.classId, n: count() }).from(assets).groupBy(assets.classId),
    ]);
    const n = new Map(counts.map((c) => [c.id, c.n]));
    return rows.map((c) =>
      classDto(
        c,
        subs.filter((s) => includeArchived || !s.archived),
        n.get(c.id) ?? 0,
      ),
    );
  }

  async classById(id: string, db: Db = this.db) {
    const [row] = await db.select().from(classes).where(eq(classes.id, id));
    if (!row) throw httpErrors.notFound('Class not found');
    const subs = await db
      .select()
      .from(subclasses)
      .where(eq(subclasses.classId, id))
      .orderBy(asc(subclasses.sortOrder), asc(subclasses.key));
    const [c] = await db.select({ n: count() }).from(assets).where(eq(assets.classId, id));
    return classDto(row, subs, c!.n);
  }

  /** The value of a class as the admin form (and the customisation kind) edits it. */
  valueOf(dto: ReturnType<typeof classDto>): UpsertClassData {
    return {
      code: dto.code,
      name: dto.name,
      description: dto.description,
      guidance: dto.guidance,
      sortOrder: dto.sortOrder,
      subclasses: dto.subclasses.map((s) => ({
        id: s.id,
        key: s.key,
        name: s.name,
        description: s.description,
        archived: s.archived,
      })),
    };
  }

  private checkSubclasses(list: UpsertClassData['subclasses']) {
    const keys = new Set<string>();
    list.forEach((s, i) => {
      if (keys.has(s.key))
        throw invalidField(`subclasses.${i}.key`, 'Each sub-class needs its own key', 'duplicate');
      keys.add(s.key);
    });
  }

  async createClass(input: UpsertClassData, auth: AuthContext) {
    auth.require(P.configManage);
    await ensureDefaults(this.ctx);
    this.checkSubclasses(input.subclasses);
    try {
      return await this.ctx.transaction(async (tx) => {
        const [row] = await tx
          .insert(classes)
          .values({
            code: input.code,
            name: input.name,
            description: cleanLocalized(input.description),
            guidance: input.guidance,
            sortOrder: input.sortOrder ?? 100,
          })
          .returning();
        if (input.subclasses.length)
          await tx.insert(subclasses).values(
            input.subclasses.map((s, i) => ({
              classId: row!.id,
              key: s.key,
              name: s.name,
              description: cleanLocalized(s.description),
              archived: s.archived ?? false,
              sortOrder: (i + 1) * 10,
            })),
          );
        await this.changed(tx, 'class', row!.id, row!.code, 'created', auth, { name: row!.name });
        return this.classById(row!.id, tx);
      });
    } catch (err) {
      if (pgCode(err) === UNIQUE_VIOLATION && pgConstraint(err) === 'classes_code_uq')
        throw invalidField('code', 'Another class has this code', 'duplicate');
      throw err;
    }
  }

  async updateClass(id: string, input: UpdateClassData, auth: AuthContext) {
    auth.require(P.configManage);
    const before = await this.classById(id);
    if (input.code !== undefined && input.code !== before.code)
      throw invalidField('code', 'The code of a class cannot change (asset numbers carry it)', 'immutable');
    if (input.subclasses) this.checkSubclasses(input.subclasses);
    return this.ctx.transaction(async (tx) => {
      const patch: Partial<typeof classes.$inferInsert> = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.description !== undefined) patch.description = cleanLocalized(input.description);
      if (input.guidance !== undefined) patch.guidance = input.guidance;
      if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;
      if (Object.keys(patch).length) await tx.update(classes).set(patch).where(eq(classes.id, id));
      if (input.subclasses) {
        const existing = new Map(before.subclasses.map((s) => [s.id, s]));
        const byKey = new Map(before.subclasses.map((s) => [s.key, s]));
        const kept = new Set<string>();
        for (const [i, s] of input.subclasses.entries()) {
          const current = (s.id && existing.get(s.id)) || byKey.get(s.key);
          const values = {
            key: s.key,
            name: s.name,
            description: cleanLocalized(s.description),
            archived: s.archived ?? false,
            sortOrder: (i + 1) * 10,
          };
          if (current) {
            kept.add(current.id);
            await tx.update(subclasses).set(values).where(eq(subclasses.id, current.id));
          } else {
            const [row] = await tx
              .insert(subclasses)
              .values({ ...values, classId: id })
              .returning({ id: subclasses.id });
            kept.add(row!.id);
          }
        }
        const dropped = before.subclasses.filter((s) => !kept.has(s.id) && !s.archived).map((s) => s.id);
        if (dropped.length)
          await tx.update(subclasses).set({ archived: true }).where(inArray(subclasses.id, dropped));
      }
      const after = await this.classById(id, tx);
      const changes = this.ctx.audit.diff(
        this.valueOf(before) as unknown as Record<string, unknown>,
        this.valueOf(after) as unknown as Record<string, unknown>,
      );
      if (Object.keys(changes).length)
        await this.changed(tx, 'class', id, after.code, 'updated', auth, {}, changes);
      return after;
    });
  }

  async setClassArchived(id: string, archived: boolean, auth: AuthContext) {
    auth.require(P.configManage);
    const before = await this.classById(id);
    if (before.archived === archived) return before;
    return this.ctx.transaction(async (tx) => {
      await tx.update(classes).set({ archived }).where(eq(classes.id, id));
      await this.changed(tx, 'class', id, before.code, archived ? 'archived' : 'restored', auth);
      return this.classById(id, tx);
    });
  }

  /* sites */

  async sites(includeArchived: boolean) {
    await ensureDefaults(this.ctx);
    const [rows, counts] = await Promise.all([
      this.db
        .select()
        .from(sites)
        .where(includeArchived ? undefined : eq(sites.archived, false))
        .orderBy(asc(sites.code)),
      this.db.select({ id: assets.siteId, n: count() }).from(assets).groupBy(assets.siteId),
    ]);
    const n = new Map(counts.map((c) => [c.id, c.n]));
    return rows.map((s) => siteDto(s, n.get(s.id) ?? 0));
  }

  async site(id: string, db: Db = this.db) {
    const [row] = await db.select().from(sites).where(eq(sites.id, id));
    if (!row) throw httpErrors.notFound('Site not found');
    const [c] = await db.select({ n: count() }).from(assets).where(eq(assets.siteId, id));
    return siteDto(row, c!.n);
  }

  async createSite(input: CreateSiteData, auth: AuthContext) {
    auth.require(P.configManage);
    try {
      return await this.ctx.transaction(async (tx) => {
        const [row] = await tx
          .insert(sites)
          .values({ code: input.code, name: input.name, description: input.description })
          .returning();
        await this.changed(tx, 'site', row!.id, row!.code, 'created', auth, { name: row!.name });
        return siteDto(row!, 0);
      });
    } catch (err) {
      if (pgCode(err) === UNIQUE_VIOLATION && pgConstraint(err) === 'sites_code_uq')
        throw invalidField('code', 'Another site has this code', 'duplicate');
      throw err;
    }
  }

  async updateSite(id: string, input: UpdateSiteData, auth: AuthContext) {
    auth.require(P.configManage);
    const before = await this.site(id);
    const patch: Partial<typeof sites.$inferInsert> = {};
    if (input.name !== undefined && input.name !== before.name) patch.name = input.name;
    if (input.description !== undefined && input.description !== before.description)
      patch.description = input.description;
    if (input.archived !== undefined && input.archived !== before.archived) patch.archived = input.archived;
    if (!Object.keys(patch).length) return before;
    return this.ctx.transaction(async (tx) => {
      await tx.update(sites).set(patch).where(eq(sites.id, id));
      const op =
        patch.archived === true ? 'archived' : patch.archived === false ? 'restored' : ('updated' as const);
      await this.changed(
        tx,
        'site',
        id,
        before.code,
        op,
        auth,
        {},
        this.ctx.audit.diff(before as unknown as Record<string, unknown>, patch as Record<string, unknown>),
      );
      return this.site(id, tx);
    });
  }

  /* labels */

  async labels(includeArchived: boolean) {
    await ensureDefaults(this.ctx);
    const rows = await this.db
      .select()
      .from(labels)
      .where(includeArchived ? undefined : eq(labels.archived, false))
      .orderBy(asc(labels.rank), asc(labels.key));
    return rows.reverse().map(labelDto);
  }

  async label(id: string, db: Db = this.db) {
    const [row] = await db.select().from(labels).where(eq(labels.id, id));
    if (!row) throw httpErrors.notFound('Label not found');
    return labelDto(row);
  }

  async createLabel(input: CreateLabelData, auth: AuthContext) {
    auth.require(P.configManage);
    try {
      return await this.ctx.transaction(async (tx) => {
        const [row] = await tx
          .insert(labels)
          .values({
            key: input.key,
            name: input.name,
            description: cleanLocalized(input.description),
            rank: input.rank ?? 0,
          })
          .returning();
        await this.changed(tx, 'label', row!.id, row!.key, 'created', auth, { name: row!.name });
        return labelDto(row!);
      });
    } catch (err) {
      if (pgCode(err) === UNIQUE_VIOLATION && pgConstraint(err) === 'labels_key_uq')
        throw invalidField('key', 'Another label has this key', 'duplicate');
      throw err;
    }
  }

  async updateLabel(id: string, input: UpdateLabelData, auth: AuthContext) {
    auth.require(P.configManage);
    const before = await this.label(id);
    const patch: Partial<typeof labels.$inferInsert> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = cleanLocalized(input.description);
    if (input.rank !== undefined) patch.rank = input.rank;
    if (input.archived !== undefined) patch.archived = input.archived;
    const changes = this.ctx.audit.diff(
      before as unknown as Record<string, unknown>,
      patch as Record<string, unknown>,
    );
    if (!Object.keys(changes).length) return before;
    return this.ctx.transaction(async (tx) => {
      await tx.update(labels).set(patch).where(eq(labels.id, id));
      const op =
        changes.archived && patch.archived
          ? 'archived'
          : changes.archived
            ? 'restored'
            : ('updated' as const);
      await this.changed(tx, 'label', id, before.key, op, auth, {}, changes);
      return this.label(id, tx);
    });
  }

  private async changed(
    tx: Db,
    kind: 'class' | 'site' | 'label',
    id: string,
    code: string,
    op: 'created' | 'updated' | 'archived' | 'restored',
    _auth: AuthContext,
    metadata: Record<string, unknown> = {},
    changes?: Record<string, [unknown, unknown]>,
  ) {
    await this.ctx.audit.record(
      {
        action: `isms.${kind}.${op}`,
        entityType: `isms.${kind}`,
        entityId: id,
        entityLabel: code,
        changes,
        metadata: Object.keys(metadata).length ? metadata : undefined,
      },
      { tx },
    );
    await this.ctx.events.publish('isms.taxonomy.changed', { kind, id, code, op }, { tx });
  }
}
