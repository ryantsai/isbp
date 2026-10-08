import { createHash } from 'node:crypto';
import { isLocale, type Locale } from '@isbp/i18n';
import {
  type AppliedCustomization,
  type ApplyOptions,
  type AuthContext,
  type BuiltTemplateItem,
  type ChangeSetPackage,
  type CustomizationChange,
  type CustomizationHandler,
  type CustomizationIssue,
  type CustomizationKindDef,
  type CustomizationKindInfo,
  type CustomizationOp,
  type CustomizationPackageDef,
  type CustomizationPackageInfo,
  type CustomizationsService,
  type CustomizationValidation,
  type Db,
  ErrorCodes,
  HttpError,
  type ModuleContext,
  type PackageRequirements,
  type Principal,
  PermissionSet,
  type ProposableOp,
  type ServerModule,
  validateFields,
  type VersionedObject,
} from '@isbp/sdk/server';
import { z } from 'zod';
import type { ModuleRegistry } from './modules';

interface KindEntry {
  kind: string;
  moduleId: string;
  def: CustomizationKindDef;
  handler: CustomizationHandler;
}

interface PackageEntry {
  moduleId: string;
  def: CustomizationPackageDef;
  load: (opts: { locale: Locale }) => ChangeSetPackage | Promise<ChangeSetPackage>;
}

/** Without `operations`: update only — creating needs a declared way back (archive or delete). */
const DEFAULT_OPS: ProposableOp[] = ['update'];

/** Holds the permission at any scope. */
function reaches(auth: AuthContext, permission: string): boolean {
  const r = auth.reach(permission);
  return r.global || r.departmentIds.length > 0 || r.records.length > 0;
}

/** `auth` plus one permission held globally (dry runs assume the kind's apply permission). */
function withPermission(auth: AuthContext, permission: string): AuthContext {
  if (auth.can(permission)) return auth;
  const permissions = new PermissionSet([...auth.permissions.grants, { p: permission, s: 'g' }]);
  return {
    ...auth,
    permissions,
    can: (p, resource) => permissions.can(p, resource),
    require: (p, resource) => {
      if (!permissions.can(p, resource)) auth.require(p, resource);
    },
    reach: (p) => permissions.reach(p),
  };
}

/** JSON with sorted keys, so equal values hash equally whatever order a service built them in. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value ?? null);
}

/** A short hash of what a change set would see change: the value and whether it is archived. */
export function versionOf(value: unknown, archived: boolean | undefined): string {
  return createHash('sha256')
    .update(canonical({ value, archived: !!archived }))
    .digest('base64url')
    .slice(0, 22);
}

/**
 * A context whose database work joins `tx` (nested `transaction()` calls become savepoints). Audit entries default
 * to `tx` and `principal`, and carry `source` in their metadata.
 */
export function bindToTransaction(
  ctx: ModuleContext,
  tx: Db,
  opts: { principal?: Principal; source?: ApplyOptions['source'] } = {},
): ModuleContext {
  return {
    ...ctx,
    db: tx,
    transaction: <T>(fn: (t: Db) => Promise<T>) => tx.transaction((sp) => fn(sp as unknown as Db)),
    audit: {
      record: (entry, o = {}) =>
        ctx.audit.record(
          opts.source ? { ...entry, metadata: { ...entry.metadata, source: opts.source } } : entry,
          { tx: o.tx ?? tx, principal: o.principal ?? opts.principal },
        ),
      diff: ctx.audit.diff.bind(ctx.audit),
    },
  };
}

function issuesOf(error: z.ZodError): CustomizationIssue[] {
  return error.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code }));
}

/**
 * `ctx.customizations`: the customisation kinds (`manifest.customizations`) of enabled modules. Reads need the
 * kind's `readPermission` (at any scope), applying its `applyPermission` (globally). The kernel parses values
 * with the kind's schema, versions objects by hash so change sets notice concurrent edits, and runs `apply`
 * with a context bound to the caller's transaction.
 */
export class CustomizationRegistry {
  private readonly entries = new Map<string, KindEntry>();
  /** Built-in packages by `<module>/<key>`. */
  private readonly packageEntries = new Map<string, PackageEntry>();
  /** Package contents are code: built once per process and locale (`<module>/<key>:<locale>`). */
  private readonly packageCache = new Map<string, Promise<ChangeSetPackage>>();

