import {
  type CustomizationHandler,
  type CustomizationIssue,
  type ModuleContext,
  type ModuleManifest,
  type SettingDef,
} from '@isbp/sdk/server';
import { z } from 'zod';
import { getKernel } from '../kernel-ref';
import { catalogText, localeOf, matchesQuery } from './shared';

const settingValue = z.union([z.string().max(20_000), z.number(), z.boolean(), z.null()]);

const schema = z.object({
  values: z
    .record(z.string().max(150), settingValue)
    .describe(
      'Setting values by key (see reference.modules[].settings); settings left out keep their current values, null clears one',
    ),
});
export type ModuleSettingsValue = z.output<typeof schema>;

/** Settings this kind may read and write: never secrets, and not the AI provider (Administration → AI). */
function editable(manifest: ModuleManifest): SettingDef[] {
  return (manifest.settings ?? []).filter(
    (s) => s.type !== 'secret' && !(manifest.id === 'core' && s.key.startsWith('ai.')),
  );
}

/** An enabled module with at least one editable setting. */
function configurable(id: string): ModuleManifest | null {
  const kernel = getKernel();
  const m = kernel.registry.get(id);
  if (!m || !kernel.registry.isEnabled(id) || !editable(m.manifest).length) return null;
  return m.manifest;
}

async function currentValues(manifest: ModuleManifest, ctx: ModuleContext) {
  const all = await getKernel().settings.publicValues(manifest, ctx.db);
  return Object.fromEntries(
    editable(manifest).map((s) => [s.key, (all[s.key] ?? null) as z.output<typeof settingValue>]),
  );
}

/** The value a setting of this type accepts (the settings service would refuse anything else). */
function typeIssue(def: SettingDef, value: unknown): string | null {
  if (value === null) return null;
  switch (def.type) {
    case 'boolean':
      return typeof value === 'boolean' ? null : 'must be true or false';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : 'must be a number';
    case 'select':
      return def.options?.some((o) => o.value === value)
        ? null
        : `must be one of ${def.options?.map((o) => `"${o.value}"`).join(', ')}`;
    default:
      return typeof value === 'string' ? null : 'must be text';
  }
}

const INSTRUCTIONS = `Each enabled module's settings (the ones on its page in Administration → Modules). Value: { "values": { "<setting key>": value } }.
Include the settings to change; settings left out keep their current values. Types: string and text take text, number a number, boolean true or false, select one of its option values; null clears a value (the module then uses its built-in behaviour).
Secret settings (passwords, API keys) and the AI provider settings (core ai.*) are not available here; an administrator sets them in Administration → Modules and Administration → AI.`;

export const moduleSettingsKind: CustomizationHandler<ModuleSettingsValue> = {
  /** `apply` clears the settings cache before the commit; clear it again once the values are committed. */
  committed: ({ id }) => getKernel().settings.invalidate(id),

  schema,

  async guide() {
    const kernel = getKernel();
    const modules = await Promise.all(
      kernel.registry
        .enabledModules()
        .filter((m) => editable(m.manifest).length)
        .map(async ({ manifest }) => ({
          id: manifest.id,
          name: await catalogText(manifest.name),
          settings: await Promise.all(
            editable(manifest).map(async (s) => ({
              key: s.key,
              type: s.type,
              label: await catalogText(s.label),
              ...(s.description ? { description: await catalogText(s.description) } : {}),
              ...(s.options ? { options: s.options } : {}),
              default: s.default ?? null,
            })),
          ),
        })),
    );
    return {
      instructions: INSTRUCTIONS,
      reference: { modules },
      examples: [
        {
          description: 'Rename the product shown in the header and emails (module core)',
          value: { values: { 'branding.productName': 'Contoso IT Portal' } },
        },
      ],
    };
  },

  async list({ q, limit }, _ctx, auth) {
    const locale = localeOf(auth);
    const items = await Promise.all(
      getKernel()
        .registry.enabledModules()
        .filter((m) => editable(m.manifest).length)
        .map(async ({ manifest }) => ({
          id: manifest.id,
          label: await catalogText(manifest.name, locale),
          description: `${editable(manifest).length} settings`,
          href: `/admin/modules?module=${encodeURIComponent(manifest.id)}`,
        })),
    );
    return items.filter((m) => matchesQuery(q, m.id, m.label)).slice(0, limit);
  },

  async get(id, ctx, auth) {
    const manifest = configurable(id);
    if (!manifest) return null;
    return {
      id,
      label: await catalogText(manifest.name, localeOf(auth)),
      description: manifest.description ? await catalogText(manifest.description, localeOf(auth)) : null,
      href: `/admin/modules?module=${encodeURIComponent(id)}`,
      value: { values: await currentValues(manifest, ctx) },
    };
  },

  async check(change) {
    if (change.op !== 'update') return [];
    const manifest = configurable(change.id!)!;
    const all = new Map((manifest.settings ?? []).map((s) => [s.key, s]));
    const allowed = new Set(editable(manifest).map((s) => s.key));
    const issues: CustomizationIssue[] = [];
    for (const [key, value] of Object.entries(change.value!.values)) {
      const path = `values.${key}`;
      if (!all.has(key))
        issues.push({ path, code: 'unknown_setting', message: `${change.id} has no setting "${key}"` });
      else if (!allowed.has(key))
        issues.push({
          path,
          code: 'not_editable',
          message: `"${key}" is a secret or AI provider setting: an administrator sets it in its own page`,
        });
      else {
        const problem = typeIssue(all.get(key)!, value);
        if (problem) issues.push({ path, code: 'invalid_type', message: `"${key}" ${problem}` });
      }
    }
    return issues;
  },

  async apply(change, ctx, auth) {
    if (change.op !== 'update') throw new Error(`core.module-settings does not support ${change.op}`);
    const manifest = configurable(change.id!)!;
    const current = await currentValues(manifest, ctx);
    const changed = Object.fromEntries(
      Object.entries(change.value!.values).filter(
        ([k, v]) => JSON.stringify(current[k]) !== JSON.stringify(v),
      ),
    );
    if (!Object.keys(changed).length) return { id: manifest.id };
    await ctx.transaction(async (tx) => {
      const changes = await getKernel().settings.update(manifest, changed, auth.user?.id ?? null, tx);
      await ctx.audit.record(
        {
          action: 'core.module.settings_updated',
          category: 'system',
          entityType: 'module',
          entityId: manifest.id,
          changes,
        },
        { tx },
      );
    });
    return { id: manifest.id };
  },
};
