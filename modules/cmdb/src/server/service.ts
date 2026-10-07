import { departments, groups, users } from '@isbp/db/schema';
import {
  type Db,
  ErrorCodes,
  HttpError,
  httpErrors,
  likePattern,
  type ModuleContext,
} from '@isbp/sdk/server';
import { and, asc, count, desc, eq, ilike, inArray, ne, or, type SQL, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { ciQuerySchema, createCiSchema, createRelationshipSchema, updateCiSchema } from '../contracts';
import {
  BUSINESS_SERVICE_CLASS,
  CI_VIEWS,
  formatCiNumber,
  IMPACT_FROM_SOURCE,
  IMPACT_FROM_TARGET,
  type ImpactDirection,
  MAX_IMPACT_DEPTH,
  parseCiRef,
  type RelationDirection,
  relationshipLabel,
  relationshipProblem,
  type RelationshipType,
} from '../model';
import { auditLabel, type CiRow, refsById, selectRefs, selectSummaries, toRef, toSummary } from './refs';
import { ciClasses, ciRelationships, cis } from './schema';

export const ENTITY = 'cmdb.ci';
/** Impact results are capped so a huge, densely linked estate still answers quickly. */
export const MAX_IMPACT_NODES = 500;

type CreateInput = z.output<typeof createCiSchema>;
type UpdateInput = z.output<typeof updateCiSchema>;
type ListQuery = z.output<typeof ciQuerySchema>;

const STATUS_RANK = sql`case ${cis.status} when 'in_use' then 0 when 'maintenance' then 1 when 'planned' then 2 else 3 end`;
const CRITICALITY_RANK = sql`case ${cis.criticality} when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`;

const SORTABLE: Record<string, SQL> = {
  number: sql`${cis.number}`,
  name: sql`${cis.name}`,
  class: sql`${cis.classKey}`,
  status: STATUS_RANK,
  environment: sql`${cis.environment}`,
  criticality: CRITICALITY_RANK,
  updatedAt: sql`${cis.updatedAt}`,
};

function invalid(path: string, message: string): HttpError {
  return new HttpError(400, ErrorCodes.VALIDATION_FAILED, message, { issues: [{ path, message }] });
}

function pgCode(err: unknown): string | null {
  let e: unknown = err;
  for (let i = 0; i < 3 && e; i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

/** Name or CI number (`CI-00042`, `42`). */
export function ciSearchCondition(term: string): SQL {
  const ref = parseCiRef(term) ?? (/^\d{1,12}$/.test(term.trim()) ? { number: Number(term.trim()) } : null);
  const byName = ilike(cis.name, likePattern(term));
  return ref && 'number' in ref ? or(byName, eq(cis.number, ref.number))! : byName;
}

/** Business rules for configuration items and their relationships — shared by routes, AI tools and events. */
export class CiService {
  constructor(private readonly ctx: ModuleContext) {}

  /* ───────────── reading ───────────── */

  /** A CI by uuid or number (`CI-00042`); 404 otherwise. */
  async resolve(ref: string, db: Db = this.ctx.db): Promise<CiRow> {
    const parsed = parseCiRef(ref);
    if (!parsed) throw httpErrors.notFound('Configuration item not found');
    const [row] = await db
      .select()
      .from(cis)
      .where('id' in parsed ? eq(cis.id, parsed.id) : eq(cis.number, parsed.number));
    if (!row) throw httpErrors.notFound('Configuration item not found');
    return row;
  }

  async list(q: ListQuery) {
    const where = and(
      q.view ? inArray(cis.classKey, [...CI_VIEWS[q.view]]) : undefined,
      q.class ? eq(cis.classKey, q.class) : undefined,
      q.status ? eq(cis.status, q.status) : undefined,
      q.environment ? eq(cis.environment, q.environment) : undefined,
      q.criticality ? eq(cis.criticality, q.criticality) : undefined,
      q.owner ? eq(cis.ownerId, q.owner) : undefined,
      q.supportGroup ? eq(cis.supportGroupId, q.supportGroup) : undefined,
      q.q ? ciSearchCondition(q.q) : undefined,
    );
    const key = q.sort?.replace(/^-/, '') ?? 'name';
    const column = SORTABLE[key] ?? SORTABLE.name!;
    const order = q.sort?.startsWith('-') ? desc(column) : asc(column);
    const [rows, [total]] = await Promise.all([
      selectSummaries(this.ctx.db)
        .where(where)
        .orderBy(order, asc(cis.number))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.ctx.db.select({ n: count() }).from(cis).where(where),
    ]);
    return { items: rows.map(toSummary), total: total!.n, page: q.page, pageSize: q.pageSize };
  }

  async detail(ref: string, canManage: boolean) {
    const ci = await this.resolve(ref);
    const [[row], [counts]] = await Promise.all([
      selectSummaries(this.ctx.db).where(eq(cis.id, ci.id)),
      this.ctx.db
        .select({
          outgoing: sql<number>`count(*) filter (where ${ciRelationships.sourceId} = ${ci.id})`.mapWith(
            Number,
          ),
          incoming: sql<number>`count(*) filter (where ${ciRelationships.targetId} = ${ci.id})`.mapWith(
            Number,
          ),
        })
        .from(ciRelationships)
        .where(or(eq(ciRelationships.sourceId, ci.id), eq(ciRelationships.targetId, ci.id))),
    ]);
    if (!row) throw httpErrors.notFound('Configuration item not found');
    const outgoing = counts?.outgoing ?? 0;
    const incoming = counts?.incoming ?? 0;
    return {
      ...toSummary(row),
      description: row.ci.description,
      attributes: row.ci.attributes,
      relationshipCounts: { total: outgoing + incoming, outgoing, incoming },
      canManage,
      createdAt: row.ci.createdAt,
    };
  }

  /* ───────────── writing ───────────── */

  /** Class, owner, support group and department must exist (owners must not be offboarded). */
  private async assertReferences(input: Partial<CreateInput>) {
    const checks: Promise<void>[] = [];
    if (input.classKey !== undefined)
      checks.push(
        this.ctx.db
          .select({ key: ciClasses.key })
          .from(ciClasses)
          .where(eq(ciClasses.key, input.classKey))
          .then(([r]) => {
            if (!r) throw invalid('classKey', 'Unknown class');
          }),
      );
    if (input.ownerId)
      checks.push(
        this.ctx.db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, input.ownerId), ne(users.status, 'offboarded')))
          .then(([r]) => {
            if (!r) throw invalid('ownerId', 'Unknown or offboarded person');
          }),
      );
    if (input.supportGroupId)
      checks.push(
        this.ctx.db
          .select({ id: groups.id })
          .from(groups)
          .where(eq(groups.id, input.supportGroupId))
          .then(([r]) => {
            if (!r) throw invalid('supportGroupId', 'Unknown group');
          }),
      );
    if (input.departmentId)
      checks.push(
        this.ctx.db
          .select({ id: departments.id })
          .from(departments)
          .where(eq(departments.id, input.departmentId))
          .then(([r]) => {
            if (!r) throw invalid('departmentId', 'Unknown department');
          }),
      );
    await Promise.all(checks);
  }

  async create(input: CreateInput) {
    await this.assertReferences(input);
    const attributes = await this.ctx.fields.validate(ENTITY, input.attributes ?? {});
    const tags = [...new Set(input.tags)];
    return this.ctx.transaction(async (tx) => {
      const [row] = await tx
        .insert(cis)
        .values({
          name: input.name,
          classKey: input.classKey,
          status: input.status,
          environment: input.environment ?? null,
          criticality: input.criticality,
          ownerId: input.ownerId ?? null,
          supportGroupId: input.supportGroupId ?? null,
          departmentId: input.departmentId ?? null,
          description: input.description || null,
          tags,
          attributes,
        })
        .returning();
      const ci = row!;
      await this.ctx.audit.record(
        {
          action: 'cmdb.ci.created',
          entityType: ENTITY,
          entityId: ci.id,
          entityLabel: auditLabel(ci),
          metadata: { classKey: ci.classKey, status: ci.status },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'cmdb.ci.created',
        { ciId: ci.id, number: ci.number, name: ci.name, classKey: ci.classKey },
        { tx },
      );
      return ci;
    });
  }

  async update(ref: string, input: UpdateInput) {
    const before = await this.resolve(ref);
    const changed = Object.fromEntries(
      Object.entries(input).filter(([k, v]) => v !== undefined && k !== 'attributes'),
    ) as Partial<CreateInput>;
    await this.assertReferences(changed);
    const patch: Partial<typeof cis.$inferInsert> = { ...changed };
    if (input.description !== undefined) patch.description = input.description || null;
    if (input.tags) patch.tags = [...new Set(input.tags)];
    if (input.attributes)
      patch.attributes = await this.ctx.fields.validate(ENTITY, input.attributes, before.attributes);
    const changes = this.ctx.audit.diff(
      before as unknown as Record<string, unknown>,
      patch as Record<string, unknown>,
    );
    if (!Object.keys(changes).length) return before;
    const retiring = 'status' in changes && patch.status === 'retired';
    return this.ctx.transaction(async (tx) => {
      const [row] = await tx.update(cis).set(patch).where(eq(cis.id, before.id)).returning();
      const ci = row!;
      await this.ctx.audit.record(
        {
          action: 'cmdb.ci.updated',
          entityType: ENTITY,
          entityId: ci.id,
          entityLabel: auditLabel(ci),
          changes,
        },
        { tx },
      );
      const ref = { ciId: ci.id, number: ci.number, name: ci.name };
      await this.ctx.events.publish('cmdb.ci.updated', { ...ref, changes: Object.keys(changes) }, { tx });
      if (retiring) await this.ctx.events.publish('cmdb.ci.retired', ref, { tx });
      return ci;
    });
  }

  async retire(ref: string) {
    const before = await this.resolve(ref);
    if (before.status === 'retired')
      throw new HttpError(409, ErrorCodes.INVALID_TRANSITION, 'This configuration item is already retired', {
        from: before.status,
        allowed: [],
      });
    return this.ctx.transaction(async (tx) => {
      const [row] = await tx
        .update(cis)
        .set({ status: 'retired' })
        .where(and(eq(cis.id, before.id), ne(cis.status, 'retired')))
        .returning();
      if (!row) return before;
      await this.ctx.audit.record(
        {
          action: 'cmdb.ci.retired',
          entityType: ENTITY,
          entityId: row.id,
          entityLabel: auditLabel(row),
          changes: { status: [before.status, 'retired'] },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'cmdb.ci.retired',
        { ciId: row.id, number: row.number, name: row.name },
        { tx },
      );
      return row;
    });
  }

  /**
   * Deletes the CI with its relationships. Refused with `IN_USE` while another module's records still
   * reference it (e.g. tickets citing it as an affected CI, when their foreign key restricts deletes).
   */
  async remove(ref: string) {
    const ci = await this.resolve(ref);
    try {
      await this.ctx.transaction(async (tx) => {
        const links = await tx
          .delete(ciRelationships)
          .where(or(eq(ciRelationships.sourceId, ci.id), eq(ciRelationships.targetId, ci.id)))
          .returning({ id: ciRelationships.id });
        await tx.delete(cis).where(eq(cis.id, ci.id));
        await this.ctx.records.forget({ type: 'cmdb.ci', id: ci.id }, { tx });
        await this.ctx.audit.record(
          {
            action: 'cmdb.ci.deleted',
            entityType: ENTITY,
            entityId: ci.id,
            entityLabel: auditLabel(ci),
            metadata: { classKey: ci.classKey, relationships: links.length },
          },
          { tx },
        );
        await this.ctx.events.publish(
          'cmdb.ci.deleted',
          { ciId: ci.id, number: ci.number, name: ci.name },
          { tx },
        );
      });
    } catch (err) {
      if (pgCode(err) === '23503')
        throw new HttpError(
          409,
          ErrorCodes.IN_USE,
          'Other records still reference this configuration item; retire it instead',
          { ciId: ci.id },
        );
      throw err;
    }
  }

  /** Clears the owner of a person's CIs when they leave (idempotent). */
  async releaseOwner(userId: string) {
    return this.ctx.transaction(async (tx) => {
      const released = await tx
        .update(cis)
        .set({ ownerId: null })
        .where(eq(cis.ownerId, userId))
        .returning({ id: cis.id, number: cis.number, name: cis.name });
      for (const ci of released) {
        await this.ctx.audit.record(
          {
            action: 'cmdb.ci.owner_released',
            entityType: ENTITY,
            entityId: ci.id,
            entityLabel: auditLabel(ci),
            changes: { ownerId: [userId, null] },
            metadata: { reason: 'offboarded' },
          },
          { tx },
        );
        await this.ctx.events.publish(
          'cmdb.ci.updated',
          { ciId: ci.id, number: ci.number, name: ci.name, changes: ['ownerId'] },
          { tx },
        );
      }
      return released.length;
    });
  }

  /* ───────────── relationships ───────────── */

  /** Both directions, labelled from this CI's point of view. */
  async relations(ref: string) {
    const ci = await this.resolve(ref);
    const rows = await this.ctx.db
      .select({ rel: ciRelationships, createdByName: users.displayName })
      .from(ciRelationships)
      .leftJoin(users, eq(users.id, ciRelationships.createdBy))
      .where(or(eq(ciRelationships.sourceId, ci.id), eq(ciRelationships.targetId, ci.id)))
      .orderBy(asc(ciRelationships.type), asc(ciRelationships.createdAt));
    const others = await refsById(
      this.ctx.db,
      rows.map((r) => (r.rel.sourceId === ci.id ? r.rel.targetId : r.rel.sourceId)),
    );
    return rows.flatMap(({ rel, createdByName }) => {
      const direction: RelationDirection = rel.sourceId === ci.id ? 'outgoing' : 'incoming';
      const other = others.get(direction === 'outgoing' ? rel.targetId : rel.sourceId);
      if (!other) return [];
      return [
        {
          id: rel.id,
          type: rel.type,
          direction,
          label: relationshipLabel(rel.type, direction),
          note: rel.note,
          ci: other,
          createdBy: rel.createdBy ? { id: rel.createdBy, displayName: createdByName ?? '—' } : null,
          createdAt: rel.createdAt,
        },
      ];
    });
  }

  /** CIs the given CI (transitively) contains; cycle-safe (UNION de-duplicates). */
  private async containedIn(ciId: string): Promise<Set<string>> {
    const result = await this.ctx.db.execute<{ id: string }>(sql`
      with recursive sub(id) as (
        select r.target_id from cmdb.ci_relationships r
        where r.source_id = ${ciId} and r.type = 'contains'
        union
        select r.target_id from sub
        join cmdb.ci_relationships r on r.source_id = sub.id and r.type = 'contains'
      )
      select id from sub`);
    return new Set(result.rows.map((r) => r.id));
  }

  async createRelationship(input: z.output<typeof createRelationshipSchema>, actorId: string | null) {
    const [source, target] = await Promise.all([this.resolve(input.sourceId), this.resolve(input.targetId)]);
    const [[existing], containedInTarget] = await Promise.all([
      this.ctx.db
        .select({ id: ciRelationships.id })
        .from(ciRelationships)
        .where(
          and(
            eq(ciRelationships.sourceId, source.id),
            eq(ciRelationships.targetId, target.id),
            eq(ciRelationships.type, input.type),
          ),
        ),
      input.type === 'contains' && source.id !== target.id
        ? this.containedIn(target.id)
        : Promise.resolve(new Set<string>()),
    ]);
    const problem = relationshipProblem(
      { sourceId: source.id, targetId: target.id, type: input.type },
      { duplicate: Boolean(existing), containedInTarget },
    );
    if (problem) throw relationshipInvalid(problem);
    try {
      return await this.ctx.transaction(async (tx) => {
        const [row] = await tx
          .insert(ciRelationships)
          .values({
            sourceId: source.id,
            targetId: target.id,
            type: input.type,
            note: input.note || null,
            createdBy: actorId,
          })
          .returning();
        const rel = row!;
        await this.ctx.audit.record(
          {
            action: 'cmdb.relationship.created',
            entityType: ENTITY,
            entityId: source.id,
            entityLabel: auditLabel(source),
            metadata: {
              relationshipId: rel.id,
              type: rel.type,
              label: `${source.name} ${relationshipLabel(rel.type, 'outgoing')} ${target.name}`,
              targetId: target.id,
              target: auditLabel(target),
            },
          },
          { tx },
        );
        await this.ctx.events.publish(
          'cmdb.relationship.created',
          { relationshipId: rel.id, sourceId: rel.sourceId, targetId: rel.targetId, type: rel.type },
          { tx },
        );
        return rel;
      });
    } catch (err) {
      if (pgCode(err) === '23505') throw relationshipInvalid('duplicate');
      throw err;
    }
  }

  async deleteRelationship(id: string) {
    const [rel] = await this.ctx.db.select().from(ciRelationships).where(eq(ciRelationships.id, id));
    if (!rel) throw httpErrors.notFound('Relationship not found');
    const ends = await refsById(this.ctx.db, [rel.sourceId, rel.targetId]);
    const source = ends.get(rel.sourceId);
    const target = ends.get(rel.targetId);
    await this.ctx.transaction(async (tx) => {
      const deleted = await tx
        .delete(ciRelationships)
        .where(eq(ciRelationships.id, id))
        .returning({ id: ciRelationships.id });
      if (!deleted.length) return;
      await this.ctx.audit.record(
        {
          action: 'cmdb.relationship.deleted',
          entityType: ENTITY,
          entityId: rel.sourceId,
          entityLabel: source ? auditLabel(source) : null,
          metadata: {
            relationshipId: rel.id,
            type: rel.type,
            label: `${source?.name ?? rel.sourceId} ${relationshipLabel(rel.type, 'outgoing')} ${target?.name ?? rel.targetId}`,
            targetId: rel.targetId,
            target: target ? auditLabel(target) : null,
          },
        },
        { tx },
      );
      await this.ctx.events.publish(
        'cmdb.relationship.deleted',
        { relationshipId: rel.id, sourceId: rel.sourceId, targetId: rel.targetId, type: rel.type },
        { tx },
      );
    });
  }

  /* ───────────── impact analysis ───────────── */

  /**
   * One direction of impact analysis as a recursive CTE. The walk keeps only (CI, depth) pairs — UNION
   * drops repeats, so cycles and diamonds can't multiply rows — and stops at `depth`. Each CI is then
   * reported at its shortest depth with one edge from a CI one level closer (its parent).
   */
  private async walk(rootId: string, direction: ImpactDirection, depth: number) {
    const up = direction === 'impacted';
    // Edge `source —type→ target`. For "from target" types (depends_on, runs_on) a failure flows from
    // column `a` to column `b`; for "from source" types (contains) from `b` to `a`.
    const a = sql.raw(up ? 'target_id' : 'source_id');
    const b = sql.raw(up ? 'source_id' : 'target_id');
    const fromTarget = sql.join(
      IMPACT_FROM_TARGET.map((t) => sql`${t}`),
      sql`, `,
    );
    const fromSource = sql.join(
      IMPACT_FROM_SOURCE.map((t) => sql`${t}`),
      sql`, `,
    );
    const next = sql`case when r.type in (${fromTarget}) then r.${b} else r.${a} end`;
    const leadsFrom = (node: SQL) =>
      sql`((r.type in (${fromTarget}) and r.${a} = ${node}) or (r.type in (${fromSource}) and r.${b} = ${node}))`;
    const root = sql`${rootId}::uuid`;
    const limit = Math.max(1, Math.min(MAX_IMPACT_DEPTH, depth));

    const result = await this.ctx.db.execute<{
      ci_id: string;
      depth: number;
      edge_type: RelationshipType;
      parent_id: string;
    }>(sql`
      with recursive walk(ci_id, depth) as (
        select ${next}, 1
        from cmdb.ci_relationships r
        where ${leadsFrom(root)}
        union
        select ${next}, w.depth + 1
        from walk w
        join cmdb.ci_relationships r on ${leadsFrom(sql`w.ci_id`)}
        where w.depth < ${limit} and ${next} <> ${root}
      ),
      best as (
        select ci_id, min(depth) as depth from walk where ci_id <> ${root} group by ci_id
      ),
      levels as (
        select ci_id, depth from best
        union all
        select ${root}, 0
      ),
      nodes as (
        select distinct on (b.ci_id) b.ci_id, b.depth, r.type as edge_type, p.ci_id as parent_id
        from best b
        join levels p on p.depth = b.depth - 1
        join cmdb.ci_relationships r on ${leadsFrom(sql`p.ci_id`)} and ${next} = b.ci_id
        order by b.ci_id, r.type, p.ci_id
      )
      select ci_id, depth, edge_type, parent_id from nodes
      order by depth, ci_id
      limit ${MAX_IMPACT_NODES + 1}`);
    return result.rows.map((r) => ({
      id: r.ci_id,
      depth: Number(r.depth),
      edgeType: r.edge_type,
      parentId: r.parent_id,
    }));
  }

  async impact(ref: string, depth: number) {
    const ci = await this.resolve(ref);
    const [impacted, dependsOn] = await Promise.all([
      this.walk(ci.id, 'impacted', depth),
      this.walk(ci.id, 'dependsOn', depth),
    ]);
    const truncated = impacted.length > MAX_IMPACT_NODES || dependsOn.length > MAX_IMPACT_NODES;
    const up = impacted.slice(0, MAX_IMPACT_NODES);
    const down = dependsOn.slice(0, MAX_IMPACT_NODES);
    const refs = await refsById(this.ctx.db, [ci.id, ...up.map((n) => n.id), ...down.map((n) => n.id)]);
    const nodes = (list: typeof up) =>
      list.flatMap((n) => {
        const other = refs.get(n.id);
        return other
          ? [
              {
                ci: other,
                depth: n.depth,
                edgeType: n.edgeType,
                parentId: n.parentId,
                isService: other.class.key === BUSINESS_SERVICE_CLASS,
              },
            ]
          : [];
      });
    const impactedNodes = nodes(up);
    return {
      root: refs.get(ci.id)!,
      depth,
      impacted: impactedNodes,
      dependsOn: nodes(down),
      impactedServices: impactedNodes.filter((n) => n.isService).length,
      truncated,
    };
  }

  /* ───────────── services & lookups ───────────── */

  /** Operational business services — the minimal list every user may pick from. */
  async services(q: string | undefined, limit: number) {
    const rows = await this.ctx.db
      .select({ id: cis.id, number: cis.number, name: cis.name, description: cis.description })
      .from(cis)
      .where(
        and(
          eq(cis.classKey, BUSINESS_SERVICE_CLASS),
          inArray(cis.status, ['in_use', 'maintenance']),
          q ? ilike(cis.name, likePattern(q)) : undefined,
        ),
      )
      .orderBy(asc(cis.name))
      .limit(limit);
    return rows.map((r) => ({ ...r, reference: formatCiNumber(r.number) }));
  }

  async ref(id: string) {
    const [row] = await selectRefs(this.ctx.db).where(eq(cis.id, id));
    if (!row) throw httpErrors.notFound('Configuration item not found');
    return toRef(row);
  }
}

export function relationshipInvalid(reason: 'self' | 'duplicate' | 'cycle'): HttpError {
  const message = {
    self: 'A configuration item cannot be related to itself',
    duplicate: 'These configuration items already have this relationship',
    cycle: 'This would make a configuration item (indirectly) contain itself',
  }[reason];
  return new HttpError(409, ErrorCodes.RELATIONSHIP_INVALID, message, { reason });
}