  constructor(private readonly registry: ModuleRegistry) {
    for (const m of registry.modules as readonly ServerModule[]) {
      for (const def of m.manifest.customizations ?? []) {
        const kind = `${m.manifest.id}.${def.kind}`;
        this.entries.set(kind, { kind, moduleId: m.manifest.id, def, handler: m.customizations![def.kind]! });
      }
      for (const def of m.manifest.customizationPackages ?? [])
        this.packageEntries.set(`${m.manifest.id}/${def.key}`, {
          moduleId: m.manifest.id,
          def,
          load: m.customizationPackages![def.key]!,
        });
    }
  }

  /**
   * A built-in package's content built for `locale` (English when it isn't one of the platform's), once per locale;
   * a failed build is retried next time.
   */
  private content(id: string, p: PackageEntry, locale: string): Promise<ChangeSetPackage> {
    const lang: Locale = isLocale(locale) ? locale : 'en';
    const cacheKey = `${id}:${lang}`;
    let cached = this.packageCache.get(cacheKey);
    if (!cached) {
      cached = Promise.resolve()
        .then(() => p.load({ locale: lang }))
        .then((pkg) => {
          if (!pkg || typeof pkg !== 'object' || !Array.isArray(pkg.items))
            throw new Error(`package ${id} has no items`);
          return pkg;
        });
      cached.catch(() => this.packageCache.delete(cacheKey));
      this.packageCache.set(cacheKey, cached);
    }
    return cached;
  }

  /** What installing `pkg` needs, as `auth`. */
  private requirements(
    pkg: Pick<ChangeSetPackage, 'items' | 'requires'>,
    auth: AuthContext,
  ): PackageRequirements {
    const kinds = [...new Set(pkg.items.map((i) => i.kind))];
    const owner = (kind: string) => kind.split('.')[0]!;
    const missingModules = [...new Set([...(pkg.requires?.modules ?? []), ...kinds.map(owner)])]
      .filter((m) => !this.registry.isEnabled(m))
      .sort();
    const present = kinds.filter((k) => this.registry.isEnabled(owner(k)));
    const unknownKinds = present.filter((k) => !this.entries.has(k)).sort();
    const known = present.flatMap((k) => this.entries.get(k) ?? []);
    const unreadableKinds = known
      .filter((e) => !reaches(auth, e.def.readPermission))
      .map((e) => ({ kind: e.kind, permission: e.def.readPermission }))
      .sort((a, b) => a.kind.localeCompare(b.kind));
    const unsupported = pkg.items.flatMap((item, index) => {
      const e = this.entries.get(item.kind);
      return e && this.registry.isEnabled(e.moduleId) && !this.ops(e).includes(item.op)
        ? [{ index, kind: item.kind, op: item.op, operations: this.ops(e) }]
        : [];
    });
    const missingApplyPermissions = [
      ...new Set(known.filter((e) => !auth.can(e.def.applyPermission)).map((e) => e.def.applyPermission)),
    ].sort();
    return { missingModules, unknownKinds, unreadableKinds, unsupported, missingApplyPermissions };
  }

  private entry(kind: string): KindEntry {
    const e = this.entries.get(kind);
    if (!e) throw new HttpError(404, ErrorCodes.NOT_FOUND, `Unknown customisation kind ${kind}`, { kind });
    if (!this.registry.isEnabled(e.moduleId))
      throw new HttpError(409, ErrorCodes.MODULE_DISABLED, `Module ${e.moduleId} is disabled`, {
        moduleId: e.moduleId,
      });
    return e;
  }

  private readable(kind: string, auth: AuthContext): KindEntry {
    const e = this.entry(kind);
    if (!reaches(auth, e.def.readPermission))
      throw new HttpError(403, ErrorCodes.FORBIDDEN, `Reading ${kind} needs ${e.def.readPermission}`, {
        permission: e.def.readPermission,
      });
    return e;
  }

  private ops(e: KindEntry): ProposableOp[] {
    return e.def.operations ?? DEFAULT_OPS;
  }

  private allows(e: KindEntry, op: CustomizationOp): boolean {
    const ops = this.ops(e);
    return op === 'restore' ? ops.includes('archive') : ops.includes(op);
  }

