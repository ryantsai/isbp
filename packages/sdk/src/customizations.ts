/**
 * Phase 6 extension point: **customisation kinds**.
 *
 * A customisation kind is one surface an administrator configures — an approval workflow, a request form, a
 * custom field, a role, a scheduled job, a sync profile — owned by the module that owns the surface. The module
 * declares the kind in `manifest.customizations` and implements it in `defineServerModule({ customizations })`
 * with the same schemas and services as its admin pages, so a change built by the AI agent (or by an outside
 * agent over MCP) can never be something the admin UI would refuse. The kernel reaches every enabled module's
 * kinds as `ctx.customizations`; the `assistant` module collects proposals into change sets that a person
 * reviews and applies in one transaction, and can roll back.
 */
import type { Locale } from '@isbp/i18n';
import type { z } from 'zod';
import type { LocalizedText } from './conditions';
import type { FieldDef } from './fields';
import type { AuthContext, Db, ModuleContext } from './server';

/**
 * `archive` disables an object without deleting it (archived, inactive, disabled — whatever the surface calls it)
 * and `restore` is its inverse; `delete` removes it. Rollbacks undo a `create` with `delete` (or `archive` when the
 * kind cannot delete), an `update` with an `update` back to the old value, and an `archive` with `restore`.
 */
export type CustomizationOp = 'create' | 'update' | 'archive' | 'restore' | 'delete';

/** Operations a change set may propose (`restore` only appears in rollbacks). */
export type ProposableOp = Exclude<CustomizationOp, 'restore'>;

export interface CustomizationKindDef {
  /** Name inside the module; the full kind is `<module>.<kind>`, e.g. `core.workflow`. */
  kind: string;
  /** i18n key of the singular noun ("Approval workflow"). */
  label: string;
  /** What the kind configures, in English, for people and models. */
  description: string;
  /** lucide icon name. */
  icon?: string;
  /** Needed to see the kind's objects and to propose changes to them. */
  readPermission: string;
  /** Needed to apply (and roll back) a change. Services still check their own rules (e.g. escalation). */
  applyPermission: string;
  /**
   * Operations a change may use (default: update only). `archive` brings `restore` for rollbacks. A kind that
   * can create must also archive or delete, so every change can be rolled back. `archive` and `delete` are
   * destructive: applying them needs an explicit confirmation.
   */
  operations?: ProposableOp[];
}

/**
 * A built-in package (`manifest.customizationPackages`): a ready-made set of configuration changes — the forms,
 * approval workflows, groups and scheduled jobs of a process — that an administrator installs as one change set.
 * The content comes from `defineServerModule({ customizationPackages: { [key]: ({ locale }) => ChangeSetPackage } })`,
 * built for the installer's language.
 */
export interface CustomizationPackageDef {
  /** Name inside the module, kebab-case (`isms-processes`); addressed as `<module>/<key>`. */
  key: string;
  /** i18n keys of the module's catalog. */
  name: string;
  description: string;
  /** lucide icon name. */
  icon?: string;
}

/**
 * A page where people use an object, besides its admin page: a request form in the portal
 * (`/requests/forms/laptop-request`, "Open the form"). Shown after a change set applies it, and given to the agent so
 * it can tell the person where to go.
 */
export interface CustomizationLink {
  /** Web path inside the platform. */
  href: string;
  /** What the link opens, per locale (from the owning module's catalog). */
  label: LocalizedText;
}

/** One object of a kind, in lists. */
export interface CustomizationSummary {
  id: string;
  label: string;
  description?: string | null;
  /** Archived (inactive, disabled) objects are listed only on request. Not part of `value`. */
  archived?: boolean;
  /** Web path of the object's admin page. */
  href?: string | null;
  /** Where people use the object (not part of `value` or its version); only while it is usable. */
  links?: CustomizationLink[];
}

/** One object with its full configuration. */
export interface CustomizationObject<V = unknown> extends CustomizationSummary {
  /** In the shape of the kind's `schema`: what `create` takes and `update` replaces. */
  value: V;
}

