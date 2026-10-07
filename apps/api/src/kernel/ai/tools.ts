import {
  type AiToolDef,
  type AiToolInfo,
  type AuthContext,
  ErrorCodes,
  HttpError,
  httpErrors,
  type Principal,
  type ServerModule,
} from '@isbp/sdk/server';
import { createAuditService } from '../audit';
import { currentContext, runWithContext } from '../context';
import type { ModuleRegistry } from '../modules';

/** Provider tool names allow `[a-zA-Z0-9_-]` only: `itsm.create_ticket` ⇄ `itsm__create_ticket`. */
export const wireName = (name: string) => name.replace('.', '__');

interface UsageLogger {
  (row: {
    moduleId: string;
    feature: string;
    kind: 'tool';
    principal: Principal;
    provider: string;
    model: null;
    latencyMs: number;
    status: 'ok' | 'error' | 'blocked';
    error?: string | null;
  }): Promise<void>;
}

/**
 * Every enabled module's `manifest.ai.tools` with their handlers — the governed surface AI features (and
 * the Phase 5 MCP server) use to act on the platform. Same permission checks and audit as the UI.
 */
export class ToolRegistry {
  constructor(
    private readonly registry: ModuleRegistry,
    private readonly logUsage: UsageLogger,
  ) {}

  find(name: string): { module: ServerModule; def: AiToolDef } | null {
    const moduleId = name.split('.')[0]!;
    const module = this.registry.get(moduleId);
    const def = module?.manifest.ai?.tools?.find((t) => t.name === name);
    return module && def ? { module, def } : null;
  }

  fromWire(name: string): string {
    return name.includes('.') ? name : name.replace('__', '.');
  }

  list(auth: AuthContext): AiToolInfo[] {
    return this.registry.enabledModules().flatMap((m) =>
      (m.manifest.ai?.tools ?? [])
        .filter((t) => auth.permissions.hasAny(t.permission))
        .map((t) => ({
          name: t.name,
          description: t.description,
          moduleId: m.manifest.id,
          permission: t.permission,
          destructive: t.destructive ?? false,
        })),
    );
  }

  /**
   * Runs a tool as `auth`. When a module invokes a tool for a signed-in user, the audit trail shows the
   * calling module's AI acting on the user's behalf; agent identities act as themselves.
   */
  async invoke<T>(
    callerModuleId: string,
    name: string,
    input: unknown,
    opts: { auth: AuthContext; confirmed?: boolean },
  ): Promise<T> {
    const found = this.find(name);
    if (!found || !this.registry.isEnabled(found.module.manifest.id))
      throw httpErrors.notFound(`AI tool "${name}" is not available`);
    const { module, def } = found;
    const handler = module.ai?.[name];
    if (!handler) throw httpErrors.notFound(`AI tool "${name}" has no handler`);

    const caller = this.registry.get(callerModuleId)?.manifest;
    const user = opts.auth.user;
    const principal: Principal =
      opts.auth.principal.type === 'user' && user
        ? {
            type: 'ai_agent',
            id: null,
            name: caller?.ai?.agent?.name ?? callerModuleId,
            onBehalfOf: { id: user.id, name: user.displayName },
          }
        : opts.auth.principal;
    const audit = createAuditService(this.registry.context('core').db, 'core');
    const started = Date.now();
    const base = currentContext();

    const record = (outcome: 'success' | 'failure' | 'denied', error?: string) =>
      audit.record(
        {
          action: 'core.ai.tool_invoked',
          category: 'security',
          entityType: 'ai_tool',
          entityId: name,
          entityLabel: name,
          outcome,
          metadata: {
            caller: callerModuleId,
            destructive: def.destructive ?? false,
            confirmed: !!opts.confirmed,
            error,
          },
        },
        { principal },
      );

    if (!opts.auth.permissions.hasAny(def.permission)) {
      await record('denied');
      await this.logUsage({
        moduleId: callerModuleId,
        feature: name,
        kind: 'tool',
        principal,
        provider: 'tools',
        model: null,
        latencyMs: 0,
        status: 'blocked',
        error: 'forbidden',
      });
      throw httpErrors.forbidden();
    }
    const parsed = def.input.safeParse(input);
    if (!parsed.success)
      throw new HttpError(400, ErrorCodes.VALIDATION_FAILED, `Invalid input for ${name}`, {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    if (def.destructive && !opts.confirmed)
      throw new HttpError(409, ErrorCodes.CONFIRMATION_REQUIRED, `${name} needs confirmation`, {
        tool: name,
        input: parsed.data,
      });

    try {
      const result = await runWithContext({ ...base, principal }, () =>
        handler(parsed.data, this.registry.context(module.manifest.id), opts.auth),
      );
      await record('success');
      await this.logUsage({
        moduleId: callerModuleId,
        feature: name,
        kind: 'tool',
        principal,
        provider: 'tools',
        model: null,
        latencyMs: Date.now() - started,
        status: 'ok',
      });
      return result as T;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await record(
        err instanceof HttpError && err.statusCode === 403 ? 'denied' : 'failure',
        message.slice(0, 200),
      );
      await this.logUsage({
        moduleId: callerModuleId,
        feature: name,
        kind: 'tool',
        principal,
        provider: 'tools',
        model: null,
        latencyMs: Date.now() - started,
        status: 'error',
        error: message,
      });
      throw err;
    }
  }
}