  private info(e: KindEntry, auth: AuthContext): CustomizationKindInfo {
    return {
      kind: e.kind,
      moduleId: e.moduleId,
      label: e.def.label,
      description: e.def.description,
      icon: e.def.icon ?? null,
      operations: this.ops(e),
      readPermission: e.def.readPermission,
      applyPermission: e.def.applyPermission,
      canApply: auth.can(e.def.applyPermission),
      templates: (e.handler.templates ?? []).map((t) => ({
        id: t.id,
        label: t.label,
        description: t.description,
      })),
    };
  }

  private async versioned(e: KindEntry, id: string, ctx: ModuleContext, auth: AuthContext) {
    const obj = await e.handler.get(id, ctx, auth);
    return obj ? { ...obj, version: versionOf(obj.value, obj.archived) } : null;
  }

  /** Schema, operation and reference checks of one change, as `auth`, reading through `ctx`. */
  private async check(
    e: KindEntry,
    change: CustomizationChange,
    ctx: ModuleContext,
    auth: AuthContext,
  ): Promise<CustomizationValidation> {
    const issues: CustomizationIssue[] = [];
    if (!this.allows(e, change.op))
      issues.push({ path: '', message: `${e.kind} does not support "${change.op}"`, code: 'operation' });
    const current = change.id ? await this.versioned(e, change.id, ctx, auth) : null;
    if (change.op !== 'create' && !current)
      issues.push({
        path: '',
        message: `${e.kind} ${change.id ?? '(no id)'} was not found`,
        code: 'not_found',
      });
    if (change.op === 'archive' && current?.archived)
      issues.push({ path: '', message: 'Already archived', code: 'archived' });
    if (change.op === 'restore' && current && !current.archived)
      issues.push({ path: '', message: 'Not archived', code: 'not_archived' });
    let value: unknown = null;
    if (change.op === 'create' || change.op === 'update') {
      const parsed = e.handler.schema.safeParse(change.value);
      if (parsed.success) value = parsed.data;
      else issues.push(...issuesOf(parsed.error));
    }
    if (!issues.length && e.handler.check)
      issues.push(...(await e.handler.check({ op: change.op, id: change.id, value }, ctx, auth)));
    return { value, issues, current };
  }