export interface CustomizationIssue {
  /** Dot path into the value (`steps.0.approvers`), or '' for the whole value. */
  path: string;
  message: string;
  /** Machine-readable reason, e.g. `unknown_group`, `duplicate_key`. */
  code?: string;
}

/** What a model (or a person) needs to build a good value: read through tools, never from training data. */
export interface CustomizationGuide {
  /** How to build a value, in English; concise. */
  instructions: string;
  /** Live reference data the value points at (triggers and their facts, entity types, permissions …). */
  reference?: Record<string, unknown>;
  /** Worked examples, in the shape of the schema. */
  examples?: { description: string; value: unknown }[];
}

/** A change to one object. `id` is null for `create`; `value` is null for `archive`/`restore`/`delete`. */
export interface CustomizationChange<V = unknown> {
  op: CustomizationOp;
  id: string | null;
  value: V | null;
}

/** One change a guided template builds. */
export interface TemplateProposal<V = unknown> {
  op: 'create' | 'update';
  /** The object to update. */
  id?: string | null;
  label?: string;
  value: V;
  /**
   * Names the change inside its change set: another change of the same template refers to the object it creates
   * as `"$ref:<ref>"` (a form's `workflowId`). The change set keeps names unique, renaming them when needed.
   */
  ref?: string;
}

/**
 * A guided template for builtin mode (no chat model): a few questions that build a value. Labels in `fields`
 * are per locale (FieldDef), so the questions can carry live options (triggers, groups) resolved per request.
 */
export interface CustomizationTemplate<V = unknown> {
  id: string;
  /** i18n keys of the owning module. */
  label: string;
  description: string;
  fields(ctx: ModuleContext, auth: AuthContext): Promise<FieldDef[]>;
  /**
   * The answers have passed `validateFields(fields)`. Returns the proposal (an update needs `id`) and, in `before`,
   * changes of other kinds proposed ahead of it in the same change set (e.g. the approval workflow a new form
   * refers to with `"$ref:<ref>"`). Every change still goes through its own kind's checks.
   */
  build(
    answers: Record<string, unknown>,
    ctx: ModuleContext,
    auth: AuthContext,
  ): Promise<TemplateProposal<V> & { before?: (TemplateProposal & { kind: string })[] }>;
}

/**
 * The module side of a kind. Reads run as the caller (`auth` holds the kind's `readPermission`). `apply` runs
 * in the change set's transaction: its `ctx` is bound to it (`ctx.db` and `ctx.transaction` use a savepoint),
 * and `auth` is the person applying, who holds the kind's `applyPermission`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface CustomizationHandler<V = any> {
  /** The full value of an object. Reuse the admin API's schemas; describe fields (`.describe()`) for models. */
  schema: z.ZodType<V>;
  guide(ctx: ModuleContext, auth: AuthContext): Promise<CustomizationGuide>;
  list(
    opts: { q?: string; limit: number; includeArchived: boolean },
    ctx: ModuleContext,
    auth: AuthContext,
  ): Promise<CustomizationSummary[]>;
  get(id: string, ctx: ModuleContext, auth: AuthContext): Promise<CustomizationObject<V> | null>;
  /** Checks beyond the schema (references exist, keys are unique, the trigger is known). Never writes. */
  check?(
    change: CustomizationChange<V>,
    ctx: ModuleContext,
    auth: AuthContext,
  ): Promise<CustomizationIssue[]>;
  /** Writes the change with the module's own services. Throws `HttpError`s like the admin API would. */
  apply(change: CustomizationChange<V>, ctx: ModuleContext, auth: AuthContext): Promise<{ id: string }>;
  /**
   * Called after the change set's transaction committed (never after a dry run): refresh this process's caches
   * (settings, lookups) that `apply` could only clear before the commit.
   */
  committed?(change: { op: CustomizationOp; id: string }, ctx: ModuleContext): void | Promise<void>;
  templates?: CustomizationTemplate<V>[];
}

/* ───────────────────────────── kernel service ───────────────────────────── */

