import {
  applications,
  groups,
  modules,
  permissions,
  roleAssignments,
  rolePermissions,
  roles,
} from '@isbp/db/schema';
import {
  type Db,
  ErrorCodes,
  HttpError,
  httpErrors,
  manifestSchema,
  type ModuleContext,
  type ServerModule,
  serializeManifest,
} from '@isbp/sdk/server';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import { EVERYONE_GROUP_KEY, PLATFORM_APP_KEY } from './rbac';

const CHANNEL = 'isbp:modules:changed';
export const WORKFLOW_COMPLETED_EVENT = 'core.workflow.completed';

export interface ModuleState {
  enabled: boolean;
  enabledChangedAt: Date | null;
  installedAt: Date;
}

/**
 * Installed modules (compiled in via the generated registry) and their runtime enabled flag.
 * Enabled state is read from Postgres and fanned out to every replica through Redis pub/sub.
 */
export class ModuleRegistry {
  readonly modules: readonly ServerModule[];
  private readonly byId: Map<string, ServerModule>;
  private state = new Map<string, ModuleState>();
  private contexts = new Map<string, ModuleContext>();
  private subscriber?: Redis;

  constructor(
    installed: readonly ServerModule[],
    private readonly db: Db,
    private readonly log: FastifyBaseLogger,
  ) {
    for (const m of installed) {
      const res = manifestSchema.safeParse(m.manifest);
      if (!res.success) throw new Error(`Invalid manifest for "${m.manifest.id}": ${res.error.message}`);
    }
    this.modules = topoSort(installed);
    this.byId = new Map(this.modules.map((m) => [m.manifest.id, m]));
  }

  get(id: string): ServerModule | undefined {
    return this.byId.get(id);
  }

  setContexts(contexts: Map<string, ModuleContext>) {
    this.contexts = contexts;
  }

  context(id: string): ModuleContext {
    const ctx = this.contexts.get(id);
    if (!ctx) throw new Error(`No context for module "${id}"`);
    return ctx;
  }

  isEnabled(id: string): boolean {
    const m = this.byId.get(id);
    if (!m) return false;
    if (m.manifest.system) return true;
    return this.state.get(id)?.enabled ?? true;
  }

  stateOf(id: string): ModuleState | undefined {
    return this.state.get(id);
  }

  enabledModules(): ServerModule[] {
    return this.modules.filter((m) => this.isEnabled(m.manifest.id));
  }

  /**
   * Modules (enabled or not) with a handler for the event; the worker re-checks enabled state.
   * Workflow completions also go to the module that owns the trigger (its `workflows` handler).
   */
  subscribersOf(eventName: string, payload?: unknown): ServerModule[] {
    const trigger =
      eventName === WORKFLOW_COMPLETED_EVENT
        ? (payload as { triggerKey?: string } | undefined)?.triggerKey
        : undefined;
    return this.modules.filter((m) => m.events?.[eventName] || (trigger && m.workflows?.[trigger]));
  }

  dependentsOf(id: string): string[] {
    return this.modules.filter((m) => m.manifest.dependsOn?.includes(id)).map((m) => m.manifest.id);
  }

  async loadState(): Promise<void> {
    const rows = await this.db.select().from(modules);
    this.state = new Map(
      rows.map((r) => [
        r.id,
        { enabled: r.enabled, enabledChangedAt: r.enabledChangedAt, installedAt: r.installedAt },
      ]),
    );
  }

  /** Subscribes to enable/disable broadcasts from other replicas. */
  async watch(redis: Redis): Promise<void> {
    this.subscriber = redis.duplicate();
    await this.subscriber.subscribe(CHANNEL);
    this.subscriber.on('message', () => {
      void this.loadState().catch((err) => this.log.error({ err }, 'failed to reload module state'));
    });
  }

  async close() {
    await this.subscriber?.quit().catch(() => undefined);
  }

  async setEnabled(id: string, enabled: boolean, actorId: string | null, redis: Redis): Promise<void> {
    const m = this.byId.get(id);
    if (!m) throw httpErrors.notFound(`Module "${id}" is not installed`);
    if (m.manifest.system && !enabled)
      throw new HttpError(409, ErrorCodes.SYSTEM_MODULE, 'System modules cannot be disabled');
    if (enabled) {
      const missing = (m.manifest.dependsOn ?? []).filter((dep) => !this.isEnabled(dep));
      if (missing.length) {
        throw new HttpError(
          409,
          ErrorCodes.MODULE_DEPENDENCY,
          `Enable required modules first: ${missing.join(', ')}`,
          { modules: missing },
        );
      }
    } else {
      const active = this.dependentsOf(id).filter((dep) => this.isEnabled(dep));
      if (active.length) {
        throw new HttpError(
          409,
          ErrorCodes.MODULE_DEPENDENCY,
          `Disable dependent modules first: ${active.join(', ')}`,
          { modules: active },
        );
      }
    }
    await this.db
      .update(modules)
      .set({ enabled, enabledChangedAt: new Date(), enabledChangedBy: actorId })
      .where(eq(modules.id, id));
    await this.loadState();
    await redis.publish(CHANNEL, id);
    const hook = enabled ? m.onEnable : m.onDisable;
    if (hook) await hook(this.context(id));
  }

