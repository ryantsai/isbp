import {
  type AuthContext,
  type Db,
  ErrorCodes,
  type ModuleContext,
  HttpError,
  type ServerModule,
  type TaskOutcome,
  type TaskTypeDef,
  type TaskTypeHandler,
  type TaskTypeInfo,
  type TaskTypesService,
  toJsonSchema,
} from '@isbp/sdk/server';
import type { ModuleRegistry } from './modules';

interface Entry {
  type: string;
  moduleId: string;
  def: TaskTypeDef;
  handler: TaskTypeHandler;
}

/** Task types declared by modules (`manifest.taskTypes`), run by Scheduled Jobs through `ctx.taskTypes`. */
export class TaskTypeRegistry {
  private readonly entries = new Map<string, Entry>();
  private readonly schemas = new Map<string, unknown>();

  constructor(private readonly registry: ModuleRegistry) {
    for (const m of registry.modules as readonly ServerModule[]) {
      for (const def of m.manifest.taskTypes ?? []) {
        const type = `${m.manifest.id}.${def.type}`;
        this.entries.set(type, { type, moduleId: m.manifest.id, def, handler: m.taskTypes![def.type]! });
      }
    }
  }

  private entry(type: string): Entry {
    const e = this.entries.get(type);
    if (!e) throw new HttpError(404, ErrorCodes.NOT_FOUND, `Unknown task type ${type}`);
    if (!this.registry.isEnabled(e.moduleId))
      throw new HttpError(409, ErrorCodes.MODULE_DISABLED, `Module ${e.moduleId} is disabled`, {
        moduleId: e.moduleId,
      });
    return e;
  }

  private parse(e: Entry, config: unknown): unknown {
    const parsed = e.def.config.safeParse(config);
    if (!parsed.success)
      throw new HttpError(400, ErrorCodes.VALIDATION_FAILED, 'Invalid task configuration', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    return parsed.data;
  }

  /** The type's module context, reading through `db` when the caller is inside a transaction. */
  private context(e: Entry, db?: Db): ModuleContext {
    const ctx = this.registry.context(e.moduleId);
    return db ? { ...ctx, db, transaction: (fn) => db.transaction((t) => fn(t as unknown as Db)) } : ctx;
  }

  service(): TaskTypesService {
    return {
      list: (auth?: AuthContext): TaskTypeInfo[] =>
        [...this.entries.values()]
          .filter((e) => this.registry.isEnabled(e.moduleId))
          .filter((e) => !auth || reaches(auth, e.def.permission))
          .map((e) => {
            if (!this.schemas.has(e.type)) this.schemas.set(e.type, toJsonSchema(e.def.config));
            return {
              type: e.type,
              moduleId: e.moduleId,
              name: e.def.name,
              description: e.def.description ?? null,
              icon: e.def.icon ?? null,
              permission: e.def.permission,
              configSchema: this.schemas.get(e.type),
            };
          }),
      validate: async (type, config, auth, opts) => {
        const e = this.entry(type);
        if (!reaches(auth, e.def.permission))
          throw new HttpError(403, ErrorCodes.FORBIDDEN, `Creating ${type} jobs needs ${e.def.permission}`, {
            permission: e.def.permission,
          });
        const parsed = this.parse(e, config);
        await e.handler.validate?.(parsed, this.context(e, opts?.db), auth);
        return parsed;
      },
      describe: async (type, config, opts) => {
        const e = this.entries.get(type);
        if (!e) return { label: type, href: null };
        try {
          const d = await e.handler.describe?.(this.parse(e, config), this.context(e, opts?.db));
          return { label: d?.label ?? e.def.name, href: d?.href ?? null };
        } catch {
          return { label: e.def.name, href: null };
        }
      },
      run: async (type, config, task): Promise<TaskOutcome> => {
        const e = this.entry(type);
        const outcome = await e.handler.run(this.parse(e, config), task, this.registry.context(e.moduleId));
        return outcome ?? {};
      },
    };
  }
}

/** Holds the permission at any scope. */
function reaches(auth: AuthContext, permission: string): boolean {
  const r = auth.reach(permission);
  return r.global || r.departmentIds.length > 0 || r.records.length > 0;
}