export interface CustomizationKindInfo {
  /** Full kind, `<module>.<kind>`. */
  kind: string;
  moduleId: string;
  label: string;
  description: string;
  icon: string | null;
  operations: ProposableOp[];
  readPermission: string;
  applyPermission: string;
  /** The caller may apply changes of this kind. */
  canApply: boolean;
  templates: { id: string; label: string; description: string }[];
}

/** An object with a version: a hash of its value, so a change set can tell when it changed underneath. */
export type VersionedObject<V = unknown> = CustomizationObject<V> & { version: string };

export interface CustomizationValidation<V = unknown> {
  /** The value as the schema parsed it (defaults filled), or null when it did not parse. */
  value: V | null;
  issues: CustomizationIssue[];
  /** The object as it is now (update/archive). */
  current: VersionedObject<V> | null;
}

export interface AppliedCustomization<V = unknown> {
  id: string;
  before: VersionedObject<V> | null;
  after: VersionedObject<V> | null;
}

export interface ApplyOptions {
  auth: AuthContext;
  tx: Db;
  /** What the change belongs to, e.g. `{ type: 'change-set', id, reference: 'CS-12' }`. */
  source?: { type: string; id: string; reference?: string };
  /**
   * A trial run in a transaction the caller rolls back: the kind's `applyPermission` is assumed (the services'
   * own checks still run against `auth`), so a proposal can be checked before someone who may apply it does.
   * Handlers must keep `apply` transactional (no outside calls), so nothing of a dry run escapes the rollback.
   */
  dryRun?: boolean;
}

/** `ctx.customizations`: every enabled module's customisation kinds, with permission checks. */
export interface CustomizationsService {
  /** Kinds the caller may read. */
  kinds(auth: AuthContext): CustomizationKindInfo[];
  /** The kind, its value schema (JSON Schema) and the module's guide. */
  describe(
    kind: string,
    auth: AuthContext,
  ): Promise<{ kind: CustomizationKindInfo; schema: Record<string, unknown>; guide: CustomizationGuide }>;
  list(
    kind: string,
    opts: { q?: string; limit?: number; includeArchived?: boolean },
    auth: AuthContext,
  ): Promise<CustomizationSummary[]>;
  get(kind: string, id: string, auth: AuthContext): Promise<VersionedObject | null>;
  /** Parses and checks a change without writing. */
  validate(kind: string, change: CustomizationChange, auth: AuthContext): Promise<CustomizationValidation>;
  /**
   * Applies one change in `tx` as `auth` (who must hold the kind's `applyPermission`). With `baseVersion`, the
   * object must still be at that version (`CHANGE_SET_STALE` otherwise). Invalid changes throw
   * `VALIDATION_FAILED` with the issues. `source` lands in the metadata of every audit entry the module writes.
   */
  apply(
    kind: string,
    change: CustomizationChange & { baseVersion?: string | null },
    opts: ApplyOptions,
  ): Promise<AppliedCustomization>;
  /** Tells the kind its change committed (see `CustomizationHandler.committed`). Never throws. */
  committed(kind: string, change: { op: CustomizationOp; id: string }): Promise<void>;
  templateFields(kind: string, templateId: string, auth: AuthContext): Promise<FieldDef[]>;
  /**
   * Validates the answers against the template's fields, then builds the proposal (`op`, `id`, `label`, `value`
   * of the template's own kind). `items` lists every change in the order to propose it: the template's `before`
   * changes, then its own (each with its kind and optional `ref`).
   */
  buildTemplate(
    kind: string,
    templateId: string,
    answers: Record<string, unknown>,
    auth: AuthContext,
  ): Promise<{
    op: 'create' | 'update';
    id: string | null;
    label: string | null;
    value: unknown;
    items: BuiltTemplateItem[];
  }>;
  /**
   * What installing a package needs here, as `auth`: modules that aren't enabled, kinds that don't exist, kinds the
   * caller can't read (so can't propose), operations a kind doesn't support, apply permissions the caller lacks.
   */
  requirements(pkg: Pick<ChangeSetPackage, 'items' | 'requires'>, auth: AuthContext): PackageRequirements;
  /** Built-in packages of enabled modules, with what they contain and what installing each needs. */
  packages(auth: AuthContext): Promise<CustomizationPackageInfo[]>;
  /**
   * A built-in package's content (a copy), built for `locale` (the installer's: `auth.user?.locale ?? 'en'`); 404 when
   * it doesn't exist or its module is disabled.
   */
  loadPackage(moduleId: string, key: string, opts: { locale: Locale }): Promise<ChangeSetPackage>;
}