  /**
   * Reconciles the database with installed manifests: module rows, the platform application,
   * the permission catalog and system role templates. Idempotent; runs at migrate time and boot.
   */
  async sync(): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [app] = await tx
        .insert(applications)
        .values({
          key: PLATFORM_APP_KEY,
          name: 'IS Big Platform',
          description: 'This platform',
          isSystem: true,
        })
        .onConflictDoUpdate({ target: applications.key, set: { isSystem: true } })
        .returning();

      // The implicit "Everyone" group (every active user is a member) is owned by the kernel.
      await tx
        .insert(groups)
        .values({
          key: EVERYONE_GROUP_KEY,
          name: 'Everyone',
          description: 'Every active user (implicit membership)',
          source: 'system',
          isSystem: true,
        })
        .onConflictDoNothing();
      const [everyone] = await tx
        .select({ id: groups.id })
        .from(groups)
        .where(eq(groups.key, EVERYONE_GROUP_KEY));

      const seenPermissions: string[] = [];
      for (const m of this.modules) {
        const manifest = m.manifest;
        await tx
          .insert(modules)
          .values({
            id: manifest.id,
            name: manifest.name,
            version: manifest.version,
            system: manifest.system ?? false,
            enabled: true,
            manifest: serializeManifest(manifest) as unknown as Record<string, unknown>,
          })
          .onConflictDoUpdate({
            target: modules.id,
            set: {
              name: manifest.name,
              version: manifest.version,
              system: manifest.system ?? false,
              manifest: sql`excluded.manifest`,
              updatedAt: new Date(),
            },
          });

        for (const p of manifest.permissions ?? []) {
          seenPermissions.push(p.key);
          await tx
            .insert(permissions)
            .values({
              applicationId: app!.id,
              key: p.key,
              moduleId: manifest.id,
              description: p.description,
              scopes: p.scopes ?? ['global'],
            })
            .onConflictDoUpdate({
              target: [permissions.applicationId, permissions.key],
              set: {
                description: p.description,
                scopes: p.scopes ?? ['global'],
                moduleId: manifest.id,
                deprecated: false,
              },
            });
        }

        for (const template of manifest.roles ?? []) {
          const [existing] = await tx
            .select({ id: roles.id })
            .from(roles)
            .where(and(eq(roles.applicationId, app!.id), eq(roles.key, template.key)));
          const [role] = await tx
            .insert(roles)
            .values({
              applicationId: app!.id,
              key: template.key,
              name: template.name,
              description: template.description ?? null,
              isSystem: true,
              moduleId: manifest.id,
            })
            .onConflictDoUpdate({
              target: [roles.applicationId, roles.key],
              set: {
                name: template.name,
                description: template.description ?? null,
                isSystem: true,
                moduleId: manifest.id,
              },
            })
            .returning();
          await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, role!.id));
          if (template.permissions.length) {
            await tx
              .insert(rolePermissions)
              .values(template.permissions.map((permission) => ({ roleId: role!.id, permission })));
          }
          if (!existing && template.grantByDefault && everyone) {
            await tx
              .insert(roleAssignments)
              .values({
                roleId: role!.id,
                groupId: everyone.id,
                source: 'system',
                reason: `Default access from module "${manifest.id}"`,
              })
              .onConflictDoNothing();
          }
        }
      }

      // Permissions that disappeared from every manifest stay (assignments may reference them) but are flagged.
      await tx
        .update(permissions)
        .set({ deprecated: true })
        .where(
          and(
            eq(permissions.applicationId, app!.id),
            seenPermissions.length ? notInArray(permissions.key, seenPermissions) : sql`true`,
          ),
        );
      const installedIds = this.modules.map((m) => m.manifest.id);
      const stale = await tx
        .select({ id: modules.id })
        .from(modules)
        .where(notInArray(modules.id, installedIds));
      if (stale.length) {
        this.log.warn({ modules: stale.map((s) => s.id) }, 'modules in the database are no longer installed');
        await tx
          .update(modules)
          .set({ enabled: false })
          .where(
            inArray(
              modules.id,
              stale.map((s) => s.id),
            ),
          );
      }
    });
    await this.loadState();
  }
}

/** Orders modules so every module comes after its dependencies; core is always first. */
function topoSort(installed: readonly ServerModule[]): ServerModule[] {
  const byId = new Map<string, ServerModule>();
  for (const m of installed) {
    if (byId.has(m.manifest.id)) throw new Error(`Duplicate module id "${m.manifest.id}"`);
    byId.set(m.manifest.id, m);
  }
  const out: ServerModule[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (m: ServerModule, path: string[]) => {
    const id = m.manifest.id;
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting')
      throw new Error(`Module dependency cycle: ${[...path, id].join(' → ')}`);
    state.set(id, 'visiting');
    for (const dep of m.manifest.dependsOn ?? []) {
      const d = byId.get(dep);
      if (!d) throw new Error(`Module "${id}" depends on "${dep}", which is not installed`);
      visit(d, [...path, id]);
    }
    state.set(id, 'done');
    out.push(m);
  };
  const core = byId.get('core');
  if (core) visit(core, []);
  for (const m of installed) visit(m, []);
  return out;
}
