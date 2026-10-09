import {
  type Db,
  ErrorCodes,
  HttpError,
  type Reference,
  type ReferenceTarget,
  recordModule,
} from '@isbp/sdk/server';
import type { ModuleRegistry } from './modules';

/** At most this many references are listed with an `IN_USE` refusal (`more` says whether there are others). */
const LIMIT = 10;

export interface FoundReferences {
  items: (Reference & { module: string })[];
  more: boolean;
}

/**
 * Who still uses a record or a group, asked of every enabled module's `references` finders before it is deleted.
 * Deletes are refused while open work (a request in approval or with actions to run, an approval in progress, an
 * open to-do) or live settings name it: they would fail later, after the person who deleted it has moved on.
 */
export class ReferenceRegistry {
  constructor(private readonly registry: ModuleRegistry) {}

  async find(target: ReferenceTarget, opts: { tx: Db; limit?: number }): Promise<FoundReferences> {
    const limit = opts.limit ?? LIMIT;
    const isRecord = this.isRecordType(target.type);
    const items: FoundReferences['items'] = [];
    // One after another: the finders share the deleting transaction's connection.
    for (const module of this.registry.enabledModules()) {
      const finder = module.references?.[target.type] ?? (isRecord ? module.references?.['*'] : undefined);
      if (!finder) continue;
      const found = await finder(target, this.registry.context(module.manifest.id), {
        tx: opts.tx,
        limit: limit + 1 - items.length,
      });
      items.push(...found.map((r) => ({ ...r, module: module.manifest.id })));
      if (items.length > limit) break;
    }
    return { items: items.slice(0, limit), more: items.length > limit };
  }

  /** Refuses with `IN_USE` (details `{ references, more }`) while anything still uses `target`. */
  async assertUnused(target: ReferenceTarget, opts: { tx: Db; what?: string }): Promise<void> {
    const { items, more } = await this.find(target, opts);
    if (!items.length) return;
    throw new HttpError(
      409,
      ErrorCodes.IN_USE,
      `${opts.what ?? 'It'} is still used by open requests, approvals or settings: resolve those first`,
      { references: items, more },
    );
  }

  private isRecordType(type: string) {
    const moduleId = recordModule(type);
    const local = type.slice(moduleId.length + 1);
    return !!this.registry.get(moduleId)?.manifest.records?.types.some((t) => t.type === local);
  }
}
