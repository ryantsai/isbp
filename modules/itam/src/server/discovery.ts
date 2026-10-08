/**
 * Software discovery: what inventory tools (`POST /discovery/software`) and CSV imports report as installed on each
 * device, the reports themselves, and the title rules asset managers use for discovered titles that match no
 * licence's product: count the title as a licence's product (mapped) or leave it out of the review list (ignored).
 */
import { users } from '@isbp/db/schema';
import {
  type AuthContext,
  type Db,
  ErrorCodes,
  HttpError,
  httpErrors,
  likePattern,
  type ModuleContext,
} from '@isbp/sdk/server';
import {
  and,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  ne,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { z } from 'zod';
import type {
  createTitleRuleSchema,
  discoveryImportSchema,
  discoverySchema,
  titleRuleQuerySchema,
} from '../contracts';
import { formatAssetTag, formatLicenseRef, parseRef } from '../model';
import { all, HARDWARE_MANAGE, SOFTWARE_MANAGE } from './access';
import { INACTIVE_DEVICE, type LicenseService, lower } from './licenses';
import {
  type AssetRow,
  assets,
  discoveryReports,
  licenses,
  softwareInstallations,
  softwareTitleRules,
} from './schema';
import { actingUserId, actorOf, peopleByIds, pgCode, UNIQUE_VIOLATION } from './support';

type DiscoveryData = z.output<typeof discoverySchema>;
type ImportData = z.output<typeof discoveryImportSchema>;
type RuleData = z.output<typeof createTitleRuleSchema>;
type RuleQuery = z.output<typeof titleRuleQuerySchema>;
type PageQuery = { page: number; pageSize: number; q?: string };

const RULE_ENTITY = 'itam.title-rule';

const assetRef = (a: Pick<AssetRow, 'id' | 'number' | 'name' | 'category' | 'status'>) => ({
  id: a.id,
  tag: formatAssetTag(a.number),
  name: a.name,
  category: a.category,
  status: a.status,
});

export class DiscoveryService {
  constructor(
    private readonly ctx: ModuleContext,
    private readonly licenses: LicenseService,
  ) {}

  private get db() {
    return this.ctx.db;
  }

  /** The device a report is about: by id, serial number (case-insensitive) or asset tag. */
  private async assetOf(input: { assetId?: string; assetSerial?: string; assetTag?: string }) {
    let where: SQL | undefined;
    if (input.assetId) where = eq(assets.id, input.assetId);
    else if (input.assetSerial)
      where = eq(sql`lower(${assets.serialNumber})`, input.assetSerial.trim().toLowerCase());
    else if (input.assetTag) {
      const ref = parseRef('asset', input.assetTag);
      if (ref) where = 'id' in ref ? eq(assets.id, ref.id) : eq(assets.number, ref.number);
    }
    if (!where) return null;
    const [asset] = await this.db.select().from(assets).where(where).limit(1);
    return asset ?? null;
  }

  /** Mapped titles among these (lower-cased) titles → the licence product they count as. */
  private async mappedTitles(db: Db, titles: readonly string[]): Promise<Map<string, string>> {
    if (!titles.length) return new Map();
    const rows = await db
      .select({ title: softwareTitleRules.title, product: licenses.product })
      .from(softwareTitleRules)
      .innerJoin(licenses, eq(licenses.id, softwareTitleRules.licenseId))
      .where(inArray(sql`lower(${softwareTitleRules.title})`, [...new Set(titles)]));
    return new Map(rows.map((r) => [lower(r.title), r.product]));
  }

  /**
   * An inventory tool reports the **complete** list of products on one device. Reported products are
   * upserted (`last_seen_at` = now); products of an earlier report that are missing now were uninstalled
   * and are deleted. Manually recorded installs are kept. A title with a mapping rule is stored as its
   * licence's product (`reported_as` keeps the title). Compliance of the affected products follows, and the
   * report is listed on the Discovery page.
   */
  async discover(input: DiscoveryData, auth: AuthContext, opts: { fileName?: string | null } = {}) {
    auth.require(HARDWARE_MANAGE);
    const asset = await this.assetOf(input);
    if (!asset) throw httpErrors.notFound('Asset not found');
    const mapped = await this.mappedTitles(
      this.db,
      input.products.map((p) => lower(p.product)),
    );
    type Incoming = (typeof input.products)[number] & { reportedAs: string | null };
    const reported = new Map<string, Incoming>();
    for (const p of input.products) {
      const product = mapped.get(lower(p.product));
      const key = lower(product ?? p.product);
      if (!reported.has(key))
        reported.set(key, { ...p, product: product ?? p.product, reportedAs: product ? p.product : null });
    }
    const now = new Date();
    const actor = actorOf(auth);
    const result = await this.ctx.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(softwareInstallations)
        .where(eq(softwareInstallations.assetId, asset.id))
        .for('update');
      const byProduct = new Map(existing.map((e) => [lower(e.product), e]));
      let added = 0;
      let updated = 0;
      const touched = new Set<string>();
      for (const [key, p] of reported) {
        const row = byProduct.get(key);
        if (row) {
          await tx
            .update(softwareInstallations)
            .set({
              publisher: p.publisher ?? row.publisher,
              version: p.version ?? row.version,
              reportedAs: row.source === 'manual' ? row.reportedAs : p.reportedAs,
              lastSeenAt: now,
              source: row.source === 'manual' ? 'manual' : input.source,
            })
            .where(eq(softwareInstallations.id, row.id));
          updated++;
        } else {
          await tx.insert(softwareInstallations).values({
            assetId: asset.id,
            product: p.product,
            reportedAs: p.reportedAs,
            publisher: p.publisher,
            version: p.version,
            firstSeenAt: now,
            lastSeenAt: now,
            source: input.source,
          });
          added++;
          touched.add(p.product);
        }
      }
      const gone = existing.filter((e) => !reported.has(lower(e.product)) && e.source !== 'manual');
      if (gone.length)
        await tx.delete(softwareInstallations).where(
          inArray(
            softwareInstallations.id,
            gone.map((g) => g.id),
          ),
        );
      for (const g of gone) touched.add(g.product);
      const counts = { reported: reported.size, added, updated, removed: gone.length };
      await tx.insert(discoveryReports).values({
        assetId: asset.id,
        source: input.source,
        fileName: opts.fileName ?? null,
        ...counts,
        actorId: actor.actorId,
        actorName: actor.actorName,
        createdAt: now,
      });
      await this.ctx.audit.record(
        {
          action: 'itam.discovery.reported',
          entityType: 'itam.asset',
          entityId: asset.id,
          entityLabel: `${formatAssetTag(asset.number)} ${asset.name}`,
          metadata: { source: input.source, fileName: opts.fileName ?? null, ...counts },
        },
        { tx },
      );
      await this.licenses.recomputeProducts(tx, [...touched]);
      return { added, updated, removed: gone.length };
    });
    const coverage = await this.licenses.installations(
      { assetId: asset.id },
      { page: 1, pageSize: 2000, unlicensed: true },
    );
    return {
      asset: assetRef(asset),
      ...result,
      unlicensed: coverage.items.filter((i) => i.managed).map((i) => i.product),
    };
  }

  /**
   * A batch of devices from a CSV export (parsed in the browser): each one is a complete report through
   * `discover`, in its own transaction. Devices the platform doesn't know are listed as `not_found`.
   */
  async importDevices(input: ImportData, auth: AuthContext) {
    auth.require(HARDWARE_MANAGE);
    const results = [];
    for (const d of input.devices) {
      const device = d.assetSerial ?? d.assetTag ?? '';
      try {
        const r = await this.discover(
          { assetSerial: d.assetSerial, assetTag: d.assetTag, products: d.products, source: 'import' },
          auth,
          { fileName: input.fileName },
        );
        results.push({ device, status: 'imported' as const, asset: r.asset, ...pick(r) });
      } catch (err) {
        if ((err as { statusCode?: number } | null)?.statusCode !== 404) throw err;
        results.push({ device, status: 'not_found' as const, asset: null, added: 0, updated: 0, removed: 0 });
      }
    }
    return { results };
  }

  /** Reports, newest first (filter by asset tag, name or serial number, or by file name). */
  async reports(q: PageQuery & { source?: 'api' | 'import' }, auth: AuthContext) {
    auth.require(HARDWARE_MANAGE);
    const ref = q.q ? parseRef('asset', q.q) : null;
    const where = all(
      q.source ? eq(discoveryReports.source, q.source) : undefined,
      q.q
        ? or(
            ilike(assets.name, likePattern(q.q)),
            ilike(assets.serialNumber, likePattern(q.q)),
            ilike(discoveryReports.fileName, likePattern(q.q)),
            ref && 'number' in ref ? eq(assets.number, ref.number) : undefined,
          )
        : undefined,
    );
    const [rows, [total]] = await Promise.all([
      this.db
        .select({ r: discoveryReports, a: assets })
        .from(discoveryReports)
        .innerJoin(assets, eq(assets.id, discoveryReports.assetId))
        .where(where)
        .orderBy(desc(discoveryReports.createdAt), desc(discoveryReports.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(discoveryReports)
        .innerJoin(assets, eq(assets.id, discoveryReports.assetId))
        .where(where),
    ]);
    const people = await peopleByIds(
      this.db,
      rows.map((x) => x.r.actorId),
    );
    return {
      items: rows.map(({ r, a }) => {
        const person = r.actorId ? people.get(r.actorId) : null;
        return {
          id: r.id,
          asset: assetRef(a),
          source: r.source,
          fileName: r.fileName,
          reported: r.reported,
          added: r.added,
          updated: r.updated,
          removed: r.removed,
          by: person
            ? { id: r.actorId, displayName: person.displayName }
            : r.actorName
              ? { id: null, displayName: r.actorName }
              : null,
          createdAt: r.createdAt,
        };
      }),
      total: total?.n ?? 0,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /**
   * Discovered titles (reported by a tool or an import, on devices still in use) that match no licence's product
   * and have no rule: most widespread first.
   */
  async titles(q: PageQuery, auth: AuthContext) {
    auth.require(HARDWARE_MANAGE);
    const key = sql`lower(${softwareInstallations.product})`;
    const devices = sql<number>`count(distinct ${softwareInstallations.assetId})::int`;
    const where = and(
      ne(softwareInstallations.source, 'manual'),
      notInArray(assets.status, INACTIVE_DEVICE),
      sql`not exists (select 1 from ${licenses} l where lower(l.product) = ${key})`,
      sql`not exists (select 1 from ${softwareTitleRules} r where lower(r.title) = ${key})`,
      q.q ? ilike(softwareInstallations.product, likePattern(q.q)) : undefined,
    );
    const [rows, [total]] = await Promise.all([
      this.db
        .select({
          title: sql<string>`min(${softwareInstallations.product})`,
          publisher: sql<string | null>`min(${softwareInstallations.publisher})`,
          devices,
          lastSeenAt: sql<Date>`max(${softwareInstallations.lastSeenAt})`,
        })
        .from(softwareInstallations)
        .innerJoin(assets, eq(assets.id, softwareInstallations.assetId))
        .where(where)
        .groupBy(key)
        .orderBy(sql`${devices} desc`, sql`min(${softwareInstallations.product}) asc`)
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db
        .select({ n: sql<number>`count(distinct ${key})::int` })
        .from(softwareInstallations)
        .innerJoin(assets, eq(assets.id, softwareInstallations.assetId))
        .where(where),
    ]);
    return {
      items: rows.map((r) => ({ ...r, lastSeenAt: new Date(r.lastSeenAt) })),
      total: total?.n ?? 0,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /** Title rules, newest first. */
  async rules(q: RuleQuery, auth: AuthContext) {
    auth.require(HARDWARE_MANAGE);
    const where = all(
      q.kind === 'mapped' ? isNotNull(softwareTitleRules.licenseId) : undefined,
      q.kind === 'ignored' ? isNull(softwareTitleRules.licenseId) : undefined,
      q.q
        ? or(ilike(softwareTitleRules.title, likePattern(q.q)), ilike(licenses.product, likePattern(q.q)))
        : undefined,
    );
    const [rows, [total]] = await Promise.all([
      this.db
        .select({
          rule: softwareTitleRules,
          licenseNumber: licenses.number,
          licenseProduct: licenses.product,
          createdByName: users.displayName,
        })
        .from(softwareTitleRules)
        .leftJoin(licenses, eq(licenses.id, softwareTitleRules.licenseId))
        .leftJoin(users, eq(users.id, softwareTitleRules.createdBy))
        .where(where)
        .orderBy(desc(softwareTitleRules.createdAt), desc(softwareTitleRules.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(softwareTitleRules)
        .leftJoin(licenses, eq(licenses.id, softwareTitleRules.licenseId))
        .where(where),
    ]);
    return {
      items: rows.map((r) => this.ruleDto(r)),
      total: total?.n ?? 0,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  private ruleDto(r: {
    rule: typeof softwareTitleRules.$inferSelect;
    licenseNumber: number | null;
    licenseProduct: string | null;
    createdByName: string | null;
  }) {
    return {
      id: r.rule.id,
      title: r.rule.title,
      license:
        r.rule.licenseId && r.licenseNumber !== null
          ? {
              id: r.rule.licenseId,
              reference: formatLicenseRef(r.licenseNumber),
              product: r.licenseProduct ?? '',
            }
          : null,
      createdBy:
        r.rule.createdBy && r.createdByName ? { id: r.rule.createdBy, displayName: r.createdByName } : null,
      createdAt: r.rule.createdAt,
    };
  }

  private async ruleById(id: string) {
    const [row] = await this.db
      .select({
        rule: softwareTitleRules,
        licenseNumber: licenses.number,
        licenseProduct: licenses.product,
        createdByName: users.displayName,
      })
      .from(softwareTitleRules)
      .leftJoin(licenses, eq(licenses.id, softwareTitleRules.licenseId))
      .leftJoin(users, eq(users.id, softwareTitleRules.createdBy))
      .where(eq(softwareTitleRules.id, id));
    if (!row) throw httpErrors.notFound('Title rule not found');
    return this.ruleDto(row);
  }

  /**
   * Maps a discovered title to a licence (its installs now count as the licence's product, on every device, from
   * now on) or ignores it (it needs no licence). Licence compliance follows in the same transaction.
   */
  async createRule(input: RuleData, auth: AuthContext) {
    auth.require(SOFTWARE_MANAGE);
    const title = input.title.trim();
    const [license] = input.licenseId
      ? await this.db.select().from(licenses).where(eq(licenses.id, input.licenseId))
      : [];
    if (input.licenseId && !license) throw httpErrors.notFound('Licence not found');
    const [matches] = await this.db
      .select({ id: licenses.id })
      .from(licenses)
      .where(eq(sql`lower(${licenses.product})`, lower(title)))
      .limit(1);
    if (matches)
      throw new HttpError(409, ErrorCodes.INVALID_STATE, 'This title already matches a licence’s product', {
        title,
      });
    try {
      const id = await this.ctx.transaction(async (tx) => {
        const [rule] = await tx
          .insert(softwareTitleRules)
          .values({ title, licenseId: license?.id ?? null, createdBy: actingUserId(auth) })
          .returning();
        let devices = 0;
        if (license) {
          // The device already reports the licence's product under its own name: keep that install.
          await tx.execute(sql`
            delete from ${softwareInstallations} i
             where lower(i.product) = ${lower(title)}
               and exists (select 1 from ${softwareInstallations} j
                            where j.asset_id = i.asset_id and lower(j.product) = ${lower(license.product)})`);
          const renamed = await tx
            .update(softwareInstallations)
            .set({ product: license.product, reportedAs: sql`${softwareInstallations.product}` })
            .where(eq(sql`lower(${softwareInstallations.product})`, lower(title)))
            .returning({ id: softwareInstallations.id });
          devices = renamed.length;
          await this.licenses.recomputeProducts(tx, [license.product]);
        }
        await this.ctx.audit.record(
          {
            action: 'itam.title-rule.created',
            entityType: RULE_ENTITY,
            entityId: rule!.id,
            entityLabel: title,
            metadata: license
              ? { title, licenseId: license.id, product: license.product, devices }
              : { title, ignored: true },
          },
          { tx },
        );
        await this.ctx.events.publish(
          'itam.title-rule.created',
          { ruleId: rule!.id, title, licenseId: license?.id ?? null },
          { tx },
        );
        return rule!.id;
      });
      return this.ruleById(id);
    } catch (err) {
      if (pgCode(err) === UNIQUE_VIOLATION)
        throw new HttpError(409, ErrorCodes.CONFLICT, 'There is already a rule for this title', { title });
      throw err;
    }
  }

  /** Removes a rule: a mapped title's installs go back to the reported title, and compliance follows. */
  async deleteRule(id: string, auth: AuthContext) {
    auth.require(SOFTWARE_MANAGE);
    await this.ctx.transaction(async (tx) => {
      const [rule] = await tx
        .select()
        .from(softwareTitleRules)
        .where(eq(softwareTitleRules.id, id))
        .for('update');
      if (!rule) throw httpErrors.notFound('Title rule not found');
      const [license] = rule.licenseId
        ? await tx.select().from(licenses).where(eq(licenses.id, rule.licenseId))
        : [];
      if (license) {
        // A device that also has the title recorded by hand keeps that entry.
        await tx.execute(sql`
          delete from ${softwareInstallations} i
           where lower(i.reported_as) = ${lower(rule.title)}
             and exists (select 1 from ${softwareInstallations} j
                          where j.asset_id = i.asset_id and lower(j.product) = ${lower(rule.title)})`);
        await tx
          .update(softwareInstallations)
          .set({ product: sql`${softwareInstallations.reportedAs}`, reportedAs: null })
          .where(eq(sql`lower(${softwareInstallations.reportedAs})`, lower(rule.title)));
        await this.licenses.recomputeProducts(tx, [license.product]);
      }
      await tx.delete(softwareTitleRules).where(eq(softwareTitleRules.id, id));
      await this.ctx.audit.record(
        {
          action: 'itam.title-rule.deleted',
          entityType: RULE_ENTITY,
          entityId: id,
          entityLabel: rule.title,
          metadata: { title: rule.title, licenseId: rule.licenseId },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'itam.title-rule.deleted',
        { ruleId: id, title: rule.title, licenseId: rule.licenseId },
        { tx },
      );
    });
  }
}

const pick = (r: { added: number; updated: number; removed: number }) => ({
  added: r.added,
  updated: r.updated,
  removed: r.removed,
});
