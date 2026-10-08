/**
 * The approved-software list (allow list / block list, the "software whitelist"): which titles may be installed —
 * company-wide or for some departments, optionally only until a date — and which must not be. Discovered installs on
 * devices in use are checked against it (`approvalSql`, the twin of `installApproval` in the model): a title on a
 * blocked entry is `blocked`; once there is at least one allowed entry, a title no allowed entry covers for the
 * device's department (or its assignee's) is `unapproved`. Title rules tie in: an install renamed to a licence's
 * product still matches entries by the title the tool reported, and an entry linked to a licence matches installs
 * counted as that licence's product.
 */
import { departments, users } from '@isbp/db/schema';
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
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  lt,
  lte,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { z } from 'zod';
import en from '../../messages/en.json';
import ja from '../../messages/ja-JP.json';
import zh from '../../messages/zh-TW.json';
import type {
  approvedSoftwareExportSchema,
  approvedSoftwareQuerySchema,
  complianceQuerySchema,
  createApprovedSoftwareSchema,
  updateApprovedSoftwareSchema,
} from '../contracts';
import {
  addDays,
  APPROVAL_EXPIRING_DAYS,
  type ApprovalScope,
  type ApprovalStatus,
  approvalEntryState,
  formatAssetTag,
  formatContractRef,
  formatLicenseRef,
  type InstallApproval,
  type LicenseModel,
} from '../model';
import { all, HARDWARE_MANAGE, SOFTWARE_MANAGE, SOFTWARE_READ } from './access';
import { INACTIVE_DEVICE } from './licenses';
import {
  type ApprovedSoftwareRow,
  approvedSoftware,
  approvedSoftwareDepartments,
  type AssetEventRequest,
  assets,
  contracts,
  licenses,
  softwareInstallations,
} from './schema';
import { actingUserId, companyToday, invalidField, peopleByIds, personRef, roleHolders } from './support';

type QueryData = z.output<typeof approvedSoftwareQuerySchema>;
type ExportQuery = z.output<typeof approvedSoftwareExportSchema>;
type CreateData = z.output<typeof createApprovedSoftwareSchema>;
type UpdateData = z.output<typeof updateApprovedSoftwareSchema>;
type ComplianceQuery = z.output<typeof complianceQuerySchema>;

export const APPROVED_SOFTWARE_ENTITY = 'itam.approved-software';

const CATALOGS = { en, 'zh-TW': zh as typeof en, 'ja-JP': ja as typeof en };
export type CatalogLocale = keyof typeof CATALOGS;

const lower = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/* ───────────────────────────── matching (SQL) ───────────────────────────── */

/** The device's departments: its own and its assignee's (an entry for either covers it). */
const deviceDepartments = sql`(${assets.departmentId}, (select u.department_id from ${users} u where u.id = ${assets.assignedTo}))`;

/** Entries `s` that cover the install `softwareInstallations` on the device `assets`, today. */
function coveringEntry(status: ApprovalStatus, today: string): SQL {
  return sql`exists (
    select 1 from ${approvedSoftware} s
     where s.status = ${status}
       and (s.valid_until is null or s.valid_until >= ${today}::date)
       and (lower(s.title) = lower(${softwareInstallations.product})
            or lower(s.title) = lower(${softwareInstallations.reportedAs})
            or (s.license_id is not null and exists (
                  select 1 from ${licenses} l
                   where l.id = s.license_id and lower(l.product) = lower(${softwareInstallations.product}))))
       and (s.version is null
            or lower(${softwareInstallations.version}) = lower(s.version)
            or starts_with(lower(${softwareInstallations.version}), lower(s.version) || '.'))
       and (s.scope = 'company'
            or exists (select 1 from ${approvedSoftwareDepartments} d
                        where d.entry_id = s.id and d.department_id in ${deviceDepartments})))`;
}

/**
 * Where an install stands against the list (query joining `software_installations` with `assets`): the SQL twin of
 * `installApproval`. `allowListInUse` (any allowed entry exists) is read once per request.
 */
