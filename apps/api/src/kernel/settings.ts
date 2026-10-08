import { moduleSettings } from '@isbp/db/schema';
import type { Db, ModuleManifest, SettingDef, SettingsReader } from '@isbp/sdk/server';
import { httpErrors } from '@isbp/sdk/server';
import { eq, sql } from 'drizzle-orm';
import type { SecretBox } from './crypto';

export const SECRET_MASK = '••••••••';

/** Module settings: declared in the manifest, stored as JSONB, secrets encrypted, cached briefly. */
export class SettingsService {
  private cache = new Map<string, { at: number; values: Record<string, unknown> }>();

  constructor(
    private readonly db: Db,
    private readonly box: SecretBox,
  ) {}

  /** Stored values; with `tx`, read in that transaction and never cached (it may still roll back). */
  private async load(moduleId: string, tx?: Db): Promise<Record<string, unknown>> {
    const hit = tx ? undefined : this.cache.get(moduleId);
    if (hit && Date.now() - hit.at < 15_000) return hit.values;
    const rows = await (tx ?? this.db)
      .select()
      .from(moduleSettings)
      .where(eq(moduleSettings.moduleId, moduleId));
    const values = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    if (!tx) this.cache.set(moduleId, { at: Date.now(), values });
    return values;
  }

  /** Effective values (stored or manifest default), secrets decrypted — server use only. */
  async values(manifest: ModuleManifest): Promise<Record<string, unknown>> {
    const stored = await this.load(manifest.id);
    const out: Record<string, unknown> = {};
    for (const def of manifest.settings ?? []) {
      const raw = def.key in stored ? stored[def.key] : (def.default ?? null);
      out[def.key] = def.type === 'secret' && typeof raw === 'string' && raw ? this.box.decrypt(raw) : raw;
    }
    return out;
  }

  /** Values safe to send to the admin UI (secrets masked); with `tx`, as that transaction sees them. */
  async publicValues(manifest: ModuleManifest, tx?: Db): Promise<Record<string, unknown>> {
    const stored = await this.load(manifest.id, tx);
    const out: Record<string, unknown> = {};
    for (const def of manifest.settings ?? []) {
      const raw = def.key in stored ? stored[def.key] : (def.default ?? null);
      out[def.key] = def.type === 'secret' ? (raw ? SECRET_MASK : null) : raw;
    }
    return out;
  }

  reader(manifest: ModuleManifest): SettingsReader {
    return {
      get: async <T>(key: string) => (await this.values(manifest))[key] as T,
      all: () => this.values(manifest),
    };
  }

  /** Validates and writes; returns before/after pairs for auditing (secret values never included). */
  async update(
    manifest: ModuleManifest,
    input: Record<string, unknown>,
    actorId: string | null,
    tx: Db = this.db,
  ) {
    const defs = new Map((manifest.settings ?? []).map((d) => [d.key, d]));
    const before = await this.publicValues(manifest, tx === this.db ? undefined : tx);
    const changes: Record<string, [unknown, unknown]> = {};
    for (const [key, value] of Object.entries(input)) {
      const def = defs.get(key);
      if (!def) throw httpErrors.badRequest(`Unknown setting "${key}"`);
      if (def.type === 'secret' && value === SECRET_MASK) continue;
      const stored = this.coerce(def, value);
      await tx
        .insert(moduleSettings)
        .values({ moduleId: manifest.id, key, value: stored, updatedBy: actorId })
        .onConflictDoUpdate({
          target: [moduleSettings.moduleId, moduleSettings.key],
          set: { value: sql`excluded.value`, updatedBy: actorId, updatedAt: new Date() },
        });
      changes[key] = def.type === 'secret' ? ['[redacted]', '[redacted]'] : [before[key] ?? null, stored];
    }
    this.cache.delete(manifest.id);
    return changes;
  }

  invalidate(moduleId?: string) {
    if (moduleId) this.cache.delete(moduleId);
    else this.cache.clear();
  }

  private coerce(def: SettingDef, value: unknown): unknown {
    if (value === null || value === undefined || value === '') return null;
    switch (def.type) {
      case 'boolean':
        if (typeof value !== 'boolean') throw httpErrors.badRequest(`Setting "${def.key}" must be a boolean`);
        return value;
      case 'number': {
        const n = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(n)) throw httpErrors.badRequest(`Setting "${def.key}" must be a number`);
        return n;
      }
      case 'select':
        if (!def.options?.some((o) => o.value === value)) {
          throw httpErrors.badRequest(`Setting "${def.key}" must be one of the listed options`);
        }
        return value;
      case 'secret':
        if (typeof value !== 'string') throw httpErrors.badRequest(`Setting "${def.key}" must be text`);
        return this.box.encrypt(value);
      default:
        if (typeof value !== 'string') throw httpErrors.badRequest(`Setting "${def.key}" must be text`);
        return value.slice(0, def.type === 'text' ? 20_000 : 2_000);
    }
  }
}