  service(): CustomizationsService {
    return {
      kinds: (auth) =>
        [...this.entries.values()]
          .filter((e) => this.registry.isEnabled(e.moduleId) && reaches(auth, e.def.readPermission))
          .map((e) => this.info(e, auth))
          .sort((a, b) => a.kind.localeCompare(b.kind)),

      describe: async (kind, auth) => {
        const e = this.readable(kind, auth);
        const ctx = this.registry.context(e.moduleId);
        let schema: Record<string, unknown>;
        try {
          schema = z.toJSONSchema(e.handler.schema, { unrepresentable: 'any', io: 'input' }) as Record<
            string,
            unknown
          >;
        } catch {
          schema = {};
        }
        return { kind: this.info(e, auth), schema, guide: await e.handler.guide(ctx, auth) };
      },

      list: async (kind, opts, auth) => {
        const e = this.readable(kind, auth);
        return e.handler.list(
          {
            q: opts.q?.trim() || undefined,
            limit: Math.min(Math.max(opts.limit ?? 50, 1), 200),
            includeArchived: opts.includeArchived ?? false,
          },
          this.registry.context(e.moduleId),
          auth,
        );
      },

      get: async (kind, id, auth) => {
        const e = this.readable(kind, auth);
        return this.versioned(e, id, this.registry.context(e.moduleId), auth);
      },

      validate: async (kind, change, auth) => {
        const e = this.readable(kind, auth);
        return this.check(e, change, this.registry.context(e.moduleId), auth);
      },

      apply: async (kind, change, { auth: caller, tx, source, dryRun }): Promise<AppliedCustomization> => {
        const e = this.entry(kind);
        if (!dryRun && !caller.can(e.def.applyPermission))
          throw new HttpError(403, ErrorCodes.FORBIDDEN, `Applying ${kind} needs ${e.def.applyPermission}`, {
            permission: e.def.applyPermission,
            kind,
          });
        const auth = dryRun ? withPermission(caller, e.def.applyPermission) : caller;
        const ctx = bindToTransaction(this.registry.context(e.moduleId), tx, {
          principal: auth.principal,
          source,
        });
        const { value, issues, current } = await this.check(e, change, ctx, auth);
        if (change.baseVersion !== undefined && change.op !== 'create') {
          const now = current?.version ?? null;
          if (now !== change.baseVersion)
            throw new HttpError(409, ErrorCodes.CHANGE_SET_STALE, `${kind} ${change.id} changed`, {
              kind,
              id: change.id,
            });
        }
        if (issues.length)
          throw new HttpError(422, ErrorCodes.VALIDATION_FAILED, `Invalid ${kind} change`, { kind, issues });
        const { id } = await e.handler.apply({ op: change.op, id: change.id, value }, ctx, auth);
        const after = await this.versioned(e, id, ctx, auth);
        return { id, before: current as VersionedObject | null, after };
      },

      committed: async (kind, change) => {
        const e = this.entries.get(kind);
        if (!e?.handler.committed) return;
        try {
          await e.handler.committed(change, this.registry.context(e.moduleId));
        } catch {
          // Cache refreshes are best effort: the caches expire on their own.
        }
      },

      templateFields: async (kind, templateId, auth) => {
        const e = this.readable(kind, auth);
        const t = e.handler.templates?.find((x) => x.id === templateId);
        if (!t) throw new HttpError(404, ErrorCodes.NOT_FOUND, `Unknown template ${templateId}`);
        return t.fields(this.registry.context(e.moduleId), auth);
      },

      buildTemplate: async (kind, templateId, answers, auth) => {
        const e = this.readable(kind, auth);
        const t = e.handler.templates?.find((x) => x.id === templateId);
        if (!t) throw new HttpError(404, ErrorCodes.NOT_FOUND, `Unknown template ${templateId}`);
        const ctx = this.registry.context(e.moduleId);
        const fields = await t.fields(ctx, auth);
        const result = validateFields(fields, answers);
        if (!result.ok)
          throw new HttpError(422, ErrorCodes.VALIDATION_FAILED, 'Invalid answers', {
            issues: Object.entries(result.errors).map(([path, err]) => ({ path, message: err.code })),
          });
        const built = await t.build(result.values, ctx, auth);
        const own: BuiltTemplateItem = {
          kind,
          op: built.op,
          id: built.id ?? null,
          label: built.label ?? null,
          value: built.value,
          ref: built.ref ?? null,
        };
        const before = (built.before ?? []).map((b): BuiltTemplateItem => ({
          kind: b.kind,
          op: b.op,
          id: b.id ?? null,
          label: b.label ?? null,
          value: b.value,
          ref: b.ref ?? null,
        }));
        return { op: own.op, id: own.id, label: own.label, value: own.value, items: [...before, own] };
      },

      requirements: (pkg, auth) => this.requirements(pkg, auth),

      packages: async (auth) => {
        const out: CustomizationPackageInfo[] = [];
        // Built as it would install for this person (the change set takes the same language).
        const locale = auth.user?.locale ?? 'en';
        for (const [id, p] of this.packageEntries) {
          if (!this.registry.isEnabled(p.moduleId)) continue;
          let pkg: ChangeSetPackage;
          try {
            pkg = await this.content(id, p, locale);
          } catch (err) {
            this.registry
              .context(p.moduleId)
              .logger.warn({ err, package: id }, 'built-in package failed to load');
            continue;
          }
          const requirements = this.requirements(pkg, auth);
          const canPropose =
            !requirements.missingModules.length &&
            !requirements.unknownKinds.length &&
            !requirements.unreadableKinds.length &&
            !requirements.unsupported.length;
          out.push({
            key: p.def.key,
            moduleId: p.moduleId,
            name: p.def.name,
            description: p.def.description,
            icon: p.def.icon ?? null,
            itemCount: pkg.items.length,
            kinds: [...new Set(pkg.items.map((i) => i.kind))].sort(),
            requirements,
            canPropose,
            canApply: canPropose && !requirements.missingApplyPermissions.length,
          });
        }
        return out.sort((a, b) => a.moduleId.localeCompare(b.moduleId) || a.key.localeCompare(b.key));
      },

      loadPackage: async (moduleId, key, { locale }) => {
        const id = `${moduleId}/${key}`;
        const p = this.packageEntries.get(id);
        if (!p || !this.registry.isEnabled(moduleId))
          throw new HttpError(404, ErrorCodes.NOT_FOUND, `Unknown package ${id}`, { moduleId, key });
        return structuredClone(await this.content(id, p, locale));
      },
    };
  }
}