export function approvalSql(today: string, allowListInUse: boolean): SQL<InstallApproval> {
  return sql<InstallApproval>`case
    when ${coveringEntry('blocked', today)} then 'blocked'
    when ${allowListInUse ? sql`not ${coveringEntry('allowed', today)}` : sql`false`} then 'unapproved'
    else 'allowed' end`;
}

/** Flagged installs (unapproved or blocked) on devices in use. */
function flaggedWhere(today: string, allowListInUse: boolean): SQL {
  return and(
    notInArray(assets.status, INACTIVE_DEVICE),
    allowListInUse
      ? or(coveringEntry('blocked', today), sql`not ${coveringEntry('allowed', today)}`)
      : coveringEntry('blocked', today),
  )!;
}

/* ───────────────────────────── CSV ───────────────────────────── */

/** A CSV cell: quoted when needed; text that a spreadsheet would run as a formula starts with an apostrophe. */
export function csvCell(value: string | null | undefined): string {
  let v = value ?? '';
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export const csvLine = (cells: readonly (string | null | undefined)[]) => cells.map(csvCell).join(',');

/* ───────────────────────────── service ───────────────────────────── */

export class ApprovedSoftwareService {
  constructor(private readonly ctx: ModuleContext) {}

  private get db() {
    return this.ctx.db;
  }

  /** At least one allowed entry: installs it doesn't cover are "Not on the approved list". */
  async allowListInUse(db: Db = this.db): Promise<boolean> {
    const [row] = await db
      .select({ id: approvedSoftware.id })
      .from(approvedSoftware)
      .where(eq(approvedSoftware.status, 'allowed'))
      .limit(1);
    return Boolean(row);
  }

  /* ───────────── reading ───────────── */

  private where(q: Omit<QueryData, 'page' | 'pageSize' | 'sort'>, today: string): SQL | undefined {
    const expiring = addDays(today, APPROVAL_EXPIRING_DAYS);
    return all(
      q.status ? eq(approvedSoftware.status, q.status) : undefined,
      q.licenseModel ? eq(approvedSoftware.licenseModel, q.licenseModel) : undefined,
      q.department
        ? or(
            eq(approvedSoftware.scope, 'company'),
            sql`exists (select 1 from ${approvedSoftwareDepartments} d where d.entry_id = ${approvedSoftware.id} and d.department_id = ${q.department})`,
          )
        : undefined,
      q.state === 'expired' ? lt(approvedSoftware.validUntil, today) : undefined,
      q.state === 'expiring'
        ? and(gte(approvedSoftware.validUntil, today), lte(approvedSoftware.validUntil, expiring))
        : undefined,
      q.state === 'active'
        ? or(
            sql`${approvedSoftware.validUntil} is null`,
            sql`${approvedSoftware.validUntil} > ${expiring}::date`,
          )
        : undefined,
      q.q
        ? or(
            ilike(approvedSoftware.title, likePattern(q.q)),
            ilike(approvedSoftware.publisher, likePattern(q.q)),
            ilike(approvedSoftware.requestReference, likePattern(q.q)),
          )
        : undefined,
    );
  }

  private order(sort: string | undefined): SQL[] {
    const key = sort?.replace(/^-/, '');
    const dir = sort?.startsWith('-') ? sql`desc` : sql`asc`;
    switch (key) {
      case 'status':
        return [sql`${approvedSoftware.status} ${dir}`, asc(approvedSoftware.title)];
      case 'validUntil':
        return [sql`${approvedSoftware.validUntil} ${dir} nulls last`, asc(approvedSoftware.title)];
      case 'updatedAt':
        return [sql`${approvedSoftware.updatedAt} ${dir}`];
      default:
        return [
          sql`lower(${approvedSoftware.title}) ${dir}`,
          sql`${approvedSoftware.version} asc nulls first`,
          asc(approvedSoftware.id),
        ];
    }
  }

  async list(q: QueryData, auth: AuthContext) {
    auth.require(SOFTWARE_READ);
    const today = companyToday();
    const where = this.where(q, today);
    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(approvedSoftware)
        .where(where)
        .orderBy(...this.order(q.sort))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db.select({ n: count() }).from(approvedSoftware).where(where),
    ]);
    return { items: await this.dtos(rows, today), total: total!.n, page: q.page, pageSize: q.pageSize };
  }

  async get(id: string, auth: AuthContext) {
    auth.require(SOFTWARE_READ);
    const [row] = await this.db.select().from(approvedSoftware).where(eq(approvedSoftware.id, id));
    if (!row) throw httpErrors.notFound('Approved software entry not found');
    return (await this.dtos([row], companyToday()))[0]!;
  }

  private async dtos(rows: ApprovedSoftwareRow[], today: string) {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const licenseIds = [...new Set(rows.map((r) => r.licenseId).filter((x): x is string => Boolean(x)))];
    const contractIds = [...new Set(rows.map((r) => r.contractId).filter((x): x is string => Boolean(x)))];
    const [depts, lics, ctrs, people] = await Promise.all([
      this.db
        .select({
          entryId: approvedSoftwareDepartments.entryId,
          id: departments.id,
          name: departments.name,
          code: departments.code,
        })
        .from(approvedSoftwareDepartments)
        .innerJoin(departments, eq(departments.id, approvedSoftwareDepartments.departmentId))
        .where(inArray(approvedSoftwareDepartments.entryId, ids))
        .orderBy(asc(departments.path)),
      licenseIds.length
        ? this.db
            .select({ id: licenses.id, number: licenses.number, product: licenses.product })
            .from(licenses)
            .where(inArray(licenses.id, licenseIds))
        : Promise.resolve([]),
      contractIds.length
        ? this.db
            .select({ id: contracts.id, number: contracts.number, title: contracts.title })
            .from(contracts)
            .where(inArray(contracts.id, contractIds))
        : Promise.resolve([]),
      peopleByIds(
        this.db,
        rows.map((r) => r.createdBy),
      ),
    ]);
    const licenseById = new Map(lics.map((l) => [l.id, l]));
    const contractById = new Map(ctrs.map((c) => [c.id, c]));
    return rows.map((r) => {
      const l = r.licenseId ? licenseById.get(r.licenseId) : undefined;
      const c = r.contractId ? contractById.get(r.contractId) : undefined;
      const by = r.createdBy ? people.get(r.createdBy) : undefined;
      return {
        id: r.id,
        title: r.title,
        publisher: r.publisher,
        version: r.version,
        licenseModel: r.licenseModel,
        license: l ? { id: l.id, reference: formatLicenseRef(l.number), product: l.product } : null,
        contract: c ? { id: c.id, reference: formatContractRef(c.number), title: c.title } : null,
        scope: r.scope,
        departments: depts
          .filter((d) => d.entryId === r.id)
          .map((d) => ({ id: d.id, name: d.name, code: d.code })),
        status: r.status,
        validUntil: r.validUntil,
        state: approvalEntryState(r.validUntil, today),
        notes: r.notes,
        requestReference: r.requestReference,
        createdBy: by ? { id: by.id, displayName: by.displayName } : null,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      };
    });
  }

  /* ───────────── changing ───────────── */

  private async assertRefs(input: {
    licenseId?: string | null;
    contractId?: string | null;
    departmentIds?: readonly string[];
  }) {
    if (input.licenseId) {
      const [l] = await this.db
        .select({ id: licenses.id })
        .from(licenses)
        .where(eq(licenses.id, input.licenseId));
      if (!l) throw invalidField('licenseId', 'Unknown licence');
    }
    if (input.contractId) {
      const [c] = await this.db
        .select({ id: contracts.id })
        .from(contracts)
        .where(eq(contracts.id, input.contractId));
      if (!c) throw invalidField('contractId', 'Unknown contract');
    }
    const wanted = [...new Set(input.departmentIds ?? [])];
    if (wanted.length) {
      const found = await this.db
        .select({ id: departments.id })
        .from(departments)
        .where(inArray(departments.id, wanted));
      if (found.length !== wanted.length) throw invalidField('departmentIds', 'Unknown department');
    }
  }

  /** A company-wide entry with the same title, version and status already exists. */
  private async assertNoDuplicate(
    v: { title: string; version: string | null; status: ApprovalStatus; scope: ApprovalScope },
    except?: string,
  ) {
    if (v.scope !== 'company') return;
    const [dup] = await this.db
      .select({ id: approvedSoftware.id })
      .from(approvedSoftware)
      .where(
        all(
          eq(sql`lower(${approvedSoftware.title})`, lower(v.title)),
          eq(sql`lower(coalesce(${approvedSoftware.version}, ''))`, lower(v.version)),
          eq(approvedSoftware.status, v.status),
          eq(approvedSoftware.scope, 'company'),
          except ? sql`${approvedSoftware.id} <> ${except}` : undefined,
        ),
      )
      .limit(1);
    if (dup)
      throw new HttpError(409, ErrorCodes.CONFLICT, 'This title and version are already on the list', {
        field: 'title',
        id: dup.id,
      });
  }

  private async setDepartments(tx: Db, entryId: string, departmentIds: readonly string[]) {
    await tx.delete(approvedSoftwareDepartments).where(eq(approvedSoftwareDepartments.entryId, entryId));
    const unique = [...new Set(departmentIds)];
    if (unique.length)
      await tx
        .insert(approvedSoftwareDepartments)
        .values(unique.map((departmentId) => ({ entryId, departmentId })));
  }

  private payload(r: ApprovedSoftwareRow) {
    return { entryId: r.id, title: r.title, status: r.status };
  }

  async create(input: CreateData, auth: AuthContext, opts: { source?: AssetEventRequest } = {}) {
    auth.require(SOFTWARE_MANAGE);
    const scope = input.scope ?? 'company';
    const departmentIds = scope === 'departments' ? (input.departmentIds ?? []) : [];
    if (scope === 'departments' && !departmentIds.length)
      throw invalidField('departmentIds', 'Choose at least one department');
    const status = input.status ?? 'allowed';
    const version = input.version ?? null;
    await this.assertRefs({ ...input, departmentIds });
    await this.assertNoDuplicate({ title: input.title, version, status, scope });
    const id = await this.ctx.transaction(async (tx) => {
      const [row] = await tx
        .insert(approvedSoftware)
        .values({
          title: input.title,
          publisher: input.publisher,
          version,
          licenseModel: input.licenseModel,
          licenseId: input.licenseId ?? null,
          contractId: input.contractId ?? null,
          scope,
          status,
          validUntil: input.validUntil ?? null,
          notes: input.notes,
          requestReference: input.requestReference ?? opts.source?.reference ?? null,
          source: opts.source ?? null,
          createdBy: actingUserId(auth),
        })
        .returning();
      const r = row!;
      await this.setDepartments(tx, r.id, departmentIds);
      await this.ctx.audit.record(
        {
          action: 'itam.approved-software.created',
          entityType: APPROVED_SOFTWARE_ENTITY,
          entityId: r.id,
          entityLabel: entryLabel(r),
          metadata: {
            status,
            version,
            licenseModel: r.licenseModel,
            scope,
            departmentIds,
            validUntil: r.validUntil,
            request: r.requestReference,
          },
        },
        { tx },
      );
      await this.ctx.events.publish('itam.approved-software.created', this.payload(r), { tx });
      return r.id;
    });
    return this.get(id, auth);
  }

  async update(id: string, input: UpdateData, auth: AuthContext) {
    auth.require(SOFTWARE_MANAGE);
    const [before] = await this.db.select().from(approvedSoftware).where(eq(approvedSoftware.id, id));
    if (!before) throw httpErrors.notFound('Approved software entry not found');
    const beforeDepts = (
      await this.db
        .select({ id: approvedSoftwareDepartments.departmentId })
        .from(approvedSoftwareDepartments)
        .where(eq(approvedSoftwareDepartments.entryId, id))
    ).map((d) => d.id);
    const scope = input.scope ?? before.scope;
    const departmentIds =
      scope === 'departments'
        ? (input.departmentIds ?? (before.scope === 'departments' ? beforeDepts : []))
        : [];
    if (scope === 'departments' && !departmentIds.length)
      throw invalidField('departmentIds', 'Choose at least one department');
    await this.assertRefs({ ...input, departmentIds });
    const patch: Partial<typeof approvedSoftware.$inferInsert> = {};
    for (const f of [
      'title',
      'publisher',
      'version',
      'licenseModel',
      'licenseId',
      'contractId',
      'status',
      'validUntil',
      'notes',
      'requestReference',
    ] as const) {
      const v = input[f];
      if (v !== undefined && v !== before[f]) (patch as Record<string, unknown>)[f] = v;
    }
    if (scope !== before.scope) patch.scope = scope;
    if (patch.validUntil !== undefined) patch.expiryNotifiedFor = null;
    const deptsChanged =
      [...departmentIds].sort().join() !== [...beforeDepts].sort().join() || scope !== before.scope;
    if (!Object.keys(patch).length && !deptsChanged) return this.get(id, auth);
    await this.assertNoDuplicate(
      {
        title: patch.title ?? before.title,
        version: patch.version !== undefined ? patch.version : before.version,
        status: patch.status ?? before.status,
        scope,
      },
      id,
    );
    const changes = this.ctx.audit.diff(
      before as unknown as Record<string, unknown>,
      patch as Record<string, unknown>,
    );
    if (deptsChanged) changes.departmentIds = [beforeDepts, departmentIds];
    await this.ctx.transaction(async (tx) => {
      const [row] = Object.keys(patch).length
        ? await tx.update(approvedSoftware).set(patch).where(eq(approvedSoftware.id, id)).returning()
        : await tx
            .update(approvedSoftware)
            .set({ updatedAt: new Date() })
            .where(eq(approvedSoftware.id, id))
            .returning();
      if (deptsChanged) await this.setDepartments(tx, id, departmentIds);
      await this.ctx.audit.record(
        {
          action: 'itam.approved-software.updated',
          entityType: APPROVED_SOFTWARE_ENTITY,
          entityId: id,
          entityLabel: entryLabel(row!),
          changes,
        },
        { tx },
      );
      await this.ctx.events.publish('itam.approved-software.updated', this.payload(row!), { tx });
    });
    return this.get(id, auth);
  }

  async remove(id: string, auth: AuthContext) {
    auth.require(SOFTWARE_MANAGE);
    await this.ctx.transaction(async (tx) => {
      const [row] = await tx.delete(approvedSoftware).where(eq(approvedSoftware.id, id)).returning();
      if (!row) throw httpErrors.notFound('Approved software entry not found');
      await this.ctx.audit.record(
        {
          action: 'itam.approved-software.deleted',
          entityType: APPROVED_SOFTWARE_ENTITY,
          entityId: id,
          entityLabel: entryLabel(row),
          metadata: { status: row.status, version: row.version, scope: row.scope },
        },
        { tx },
      );
      await this.ctx.events.publish('itam.approved-software.deleted', this.payload(row), { tx });
    });
  }

  /**
   * `itam.approve-software` (a software install request was approved): adds the title to the allow list for the
   * requester's department or the whole company, or extends an entry that already covers it (a later end date, or
   * permanent). Repeating it changes nothing, so a retried run is harmless.
   */
  async approveFromRequest(
    input: {
      title: string;
      publisher: string | null;
      version: string | null;
      licenseModel: LicenseModel;
      scope: ApprovalScope;
      departmentId: string | null;
      validUntil: string | null;
      notes: string | null;
    },
    auth: AuthContext,
    request: AssetEventRequest,
  ): Promise<{ entry: ApprovedSoftwareRow; created: boolean; changed: boolean }> {
    auth.require(SOFTWARE_MANAGE);
    if (input.scope === 'departments' && !input.departmentId)
      throw new HttpError(400, ErrorCodes.VALIDATION_FAILED, 'The requester has no department', {
        issues: [{ path: 'scope', message: 'The requester has no department', code: 'noDepartment' }],
      });
    const departmentIds = input.scope === 'departments' ? [input.departmentId!] : [];
    return this.ctx.transaction(async (tx) => {
      // Serialises runs for the same title (two requests approved at once extend one entry).
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`itam.approved-software:${lower(input.title)}`}))`,
      );
      const candidates = await tx
        .select()
        .from(approvedSoftware)
        .where(
          and(
            eq(sql`lower(${approvedSoftware.title})`, lower(input.title)),
            eq(sql`lower(coalesce(${approvedSoftware.version}, ''))`, lower(input.version)),
            eq(approvedSoftware.status, 'allowed'),
          ),
        )
        .orderBy(asc(approvedSoftware.createdAt));
      const deptsOf = async (entryId: string) =>
        (
          await tx
            .select({ id: approvedSoftwareDepartments.departmentId })
            .from(approvedSoftwareDepartments)
            .where(eq(approvedSoftwareDepartments.entryId, entryId))
        ).map((d) => d.id);
      const later = (a: string | null, b: string | null) => (a === null || b === null ? null : a > b ? a : b);
      let target: ApprovedSoftwareRow | undefined;
      let addDepartment = false;
      for (const c of candidates) {
        // A company-wide entry that ends earlier is not extended for one department's request: that department
        // gets an entry of its own (below).
        if (
          c.scope === 'company' &&
          input.scope === 'departments' &&
          later(c.validUntil, input.validUntil) !== c.validUntil
        )
          continue;
        const covers =
          c.scope === 'company' ||
          (input.scope === 'departments' && (await deptsOf(c.id)).includes(input.departmentId!));
        if (covers) {
          target = c;
          break;
        }
      }
      if (!target && input.scope === 'departments')
        target = candidates.find((c) => c.scope === 'departments' && c.validUntil === input.validUntil);
      if (target && input.scope === 'departments' && target.scope === 'departments')
        addDepartment = !(await deptsOf(target.id)).includes(input.departmentId!);
      if (!target && input.scope === 'company') {
        // A departmental entry of the same title becomes company-wide.
        target = candidates.find((c) => c.scope === 'departments');
      }

      if (target) {
        const validUntil = later(target.validUntil, input.validUntil);
        const toCompany = input.scope === 'company' && target.scope !== 'company';
        const patch: Partial<typeof approvedSoftware.$inferInsert> = {};
        if (validUntil !== target.validUntil) {
          patch.validUntil = validUntil;
          patch.expiryNotifiedFor = null;
        }
        if (toCompany) patch.scope = 'company';
        if (!Object.keys(patch).length && !addDepartment)
          return { entry: target, created: false, changed: false };
        patch.requestReference = request.reference;
        patch.source = request;
        const [row] = await tx
          .update(approvedSoftware)
          .set(patch)
          .where(eq(approvedSoftware.id, target.id))
          .returning();
        if (toCompany)
          await tx
            .delete(approvedSoftwareDepartments)
            .where(eq(approvedSoftwareDepartments.entryId, target.id));
        if (addDepartment)
          await tx
            .insert(approvedSoftwareDepartments)
            .values({ entryId: target.id, departmentId: input.departmentId! })
            .onConflictDoNothing();
        await this.ctx.audit.record(
          {
            action: 'itam.approved-software.updated',
            entityType: APPROVED_SOFTWARE_ENTITY,
            entityId: target.id,
            entityLabel: entryLabel(row!),
            changes: {
              ...(patch.validUntil !== undefined ? { validUntil: [target.validUntil, validUntil] } : {}),
              ...(toCompany ? { scope: [target.scope, 'company'] } : {}),
              ...(addDepartment ? { departmentIds: [null, input.departmentId] } : {}),
            },
            metadata: { request: request.reference },
          },
          { tx },
        );
        await this.ctx.events.publish('itam.approved-software.updated', this.payload(row!), { tx });
        return { entry: row!, created: false, changed: true };
      }

      const [row] = await tx
        .insert(approvedSoftware)
        .values({
          title: input.title,
          publisher: input.publisher,
          version: input.version,
          licenseModel: input.licenseModel,
          scope: input.scope,
          status: 'allowed',
          validUntil: input.validUntil,
          notes: input.notes,
          requestReference: request.reference,
          source: request,
          createdBy: actingUserId(auth),
        })
        .returning();
      await this.setDepartments(tx, row!.id, departmentIds);
      await this.ctx.audit.record(
        {
          action: 'itam.approved-software.created',
          entityType: APPROVED_SOFTWARE_ENTITY,
          entityId: row!.id,
          entityLabel: entryLabel(row!),
          metadata: {
            status: 'allowed',
            version: input.version,
            licenseModel: input.licenseModel,
            scope: input.scope,
            departmentIds,
            validUntil: input.validUntil,
            request: request.reference,
          },
        },
        { tx },
      );
      await this.ctx.events.publish('itam.approved-software.created', this.payload(row!), { tx });
      return { entry: row!, created: true, changed: true };
    });
  }

  /* ───────────── export ───────────── */

  /**
   * The list in the layout of the paper software whitelist (No., software, version, publisher, licence type,
   * serial / contract no., scope), then status, valid until, request and notes: CSV, UTF-8 with a BOM so
   * spreadsheets open it with the right characters.
   */
  async exportCsv(q: ExportQuery, auth: AuthContext, locale: CatalogLocale) {
    auth.require(SOFTWARE_READ);
    const today = companyToday();
    const c = CATALOGS[locale] ?? CATALOGS.en;
    const x = c.approvedSoftware.export;
    const rows = await this.db
      .select()
      .from(approvedSoftware)
      .where(this.where(q, today))
      .orderBy(...this.order(q.sort))
      .limit(10_000);
    const items = await this.dtos(rows, today);
    const lines = [
      csvLine([
        x.number,
        x.title,
        x.version,
        x.publisher,
        x.licenseModel,
        x.reference,
        x.scope,
        x.status,
        x.validUntil,
        x.request,
        x.notes,
      ]),
      ...items.map((e, i) =>
        csvLine([
          String(i + 1),
          e.title,
          e.version ?? x.anyVersion,
          e.publisher,
          c.licenseModel[e.licenseModel],
          [e.license?.reference, e.contract?.reference].filter(Boolean).join(' / '),
          e.scope === 'company' ? x.company : e.departments.map((d) => d.name).join('; '),
          c.approvalStatus[e.status],
          e.validUntil ?? x.permanent,
          e.requestReference,
          e.notes,
        ]),
      ),
    ];
    return `\uFEFF${lines.join('\r\n')}\r\n`;
  }

  /* ───────────── compliance ───────────── */

  /** Installs on devices in use that the list doesn't cover (`unapproved`) or blocks, most recent first. */
  async compliance(q: ComplianceQuery, auth: AuthContext) {
    auth.require(HARDWARE_MANAGE);
    const today = companyToday();
    const inUse = await this.allowListInUse();
    const approval = approvalSql(today, inUse);
    const where = all(
      flaggedWhere(today, inUse),
      q.approval === 'blocked' ? coveringEntry('blocked', today) : undefined,
      q.approval === 'unapproved'
        ? inUse
          ? and(sql`not ${coveringEntry('blocked', today)}`, sql`not ${coveringEntry('allowed', today)}`)
          : sql`false`
        : undefined,
      q.department
        ? or(
            eq(assets.departmentId, q.department),
            sql`exists (select 1 from ${users} u where u.id = ${assets.assignedTo} and u.department_id = ${q.department})`,
          )
        : undefined,
      q.q
        ? or(
            ilike(softwareInstallations.product, likePattern(q.q)),
            ilike(softwareInstallations.reportedAs, likePattern(q.q)),
            ilike(assets.name, likePattern(q.q)),
            ilike(assets.serialNumber, likePattern(q.q)),
          )
        : undefined,
    );
    const [rows, [total]] = await Promise.all([
      this.db
        .select({
          i: softwareInstallations,
          a: assets,
          departmentName: departments.name,
          approval,
        })
        .from(softwareInstallations)
        .innerJoin(assets, eq(assets.id, softwareInstallations.assetId))
        .leftJoin(departments, eq(departments.id, assets.departmentId))
        .where(where)
        .orderBy(
          desc(softwareInstallations.lastSeenAt),
          asc(assets.number),
          asc(softwareInstallations.product),
        )
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db
        .select({ n: count() })
        .from(softwareInstallations)
        .innerJoin(assets, eq(assets.id, softwareInstallations.assetId))
        .where(where),
    ]);
    const people = await peopleByIds(
      this.db,
      rows.map((r) => r.a.assignedTo),
    );
    return {
      items: rows.map(({ i, a, departmentName, approval: state }) => {
        const holder = a.assignedTo ? people.get(a.assignedTo) : undefined;
        const deptId = a.departmentId ?? holder?.departmentId ?? null;
        const deptName = a.departmentId ? departmentName : (holder?.departmentName ?? null);
        return {
          id: i.id,
          asset: {
            id: a.id,
            tag: formatAssetTag(a.number),
            name: a.name,
            category: a.category,
            status: a.status,
            assignee: personRef(holder),
            department: deptId ? { id: deptId, name: deptName ?? '—' } : null,
          },
          product: i.product,
          reportedAs: i.reportedAs,
          publisher: i.publisher,
          version: i.version,
          source: i.source,
          approval: state === 'blocked' ? ('blocked' as const) : ('unapproved' as const),
          lastSeenAt: i.lastSeenAt,
        };
      }),
      total: total!.n,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /** Counts for the Discovery page and the dashboard. */
  async summary(auth: AuthContext) {
    auth.require(HARDWARE_MANAGE);
    return this.counts();
  }

  async counts() {
    const today = companyToday();
    const inUse = await this.allowListInUse();
    const blocked = coveringEntry('blocked', today);
    const [row] = await this.db
      .select({
        blocked: sql<number>`count(*) filter (where ${blocked})`.mapWith(Number),
        unapproved: sql<number>`count(*) filter (where not ${blocked})`.mapWith(Number),
        devices: sql<number>`count(distinct ${softwareInstallations.assetId})`.mapWith(Number),
      })
      .from(softwareInstallations)
      .innerJoin(assets, eq(assets.id, softwareInstallations.assetId))
      .where(flaggedWhere(today, inUse));
    return {
      allowListInUse: inUse,
      unapproved: row?.unapproved ?? 0,
      blocked: row?.blocked ?? 0,
      devices: row?.devices ?? 0,
    };
  }

  /* ───────────── reminders ───────────── */

  /**
   * Daily: one digest to the asset managers about allowed entries ending within 14 days (short-term approvals),
   * once per entry and end date.
   */
  async expiryDigest(today: string = companyToday()): Promise<number> {
    const due = await this.db
      .select({
        id: approvedSoftware.id,
        title: approvedSoftware.title,
        validUntil: approvedSoftware.validUntil,
      })
      .from(approvedSoftware)
      .where(
        and(
          eq(approvedSoftware.status, 'allowed'),
          isNotNull(approvedSoftware.validUntil),
          gte(approvedSoftware.validUntil, today),
          lte(approvedSoftware.validUntil, addDays(today, APPROVAL_EXPIRING_DAYS)),
          sql`${approvedSoftware.expiryNotifiedFor} is distinct from ${approvedSoftware.validUntil}`,
        ),
      )
      .orderBy(asc(approvedSoftware.validUntil))
      .limit(500);
    if (!due.length) return 0;
    await this.ctx.transaction(async (tx) => {
      await tx
        .update(approvedSoftware)
        .set({
          expiryNotifiedFor: sql`${approvedSoftware.validUntil}`,
          updatedAt: sql`${approvedSoftware.updatedAt}`,
        })
        .where(
          inArray(
            approvedSoftware.id,
            due.map((d) => d.id),
          ),
        );
      await this.ctx.notifications.notify(
        {
          type: 'itam.approved-software.expiring',
          recipients: await roleHolders(tx, 'itam-asset-manager'),
          params: {
            count: due.length,
            days: APPROVAL_EXPIRING_DAYS,
            titles: due
              .slice(0, 8)
              .map((d) => d.title)
              .join(', '),
          },
          href: '/itam/approved-software?state=expiring',
        },
        { tx },
      );
    });
    return due.length;
  }
}

const entryLabel = (r: { title: string; version: string | null }) =>
  r.version ? `${r.title} ${r.version}` : r.title;