/** One change of a built template, ready to propose. */
export interface BuiltTemplateItem {
  kind: string;
  op: 'create' | 'update';
  id: string | null;
  label: string | null;
  value: unknown;
  ref: string | null;
}

/* ───────────────────────────── change-set packages ───────────────────────────── */

/** The `format` of a change-set package. */
export const CHANGE_SET_PACKAGE_FORMAT = 'isbp.change-set-package';

/** The most changes a package (and a change set) holds. */
export const MAX_PACKAGE_ITEMS = 300;

/**
 * One change of a package: what `POST /assistant/change-sets/:id/items` takes. A later item refers to the object an
 * earlier one creates (or changes) with the string `"$ref:<ref>"` wherever that object's id goes (a form's
 * `workflowId`); keys (a workflow's `groupKey`) are written as they are.
 */
export interface ChangeSetPackageItem {
  /** Names the item: lowercase letters, digits and dashes, starting with a letter (at most 40). */
  ref?: string;
  /** Full kind, `<module>.<kind>` (`core.form`). */
  kind: string;
  op: ProposableOp;
  /** The object to change (not for `create`): its id where the package was made, or `"$ref:<ref>"`. */
  targetId?: string | null;
  /** How the item reads in the change set (default: the value's name). */
  label?: string;
  /** The full value in the kind's schema, for `create` and `update`. */
  value?: unknown;
  note?: string;
}

/**
 * A change set as a file (`format: 'isbp.change-set-package'`, `version: 1`): exported from one change set, imported
 * into another environment, or shipped by a module as a built-in package. Installing it creates a draft change set
 * with its items in order — dry-run, applied and rolled back like any other; nothing is live until a person applies it.
 */
export interface ChangeSetPackage {
  format: typeof CHANGE_SET_PACKAGE_FORMAT;
  version: 1;
  /** A stable name (`isms-processes`), kebab-case. */
  key?: string;
  /** The change set's title (in the installer's language; English, then any filled locale, otherwise). */
  title: LocalizedText;
  summary?: LocalizedText;
  /** Modules that must be enabled besides those owning the items' kinds (an action's module, a record type's). */
  requires?: { modules?: string[] };
  /** At most {@link MAX_PACKAGE_ITEMS}. */
  items: ChangeSetPackageItem[];
}

/** What installing a package needs, for one person (`ctx.customizations.requirements`). */
export interface PackageRequirements {
  /** Modules it needs (`requires.modules` and its kinds' owners) that aren't installed or enabled. */
  missingModules: string[];
  /** Kinds of enabled modules that don't exist. */
  unknownKinds: string[];
  /** Kinds the person can't read, so can't propose, with the permission that reads them. */
  unreadableKinds: { kind: string; permission: string }[];
  /** Items whose kind doesn't support their operation (`index` into `items`). */
  unsupported: { index: number; kind: string; op: string; operations: ProposableOp[] }[];
  /** Apply permissions of its kinds the person doesn't hold (someone who does applies it, or approves a review). */
  missingApplyPermissions: string[];
}

/** A built-in package as `ctx.customizations.packages(auth)` lists it. */
export interface CustomizationPackageInfo {
  key: string;
  moduleId: string;
  /** i18n keys of the owning module. */
  name: string;
  description: string;
  icon: string | null;
  itemCount: number;
  /** Kinds of its items, sorted. */
  kinds: string[];
  requirements: PackageRequirements;
  /** The person may install it: every module and kind is there, they read every kind, every operation is supported. */
  canPropose: boolean;
  /** …and they hold every kind's apply permission. */
  canApply: boolean;
}
