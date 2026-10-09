import type { AuthContext, ServerModule, WorkKind, WorkResult, WorkSourceDef } from '@isbp/sdk/server';
import type { FastifyBaseLogger } from 'fastify';
import type { ModuleRegistry } from './modules';

/** A provider that takes longer than this is reported as failed (the page still shows everything else). */
const TIMEOUT_MS = 2_000;

/** My work order: decisions first, then things to do, records to check, and assigned tasks. */
const KIND_ORDER: Record<WorkKind, number> = { approval: 0, todo: 1, review: 2, task: 3 };

export interface WorkSectionResult {
  source: string;
  moduleId: string;
  kind: WorkKind;
  label: string;
  icon: string | null;
  href: string | null;
  count: number;
  items: {
    id: string;
    title: string;
    subtitle: string | null;
    detail: { key: string; params: Record<string, string | number> } | null;
    href: string;
    due: Date | null;
    since: Date | null;
    overdue: boolean;
  }[];
  error: boolean;
}

const asDate = (v: Date | string | null | undefined): Date | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v.length === 10 ? `${v}T23:59:59Z` : v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Everything waiting for one person, from every enabled module's `manifest.work` sources (the core's approvals and
 * assigned forms included). Each provider answers for the caller's `auth` only, in parallel, capped at 2 s; a failure
 * is reported per section so the UI can say "couldn't load" instead of "nothing to do".
 */
export class WorkRegistry {
  constructor(
    private readonly registry: ModuleRegistry,
    private readonly logger: FastifyBaseLogger,
  ) {}

  private sources(auth: AuthContext): { module: ServerModule; def: WorkSourceDef }[] {
    return this.registry
      .enabledModules()
      .flatMap((m) => (m.manifest.work ?? []).map((def) => ({ module: m, def })))
      .filter(
        ({ module, def }) =>
          module.work?.[def.key] && (!def.permission || auth.permissions.hasAny(def.permission)),
      );
  }

  async collect(auth: AuthContext, opts: { limit: number; locale?: string }): Promise<WorkSectionResult[]> {
    if (!auth.user) return [];
    const locale = opts.locale ?? auth.user.locale ?? 'en';
    const now = Date.now();
    const sections = await Promise.all(
      this.sources(auth).map(async ({ module, def }) => {
        const id = module.manifest.id;
        const base = {
          source: `${id}.${def.key}`,
          moduleId: id,
          kind: def.kind,
          label: def.label,
          icon: def.icon ?? null,
          href: def.href ?? null,
        };
        try {
          let timer: NodeJS.Timeout | undefined;
          const result = await Promise.race([
            module.work![def.key]!(auth, this.registry.context(id), { limit: opts.limit, locale }),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error('work provider timed out')), TIMEOUT_MS);
            }),
          ]).finally(() => clearTimeout(timer));
          return { ...base, ...this.normalise(result, opts.limit, now), error: false };
        } catch (err) {
          this.logger.warn({ err, source: base.source }, 'work provider failed');
          return { ...base, count: 0, items: [], error: true };
        }
      }),
    );
    return sections
      .filter((s) => s.count > 0 || s.error)
      .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  }

  private normalise(result: WorkResult, limit: number, now: number) {
    const items = (limit > 0 ? result.items.slice(0, limit) : []).map((i) => {
      const due = asDate(i.due);
      return {
        id: i.id,
        title: i.title,
        subtitle: i.subtitle ?? null,
        detail: i.detail ? { key: i.detail.key, params: i.detail.params ?? {} } : null,
        href: i.href,
        due,
        since: asDate(i.since),
        overdue: Boolean(due && due.getTime() < now),
      };
    });
    return { count: Math.max(result.count, items.length), items };
  }

  /** The badge (everything except tasks) and the per-kind counts. */
  async counts(auth: AuthContext) {
    const sections = await this.collect(auth, { limit: 0 });
    const byKind: Record<WorkKind, number> = { approval: 0, todo: 0, review: 0, task: 0 };
    for (const s of sections) byKind[s.kind] += s.count;
    return { total: byKind.approval + byKind.todo + byKind.review, tasks: byKind.task, byKind };
  }
}
