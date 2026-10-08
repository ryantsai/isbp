import { formatRequestNumber } from '@isbp/contracts';
import {
  departments,
  formSubmissions,
  forms,
  formVersions,
  processActionRuns,
  type ProcessActionRunResult,
  roleAssignments,
  roles,
  users,
  uuidv7,
} from '@isbp/db/schema';
import {
  type AuthContext,
  type Db,
  ErrorCodes,
  evaluateCondition,
  expandRowFields,
  type FieldDef,
  type FieldError,
  type FormAction,
  type FormSchema,
  formFields,
  HttpError,
  jsonEscape,
  localize,
  type LocalizedText,
  type ModuleContext,
  PermissionSet,
  type Principal,
  type ProcessActionDef,
  type ProcessActionHandler,
  type ProcessActionOutcome,
  type ProcessActionRequest,
  type ProcessActionResult,
  renderTemplate,
  renderTemplates,
  rowColumns,
  type ServerModule,
  validateFields,
  withToday,
} from '@isbp/sdk/server';
import { and, asc, eq, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { runWithContext } from './context';
import { canonicalJson, type SecretBox } from './crypto';
import { recordFieldFacts } from './fields';
import { buildAuthContext } from './http/auth';
import type { ModuleRegistry } from './modules';
import type { QueueFactory } from './queues';
import type { RecordRegistry } from './records';
import { instanceStepValues } from './workflow/engine';

export const PROCESS_ACTIONS_QUEUE = 'isbp-process-actions';
export const PROCESS_ACTION_QUEUED_EVENT = 'core.process-action.queued';
/** Tries per run before it fails (an `HttpError` fails at once). */
export const PROCESS_ACTION_ATTEMPTS = 3;
const RUN_TIMEOUT_MS = 5 * 60_000;
/** A run left `running` this long was lost with its worker: it is tried again (or fails). */
const STALE_RUNNING_MS = 15 * 60_000;
/** `error_code` of a run skipped because its action's `when` didn't hold (never retried). */
export const SKIPPED_BY_CONDITION = 'CONDITION_NOT_MET';

interface Entry {
  type: string;
  moduleId: string;
  def: ProcessActionDef;
  handler: ProcessActionHandler;
}

export interface ProcessActionIssue {
  path: string;
  message: string;
  code: string;
  params?: Record<string, number>;
}

type RunRow = typeof processActionRuns.$inferSelect;
type SubmissionRow = typeof formSubmissions.$inferSelect;
type FormRow = typeof forms.$inferSelect;

/** A sealed secret as stored in an action's config; the browser sees `{ set: true }` instead. */
interface SealedValue {
  sealed: string;
}
const isSealed = (v: unknown): v is SealedValue =>
  Boolean(v && typeof v === 'object' && typeof (v as SealedValue).sealed === 'string');
const isKeep = (v: unknown) => Boolean(v && typeof v === 'object' && (v as { set?: unknown }).set === true);

/** Replaces every sealed value in a config (whatever its handler) by `{ set: true }`. */
function maskConfig(config: Record<string, unknown>): Record<string, unknown> {
  const walk = (v: unknown): unknown => {
    if (isSealed(v)) return { set: true };
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object')
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(config) as Record<string, unknown>;
}

/** A form schema as administrators may see it: secrets in action configs masked. */
export function maskFormSecrets(schema: FormSchema): FormSchema {
  if (!schema.actions?.length) return schema;
  return { ...schema, actions: schema.actions.map((a) => ({ ...a, config: maskConfig(a.config) })) };
}

/** A form schema for people who fill it in or follow a request: no actions at all. */
export function publicFormSchema(schema: FormSchema): FormSchema {
  const { actions: _actions, ...rest } = schema;
  return rest;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`The action timed out after ${ms / 1000}s`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const YES_NO = { true: 'Yes', false: 'No' } as const;

/** A result's summary arguments as stored: at most 10 short strings or finite numbers. */
function cleanParams(params: ProcessActionResult['summaryParams']): Record<string, string | number> | null {
  if (!params || typeof params !== 'object') return null;
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params).slice(0, 10)) {
    if (!/^[a-zA-Z][\w]{0,39}$/.test(k)) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 200);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Process actions (`manifest.processActions`): what forms do after they are sent, approved or rejected. The registry
 * lists the types of enabled modules, validates and seals the actions of a form when it is saved, creates runs in the
 * transaction of a submission's outcome and executes them in the worker (after commit, retried with backoff, as a
 * system principal holding only the providing module's permissions).
 */
export class ProcessActionRegistry {
  private readonly entries = new Map<string, Entry>();
  /** Action order of form versions, by `formId:version`. */
  private readonly orders = new Map<string, Map<string, number>>();
  /** First retry delay; each further one doubles it. Tests shorten it. */
  retryDelayMs = 30_000;

  constructor(
    private readonly deps: {
      db: Db;
      registry: ModuleRegistry;
      queues: QueueFactory;
      records: RecordRegistry;
      box: SecretBox;
      logger: FastifyBaseLogger;
      publicUrl: string;
      core: () => ModuleContext;
    },
  ) {
    for (const m of deps.registry.modules as readonly ServerModule[]) {
      for (const def of m.manifest.processActions ?? []) {
        const type = `${m.manifest.id}.${def.action}`;
        this.entries.set(type, {
          type,
          moduleId: m.manifest.id,
          def,
          handler: m.processActions![def.action]!,
        });
      }
    }
  }

  private get db() {
    return this.deps.db;
  }

  /** A declared action type of an enabled module, or null. */
  private usable(type: string): Entry | null {
    const e = this.entries.get(type);
    return e && this.deps.registry.isEnabled(e.moduleId) ? e : null;
  }

  /** Action types of enabled modules; `allowed` when `auth` holds the type's permission (globally). */
  list(auth?: AuthContext) {
    return [...this.entries.values()]
      .filter((e) => this.deps.registry.isEnabled(e.moduleId))
      .map((e) => ({
        type: e.type,
        moduleId: e.moduleId,
        name: e.def.name,
        description: e.def.description,
        icon: e.def.icon ?? null,
        permission: e.def.permission,
        allowed: auth ? auth.can(e.def.permission) : true,
        secrets: [...(e.handler.secrets ?? [])],
      }));
  }

  /** The configuration fields of an action type for a form (options may depend on the form's fields). */
  async fields(type: string, opts: { form: FormSchema | null; locale: string; auth?: AuthContext }) {
    const e = this.usable(type);
    if (!e)
      throw new HttpError(400, ErrorCodes.PROCESS_ACTION_UNAVAILABLE, `Unknown action type ${type}`, {
        action: type,
      });
    return e.handler.fields(this.deps.registry.context(e.moduleId), opts);
  }

  /** What a form builder needs: every action type with its fields for `form`, and whether the caller may add it. */
  async describe(form: FormSchema, auth: AuthContext, locale: string) {
    return Promise.all(
      this.list(auth).map(async (item) => {
        let fields: FieldDef[] = [];
        try {
          fields = await this.fields(item.type, { form, locale, auth });
        } catch (err) {
          this.deps.logger.warn({ err, type: item.type }, 'process action fields failed');
        }
        return { ...item, fields };
      }),
    );
  }

  /* ───────────── saving a form ───────────── */

  /**
   * Validates the actions of a form being saved (or published) and seals their secrets. Every action must be of a
   * known type and pass its fields; an action that is new or changed compared to `previous` also needs its type's
   * permission and the handler's own `validate`. Secrets: a string is sealed, `{ set: true }` keeps the previous
   * sealed value, empty removes it. Returns the actions to store, or throws 400 `VALIDATION_FAILED` (issues under
   * `prefix`), 400 `PROCESS_ACTION_UNAVAILABLE` or 403 `PROCESS_ACTION_FORBIDDEN`. `db`: the caller's transaction, so
   * options and checks see what it created (a change set that makes a group, then a form notifying it).
   */
  async prepare(
    form: FormSchema,
    previous: readonly FormAction[] | undefined,
    auth: AuthContext,
    opts: { prefix?: string; sealedFrom?: readonly FormAction[]; db?: Db } = {},
  ): Promise<FormAction[] | undefined> {
    if (!form.actions) return undefined;
    const prefix = opts.prefix ?? 'draft';
    const before = new Map((previous ?? []).map((a) => [a.id, a]));
    const sealedSource = new Map((opts.sealedFrom ?? previous ?? []).map((a) => [a.id, a]));
    const issues: ProcessActionIssue[] = [];
    const out: FormAction[] = [];
    for (const [i, action] of form.actions.entries()) {
      const path = `${prefix}.actions.${i}`;
      const old = before.get(action.id);
      const changed = !old || this.comparable(action) !== this.comparable(old);
      const e = this.usable(action.type);
      if (!e) {
        // A saved action whose module was disabled is kept (its runs are skipped); a new one is refused.
        if (changed)
          throw new HttpError(
            400,
            ErrorCodes.PROCESS_ACTION_UNAVAILABLE,
            `Unknown action type ${action.type}, or its module is disabled`,
            { action: action.type, path },
          );
        out.push(old!);
        continue;
      }
      if (changed && !auth.can(e.def.permission))
        throw new HttpError(
          403,
          ErrorCodes.PROCESS_ACTION_FORBIDDEN,
          `Adding or changing ${action.type} actions needs ${e.def.permission}`,
          { action: action.type, permission: e.def.permission, path },
        );
      const secrets = new Set(e.handler.secrets ?? []);
      const sealed: Record<string, SealedValue> = {};
      const keepFrom = sealedSource.get(action.id);
      for (const key of secrets) {
        const v = action.config[key];
        if (typeof v === 'string' && v !== '') sealed[key] = { sealed: this.deps.box.encrypt(v) };
        else if (isKeep(v) && isSealed(keepFrom?.config[key]))
          sealed[key] = keepFrom!.config[key] as SealedValue;
        else if (v !== undefined && v !== null && v !== '' && !isKeep(v))
          issues.push({ path: `${path}.config.${key}`, message: 'invalid', code: 'invalid' });
      }
      const base = this.deps.registry.context(e.moduleId);
      const db = opts.db;
      const ctx: ModuleContext =
        db && db !== base.db
          ? { ...base, db, transaction: (fn) => db.transaction((t) => fn(t as unknown as Db)) }
          : base;
      const fields = await e.handler.fields(ctx, { form, locale: 'en' });
      const plain = Object.fromEntries(Object.entries(action.config).filter(([k]) => !secrets.has(k)));
      // Secrets are checked for presence only (their text is never validated against patterns or shown).
      const probe = { ...plain, ...Object.fromEntries(Object.keys(sealed).map((k) => [k, 'x'])) };
      const result = validateFields(fields, probe);
      for (const [key, err] of Object.entries(result.errors))
        issues.push(this.issue(`${path}.config.${key}`, err));
      const config = Object.fromEntries(Object.entries(result.values).filter(([k]) => !secrets.has(k)));
      if (result.ok && changed && e.handler.validate) {
        try {
          await e.handler.validate(config, ctx, { form, auth });
        } catch (err) {
          const nested = err instanceof HttpError && err.code === ErrorCodes.VALIDATION_FAILED;
          const list = nested ? (err.details as { issues?: ProcessActionIssue[] } | undefined)?.issues : null;
          if (!list?.length) throw err;
          for (const it of list)
            issues.push({ ...it, path: `${path}.config.${it.path}`, code: it.code ?? 'invalid' });
        }
      }
      out.push({
        id: action.id,
        on: action.on,
        type: action.type,
        ...(action.name ? { name: action.name } : {}),
        ...(action.when ? { when: action.when } : {}),
        config: { ...config, ...sealed },
      });
    }
    if (issues.length)
      throw new HttpError(400, ErrorCodes.VALIDATION_FAILED, 'Some process actions are not valid', {
        issues,
      });
    return out;
  }

  private issue(path: string, err: FieldError): ProcessActionIssue {
    return { path, message: err.code, code: err.code, ...(err.params ? { params: err.params } : {}) };
  }

  /** An action for change detection: a kept secret (`{ set: true }`) compares equal to the stored one. */
  private comparable(action: FormAction): string {
    return canonicalJson({ ...action, config: maskConfig(action.config) });
  }

  /* ───────────── runs ───────────── */

  /**
   * Creates the runs of a submission's actions for these outcomes, inside the transaction that records the outcome,
   * and publishes `core.process-action.queued` so the worker runs them after commit. Idempotent per action.
   */
  async queue(
    tx: Db,
    submission: { id: string; version: number },
    schema: FormSchema,
    outcomes: readonly ProcessActionOutcome[],
    decidedBy: string | null = null,
  ): Promise<string[]> {
    const actions = (schema.actions ?? []).filter((a) => outcomes.includes(a.on));
    if (!actions.length) return [];
    // Conditional actions (`when`) are decided now, on what is known at this outcome; the others are skipped.
    const facts = actions.some((a) => a.when) ? await this.conditionFacts(tx, submission.id, schema) : null;
    const now = new Date();
    const rows = await tx
      .insert(processActionRuns)
      .values(
        actions.map((a) => {
          const holds = !a.when || evaluateCondition(a.when, facts);
          return {
            id: uuidv7(),
            submissionId: submission.id,
            formVersion: submission.version,
            actionId: a.id,
            type: a.type,
            outcome: a.on,
            decidedBy: a.on === 'submitted' ? null : decidedBy,
            ...(holds
              ? {}
              : {
                  status: 'skipped' as const,
                  errorCode: SKIPPED_BY_CONDITION,
                  error: 'Its condition did not hold for this request',
                  finishedAt: now,
                }),
          };
        }),
      )
      .onConflictDoNothing()
      .returning({
        id: processActionRuns.id,
        actionId: processActionRuns.actionId,
        status: processActionRuns.status,
      });
    // Keep the form's order (the worker picks them up in this order).
    const order = new Map(actions.map((a, i) => [a.id, i]));
    const runIds = rows
      .filter((r) => r.status === 'queued')
      .sort((a, b) => order.get(a.actionId)! - order.get(b.actionId)!)
      .map((r) => r.id);
    if (runIds.length)
      await this.deps
        .core()
        .events.publish(PROCESS_ACTION_QUEUED_EVENT, { submissionId: submission.id, runIds }, { tx });
    return runIds;
  }

  /**
   * What an action's `when` is evaluated against: the answers (`data`), the picked records' facts (`records`), what
   * approvers filled in (`steps.<stepId>.<key>`), the requester (as workflows see them) and `today`.
   */
  async conditionFacts(db: Db, submissionId: string, schema: FormSchema): Promise<Record<string, unknown>> {
    const [sub] = await db
      .select({
        data: formSubmissions.data,
        submittedBy: formSubmissions.submittedBy,
        workflowInstanceId: formSubmissions.workflowInstanceId,
      })
      .from(formSubmissions)
      .where(eq(formSubmissions.id, submissionId));
    if (!sub) return withToday({});
    const [records, steps, requester] = await Promise.all([
      recordFieldFacts(formFields(schema), sub.data, (refs) => this.deps.records.facts(refs)),
      instanceStepValues(db, sub.workflowInstanceId),
      sub.submittedBy
        ? db
            .select({
              id: users.id,
              email: users.email,
              jobTitle: users.jobTitle,
              managerId: users.managerId,
              departmentId: users.departmentId,
              departmentCode: departments.code,
            })
            .from(users)
            .leftJoin(departments, eq(departments.id, users.departmentId))
            .where(eq(users.id, sub.submittedBy))
            .then((r) => r[0] ?? null)
        : Promise.resolve(null),
    ]);
    return withToday({ data: sub.data, records, steps, requester });
  }

  /** Order of a form version's actions (cached: published versions never change). */
  private async actionOrder(formId: string, version: number): Promise<Map<string, number>> {
    const key = `${formId}:${version}`;
    const hit = this.orders.get(key);
    if (hit) return hit;
    const [v] = await this.db
      .select({ schema: formVersions.schema })
      .from(formVersions)
      .where(and(eq(formVersions.formId, formId), eq(formVersions.version, version)));
    const order = new Map((v?.schema.actions ?? []).map((a, i) => [a.id, i]));
    if (this.orders.size > 1_000) this.orders.clear();
    this.orders.set(key, order);
    return order;
  }

  /**
   * The runs among `runIds` whose turn it is: a request's actions for one outcome run one after another, in the
   * form's order, so each may rely on the one before (a later run waits while an earlier one is queued or running;
   * a failed one doesn't block the rest).
   */
  private async inTurn(runIds: readonly string[]): Promise<string[]> {
    if (!runIds.length) return [];
    const mine = await this.db
      .select({ id: processActionRuns.id, submissionId: processActionRuns.submissionId })
      .from(processActionRuns)
      .where(inArray(processActionRuns.id, [...runIds]));
    const subs = [...new Set(mine.map((r) => r.submissionId))];
    const all = await this.db
      .select({
        id: processActionRuns.id,
        submissionId: processActionRuns.submissionId,
        formId: formSubmissions.formId,
        formVersion: processActionRuns.formVersion,
        outcome: processActionRuns.outcome,
        actionId: processActionRuns.actionId,
        status: processActionRuns.status,
      })
      .from(processActionRuns)
      .innerJoin(formSubmissions, eq(formSubmissions.id, processActionRuns.submissionId))
      .where(inArray(processActionRuns.submissionId, subs));
    const wanted = new Set(runIds);
    const ready: string[] = [];
    for (const run of all) {
      if (!wanted.has(run.id) || run.status !== 'queued') continue;
      const order = await this.actionOrder(run.formId, run.formVersion);
      const mineAt = order.get(run.actionId) ?? 0;
      const blocked = all.some(
        (o) =>
          o.id !== run.id &&
          o.submissionId === run.submissionId &&
          o.outcome === run.outcome &&
          (o.status === 'queued' || o.status === 'running') &&
          (order.get(o.actionId) ?? 0) < mineAt,
      );
      if (!blocked) ready.push(run.id);
    }
    return ready;
  }

  /** After a run ends (done, failed for good or skipped): start the next one of its request and outcome. */
  private async next(run: RunRow) {
    const waiting = await this.db
      .select({ id: processActionRuns.id })
      .from(processActionRuns)
      .where(
        and(
          eq(processActionRuns.submissionId, run.submissionId),
          eq(processActionRuns.outcome, run.outcome),
          eq(processActionRuns.status, 'queued'),
        ),
      );
    await this.enqueue(waiting.map((w) => w.id));
  }

  /** Hands queued runs whose turn it is to the worker (the outbox handler of `core.process-action.queued`, retries, the next run, the sweep). */
  async enqueue(runIds: readonly string[]) {
    const due = await this.inTurn(runIds);
    if (!due.length) return;
    const rows = await this.db
      .select({ id: processActionRuns.id, next: processActionRuns.nextAttemptAt })
      .from(processActionRuns)
      .where(and(inArray(processActionRuns.id, due), eq(processActionRuns.status, 'queued')));
    const order = new Map(runIds.map((id, i) => [id, i]));
    rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    const queue = this.deps.queues.get(PROCESS_ACTIONS_QUEUE);
    // The claim in `execute` makes a duplicate job harmless, so ids only need to be unique.
    await queue.addBulk(
      rows.map((r) => ({
        name: 'run',
        data: { runId: r.id },
        opts: {
          jobId: `pa-${r.id}-${uuidv7()}`,
          attempts: 1,
          delay: r.next ? Math.max(0, r.next.getTime() - Date.now()) : 0,
          removeOnComplete: { age: 86_400, count: 5_000 },
          removeOnFail: { age: 7 * 86_400 },
        },
      })),
    );
  }

  private async finish(
    run: RunRow,
    patch: Partial<typeof processActionRuns.$inferInsert>,
    fn?: (tx: Db) => Promise<void>,
  ) {
    await this.db.transaction(async (raw) => {
      const tx = raw as unknown as Db;
      await tx
        .update(processActionRuns)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(processActionRuns.id, run.id));
      await fn?.(tx);
    });
  }

  /**
   * Runs one queued run (the worker's job). The run is claimed atomically, so a job delivered twice does nothing
   * the second time; a run whose next attempt is not due yet is left alone.
   */
  async execute(runId: string): Promise<{ status: string }> {
    // Not its turn (an earlier action of the request is still queued or running): it is started after that one.
    const [queued] = await this.db
      .select({ id: processActionRuns.id })
      .from(processActionRuns)
      .where(and(eq(processActionRuns.id, runId), eq(processActionRuns.status, 'queued')));
    if (queued && !(await this.inTurn([runId])).length) return { status: 'waiting' };
    const now = new Date();
    const [run] = await this.db
      .update(processActionRuns)
      .set({
        status: 'running',
        attempts: sql`${processActionRuns.attempts} + 1`,
        startedAt: now,
        nextAttemptAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(processActionRuns.id, runId),
          eq(processActionRuns.status, 'queued'),
          or(
            isNull(processActionRuns.nextAttemptAt),
            lte(processActionRuns.nextAttemptAt, new Date(now.getTime() + 1_000)),
          ),
        ),
      )
      .returning();
    if (!run) return { status: 'ignored' };

    const loaded = await this.load(run);
    if (!loaded) {
      await this.finish(run, {
        status: 'skipped',
        finishedAt: new Date(),
        errorCode: ErrorCodes.NOT_FOUND,
        error: 'The request, its form version or this action no longer exists',
      });
      await this.next(run);
      return { status: 'skipped' };
    }
    const e = this.entries.get(run.type);
    if (!e || !this.deps.registry.isEnabled(e.moduleId)) {
      await this.finish(run, {
        status: 'skipped',
        finishedAt: new Date(),
        errorCode: e ? ErrorCodes.MODULE_DISABLED : ErrorCodes.PROCESS_ACTION_UNAVAILABLE,
        error: e ? `Module ${e.moduleId} is disabled` : `Unknown action type ${run.type}`,
      });
      await this.next(run);
      return { status: 'skipped' };
    }

    let status: string;
    try {
      const result = await this.invoke(e, run, loaded);
      await this.succeed(run, loaded, result);
      status = 'succeeded';
    } catch (err) {
      status = await this.fail(run, loaded, e, err);
    }
    if (status !== 'retrying') await this.next(run);
    return { status };
  }

  private async load(run: RunRow) {
    const [sub] = await this.db
      .select()
      .from(formSubmissions)
      .where(eq(formSubmissions.id, run.submissionId));
    if (!sub) return null;
    const [[form], [version]] = await Promise.all([
      this.db.select().from(forms).where(eq(forms.id, sub.formId)),
      this.db
        .select({ schema: formVersions.schema, publishedBy: formVersions.publishedBy })
        .from(formVersions)
        .where(and(eq(formVersions.formId, sub.formId), eq(formVersions.version, run.formVersion))),
    ]);
    const action = version?.schema.actions?.find((a) => a.id === run.actionId);
    if (!form || !version || !action) return null;
    return { sub, form, schema: version.schema, publishedBy: version.publishedBy, action };
  }

  /** The request as handlers see it, and the context templates are rendered with. */
  private async request(run: RunRow, sub: SubmissionRow, form: FormRow, schema: FormSchema) {
    const ids = [sub.submittedBy, run.decidedBy].filter((x): x is string => Boolean(x));
    const fields = formFields(schema);
    // People picked in fields, table cells included.
    const flat = expandRowFields(fields, sub.data);
    const userIds = flat.fields
      .filter((f) => f.type === 'user')
      .flatMap(
        (f) => (Array.isArray(flat.values[f.key]) ? flat.values[f.key] : [flat.values[f.key]]) as unknown[],
      )
      .filter((v): v is string => typeof v === 'string');
    const people = new Map(
      (
        await this.db
          .select({
            id: users.id,
            displayName: users.displayName,
            email: users.email,
            username: users.username,
            departmentId: users.departmentId,
          })
          .from(users)
          .where(inArray(users.id, [...new Set([...ids, ...userIds])].concat(uuidv7())))
      ).map((u) => [u.id, u]),
    );
    const reference = formatRequestNumber(sub.number);
    const href = `/requests/${reference}`;
    const records = await recordFieldFacts(fields, sub.data, (refs) => this.deps.records.facts(refs));
    // What approvers filled in with their decisions (`steps.<stepId>.<key>`).
    const steps = await instanceStepValues(this.db, sub.workflowInstanceId);
    const requester = sub.submittedBy ? people.get(sub.submittedBy) : undefined;
    const decider = run.decidedBy ? people.get(run.decidedBy) : undefined;
    const request: ProcessActionRequest = {
      id: sub.id,
      reference,
      href,
      form: { key: form.key, name: form.name },
      outcome: run.outcome,
      data: sub.data,
      records,
      steps,
      requester: requester
        ? {
            id: requester.id,
            displayName: requester.displayName,
            email: requester.email,
            departmentId: requester.departmentId,
          }
        : null,
      decidedBy: decider ? { id: decider.id, displayName: decider.displayName } : null,
    };
    // Display text of the answers (English option labels, people's names, Yes/No); a table is one line per row,
    // "Column: value · Column: value".
    const shown = (f: FieldDef, v: unknown): string => {
      if (v === undefined || v === null || v === '') return '';
      if (f.type === 'rows')
        return (Array.isArray(v) ? v : [])
          .map((row) =>
            rowColumns(f)
              .map((c) => {
                const text = shown(c, (row as Record<string, unknown>)[c.key]);
                return text ? `${localize(c.label, 'en') || c.key}: ${text}` : '';
              })
              .filter(Boolean)
              .join(' · '),
          )
          .filter(Boolean)
          .join('\n');
      const list = Array.isArray(v) ? v : [v];
      const label = (x: unknown) => localize(f.options?.find((o) => o.value === x)?.label, 'en') || String(x);
      return f.type === 'select' || f.type === 'multiselect'
        ? list.map(label).join(', ')
        : f.type === 'user'
          ? list.map((x) => people.get(String(x))?.displayName ?? String(x)).join(', ')
          : f.type === 'boolean'
            ? YES_NO[String(Boolean(v)) as 'true' | 'false']
            : list.map(String).join(', ');
    };
    const answers: Record<string, string> = {};
    for (const f of fields) {
      const text = shown(f, sub.data[f.key]);
      if (text) answers[f.key] = text;
    }
    const context = {
      data: sub.data,
      answers,
      records,
      steps,
      requester: requester
        ? {
            id: requester.id,
            displayName: requester.displayName,
            email: requester.email,
            username: requester.username,
          }
        : {},
      request: {
        reference,
        href,
        url: `${this.deps.publicUrl.replace(/\/$/, '')}${href}`,
        form: localize(form.name, 'en'),
        formKey: form.key,
        outcome: run.outcome,
        submittedAt: sub.createdAt.toISOString(),
      },
      decidedBy: decider ? { id: decider.id, displayName: decider.displayName } : {},
    };
    return { request, context };
  }

  /** A system principal named after the form, holding only the providing module's own permissions (decision 71). */
  authFor(moduleId: string, formKey: string): AuthContext {
    const principal: Principal = { type: 'system', id: null, name: `form:${formKey}` };
    return buildAuthContext(principal, null, null, new PermissionSet([{ p: `${moduleId}.*`, s: 'g' }]));
  }

  private async invoke(
    e: Entry,
    run: RunRow,
    { sub, form, schema, action }: NonNullable<Awaited<ReturnType<ProcessActionRegistry['load']>>>,
  ): Promise<ProcessActionResult> {
    const ctx = this.deps.registry.context(e.moduleId);
    const secrets = new Set(e.handler.secrets ?? []);
    // The configuration must still fit the action's fields (a category or role may have gone since).
    const fields = await e.handler.fields(ctx, { form: schema, locale: 'en' });
    const plain = Object.fromEntries(Object.entries(action.config).filter(([k]) => !secrets.has(k)));
    const present = [...secrets].filter((k) => isSealed(action.config[k]));
    const checked = validateFields(fields, { ...plain, ...Object.fromEntries(present.map((k) => [k, 'x'])) });
    if (!checked.ok)
      throw new HttpError(
        400,
        ErrorCodes.VALIDATION_FAILED,
        'The action’s configuration is no longer valid',
        {
          issues: Object.entries(checked.errors).map(([k, err]) => this.issue(k, err)),
        },
      );
    const { request, context } = await this.request(run, sub, form, schema);
    const values = Object.fromEntries(Object.entries(checked.values).filter(([k]) => !secrets.has(k)));
    // Templates fill text only: URLs, choices, people and numbers are used exactly as configured.
    const text = new Set(fields.filter((f) => f.type === 'text' || f.type === 'textarea').map((f) => f.key));
    const json = (e.handler.jsonTemplates ?? []).filter((k) => text.has(k));
    const fixed = Object.keys(values).filter((k) => !text.has(k) || json.includes(k));
    const config: Record<string, unknown> = {
      ...renderTemplates(values, context, { skip: fixed }),
      ...Object.fromEntries(
        json
          .filter((k) => typeof values[k] === 'string')
          .map((k) => [k, renderTemplate(values[k] as string, context, { escape: jsonEscape })]),
      ),
      ...Object.fromEntries(
        present.map((k) => [k, this.deps.box.decrypt((action.config[k] as SealedValue).sealed)]),
      ),
    };
    const auth = this.authFor(e.moduleId, form.key);
    return runWithContext(
      {
        principal: auth.principal,
        requestId: run.id,
        auditMetadata: {
          processAction: {
            runId: run.id,
            action: action.id,
            type: run.type,
            form: form.key,
            request: request.reference,
            requester: request.requester
              ? { id: request.requester.id, name: request.requester.displayName }
              : null,
            decidedBy: request.decidedBy
              ? { id: request.decidedBy.id, name: request.decidedBy.displayName }
              : null,
          },
        },
      },
      () =>
        withTimeout(
          e.handler.run({ config, request, runId: run.id, attempt: run.attempts, auth }, ctx),
          RUN_TIMEOUT_MS,
        ),
    );
  }

  private async succeed(
    run: RunRow,
    { sub, form }: { sub: SubmissionRow; form: FormRow },
    result: ProcessActionResult,
  ) {
    const clean: ProcessActionRunResult = {
      reference: result.reference?.slice(0, 200) ?? null,
      href: result.href && /^\/(?!\/)/.test(result.href) ? result.href.slice(0, 500) : null,
      summary: result.summary?.slice(0, 500) ?? null,
      summaryParams: cleanParams(result.summaryParams),
      record: result.record ?? null,
    };
    const reference = formatRequestNumber(sub.number);
    const core = this.deps.core();
    await this.finish(
      run,
      { status: 'succeeded', result: clean, error: null, errorCode: null, finishedAt: new Date() },
      async (tx) => {
        // The first action with a link fulfils the request in "My requests", unless a module already does.
        if (clean.href)
          await tx
            .update(formSubmissions)
            .set({
              fulfilment: {
                moduleId: 'core',
                reference: clean.reference ?? reference,
                href: clean.href,
                state: 'done',
                statusKey: 'requests.detail.actions.fulfilled',
                tone: 'success',
                updatedAt: new Date().toISOString(),
              },
            })
            .where(and(eq(formSubmissions.id, sub.id), isNull(formSubmissions.fulfilment)));
        // What the action created is linked to the request (`core.request`), so both pages show it.
        if (clean.record && this.deps.records.entry(clean.record.type))
          await this.deps.records.link({ type: 'core.request', id: sub.id }, clean.record, { tx });
        await core.audit.record(
          {
            action: 'core.process-action.succeeded',
            category: 'system',
            entityType: 'form_submission',
            entityId: sub.id,
            entityLabel: `${reference} ${form.key}`,
            metadata: {
              runId: run.id,
              action: run.actionId,
              type: run.type,
              attempts: run.attempts,
              ...clean,
            },
          },
          { tx },
        );
        await core.events.publish(
          'core.process-action.succeeded',
          { runId: run.id, submissionId: sub.id, type: run.type, actionId: run.actionId },
          { tx },
        );
      },
    );
  }

  /** Records a failed attempt: queued again with backoff, or failed for good (notifying the form's editors). */
  private async fail(
    run: RunRow,
    { sub, form, publishedBy, action }: NonNullable<Awaited<ReturnType<ProcessActionRegistry['load']>>>,
    e: Entry,
    err: unknown,
  ): Promise<string> {
    const permanent = err instanceof HttpError;
    const code = err instanceof HttpError ? String(err.code) : 'INTERNAL';
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 2_000);
    if (!permanent && run.attempts < PROCESS_ACTION_ATTEMPTS) {
      const next = new Date(Date.now() + this.retryDelayMs * 2 ** (run.attempts - 1));
      await this.finish(run, { status: 'queued', nextAttemptAt: next, error: message, errorCode: code });
      await this.enqueue([run.id]);
      this.deps.logger.warn(
        { err, runId: run.id, type: run.type, attempt: run.attempts },
        'process action failed',
      );
      return 'retrying';
    }
    this.deps.logger.error({ err, runId: run.id, type: run.type }, 'process action failed for good');
    const reference = formatRequestNumber(sub.number);
    const core = this.deps.core();
    const editors = await this.editorsOf(form, publishedBy);
    await this.finish(
      run,
      { status: 'failed', error: message, errorCode: code, finishedAt: new Date() },
      async (tx) => {
        await core.audit.record(
          {
            action: 'core.process-action.failed',
            category: 'system',
            outcome: 'failure',
            entityType: 'form_submission',
            entityId: sub.id,
            entityLabel: `${reference} ${form.key}`,
            metadata: { runId: run.id, action: run.actionId, type: run.type, attempts: run.attempts, code },
          },
          { tx },
        );
        await core.events.publish(
          'core.process-action.failed',
          { runId: run.id, submissionId: sub.id, type: run.type, actionId: run.actionId, code },
          { tx },
        );
        await core.notifications.notify(
          {
            type: 'core.process-action.failed',
            recipients: editors,
            params: { reference, form: form.name, action: action.name ?? e.def.name },
            href: `/requests/${reference}`,
          },
          { tx },
        );
      },
    );
    return 'failed';
  }

  /** Who maintains a form: its author, last editor and the publisher of the version, else the platform admins. */
  private async editorsOf(form: FormRow, publishedBy: string | null): Promise<string[]> {
    const ids = [form.createdBy, form.updatedBy, publishedBy].filter((x): x is string => Boolean(x));
    if (ids.length) return [...new Set(ids)];
    const admins = await this.db
      .select({ id: roleAssignments.userId })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .where(and(eq(roles.key, 'platform-admin'), isNotNull(roleAssignments.userId)));
    return [...new Set(admins.map((a) => a.id!))];
  }

  /**
   * Queues a failed or skipped run again (an administrator's retry), with a fresh set of attempts. Throws 404 for
   * an unknown run and 409 `INVALID_STATE` for one that is queued, running or done.
   */
  async retry(submissionId: string, runId: string, opts: { tx?: Db } = {}) {
    const db = opts.tx ?? this.db;
    const [run] = await db
      .select()
      .from(processActionRuns)
      .where(and(eq(processActionRuns.id, runId), eq(processActionRuns.submissionId, submissionId)));
    if (!run) throw new HttpError(404, ErrorCodes.NOT_FOUND, 'Action run not found');
    if (run.status !== 'failed' && run.status !== 'skipped')
      throw new HttpError(409, ErrorCodes.INVALID_STATE, 'Only failed or skipped actions can be retried', {
        status: run.status,
      });
    // The form said not to run it for this request: a retry would bypass the condition.
    if (run.errorCode === SKIPPED_BY_CONDITION)
      throw new HttpError(409, ErrorCodes.INVALID_STATE, 'This action was skipped by its condition', {
        status: run.status,
        reason: 'condition',
      });
    const [updated] = await db
      .update(processActionRuns)
      .set({ status: 'queued', attempts: 0, nextAttemptAt: null, finishedAt: null, updatedAt: new Date() })
      .where(and(eq(processActionRuns.id, runId), inArray(processActionRuns.status, ['failed', 'skipped'])))
      .returning();
    if (!updated) throw new HttpError(409, ErrorCodes.INVALID_STATE, 'The action changed meanwhile');
    await this.deps
      .core()
      .events.publish(PROCESS_ACTION_QUEUED_EVENT, { submissionId, runIds: [runId] }, opts);
    return updated;
  }

  /**
   * Finds runs whose job was lost (a queued run long past its time, or a run stuck `running` after its worker died)
   * and hands them to the worker again. A stuck run that used up its attempts fails.
   */
  async sweep(now = new Date()): Promise<{ requeued: number; failed: number }> {
    const lost = await this.db
      .select({ id: processActionRuns.id })
      .from(processActionRuns)
      .where(
        and(
          eq(processActionRuns.status, 'queued'),
          or(
            lt(processActionRuns.nextAttemptAt, new Date(now.getTime() - 2 * 60_000)),
            and(
              isNull(processActionRuns.nextAttemptAt),
              lt(processActionRuns.updatedAt, new Date(now.getTime() - 2 * 60_000)),
            ),
          ),
        ),
      )
      .orderBy(asc(processActionRuns.createdAt))
      .limit(500);
    const stuck = await this.db
      .update(processActionRuns)
      .set({
        status: sql`case when ${processActionRuns.attempts} >= ${PROCESS_ACTION_ATTEMPTS} then 'failed' else 'queued' end`,
        error: 'The worker stopped while the action was running',
        errorCode: 'INTERNAL',
        finishedAt: sql`case when ${processActionRuns.attempts} >= ${PROCESS_ACTION_ATTEMPTS} then now() else null end`,
        updatedAt: now,
      })
      .where(
        and(
          eq(processActionRuns.status, 'running'),
          lt(processActionRuns.startedAt, new Date(now.getTime() - STALE_RUNNING_MS)),
        ),
      )
      .returning({ id: processActionRuns.id, status: processActionRuns.status });
    const again = [...lost.map((r) => r.id), ...stuck.filter((r) => r.status === 'queued').map((r) => r.id)];
    await this.enqueue(again);
    return { requeued: again.length, failed: stuck.filter((r) => r.status === 'failed').length };
  }

  /** The runs of a submission for its page; errors only for administrators (`withErrors`). */
  async runsOf(submissionId: string, schema: FormSchema, opts: { withErrors: boolean; canRetry: boolean }) {
    const rows = await this.db
      .select()
      .from(processActionRuns)
      .where(eq(processActionRuns.submissionId, submissionId))
      .orderBy(asc(processActionRuns.createdAt));
    const order = new Map((schema.actions ?? []).map((a, i) => [a.id, i]));
    rows.sort(
      (a, b) =>
        a.createdAt.getTime() - b.createdAt.getTime() ||
        (order.get(a.actionId) ?? 99) - (order.get(b.actionId) ?? 99),
    );
    return rows.map((r) => {
      const action = schema.actions?.find((a) => a.id === r.actionId);
      const e = this.entries.get(r.type);
      return {
        id: r.id,
        actionId: r.actionId,
        type: r.type,
        name: (action?.name ?? null) as LocalizedText | null,
        typeName: e?.def.name ?? null,
        icon: e?.def.icon ?? null,
        on: r.outcome,
        status: r.status,
        attempts: r.attempts,
        result:
          r.status === 'succeeded' && r.result ? { ...r.result, record: r.result.record ?? null } : null,
        // Why a run was skipped, for everyone: its condition didn't hold, or the action is gone (module disabled…).
        reason:
          r.status !== 'skipped'
            ? null
            : r.errorCode === SKIPPED_BY_CONDITION
              ? ('condition' as const)
              : ('unavailable' as const),
        error:
          opts.withErrors && r.error && r.errorCode !== SKIPPED_BY_CONDITION
            ? { code: r.errorCode, message: r.error }
            : null,
        canRetry:
          opts.canRetry &&
          (r.status === 'failed' || r.status === 'skipped') &&
          r.errorCode !== SKIPPED_BY_CONDITION,
        nextAttemptAt: r.nextAttemptAt,
        createdAt: r.createdAt,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
      };
    });
  }
}
