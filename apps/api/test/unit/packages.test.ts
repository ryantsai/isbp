import { locales, type Messages } from '@isbp/i18n';
import { changeSetPackageSchema } from '@isbp/module-assistant/contracts';
import { packageIssues } from '@isbp/module-assistant/packages';
import type { ChangeSetPackage, ServerModule } from '@isbp/sdk/server';
import { describe, expect, it } from 'vitest';
import { moduleMessages } from '../../src/generated/module-messages';
import { installedModules } from '../../src/generated/modules';

/*
 * Every built-in package an installed module ships (`manifest.customizationPackages`) installs on a platform with
 * every module enabled, built for each of the three languages: it parses as `isbp.change-set-package`, its kinds exist
 * and support its operations, its references name earlier items, no two items name the same object, the modules it
 * requires are installed, and its name and description are in the module's three catalogs. (Whether each item passes
 * its kind's checks is an integration test of the module.)
 */

const modules = installedModules as readonly ServerModule[];
const kinds = new Map(
  modules.flatMap((m) =>
    (m.manifest.customizations ?? []).map((k) => [
      `${m.manifest.id}.${k.kind}`,
      k.operations ?? (['update'] as const),
    ]),
  ),
);
const installed = new Set(modules.map((m) => m.manifest.id));

const get = (catalog: Messages, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], catalog);

describe('built-in packages', () => {
  const declared = modules.flatMap((m) =>
    (m.manifest.customizationPackages ?? []).map((def) => ({ module: m, def })),
  );

  it('are valid packages for this platform, in every language', async () => {
    for (const { module, def } of declared) {
      const id = module.manifest.id;
      for (const locale of locales) {
        const name = `${id}/${def.key} (${locale})`;
        const content: ChangeSetPackage = await module.customizationPackages![def.key]!({ locale });
        const parsed = changeSetPackageSchema.safeParse(content);
        expect(parsed.error?.issues ?? [], `${name}: format`).toEqual([]);
        const unknownKinds = content.items.map((i) => i.kind).filter((k) => !kinds.has(k));
        expect(unknownKinds, `${name}: kinds`).toEqual([]);
        expect(
          packageIssues(content, (k) => kinds.get(k)),
          `${name}: items`,
        ).toEqual([]);
        const required = [
          ...(content.requires?.modules ?? []),
          ...content.items.map((i) => i.kind.split('.')[0]!),
        ];
        expect(
          required.filter((m) => !installed.has(m)),
          `${name}: requires.modules`,
        ).toEqual([]);
      }
      const name = `${id}/${def.key}`;
      for (const locale of locales) {
        const loader = moduleMessages[id]?.[locale];
        if (!loader) continue;
        const catalog = { [id]: (await loader()).default } as Messages;
        for (const key of [def.name, def.description])
          expect(typeof get(catalog, key), `${name}, ${locale}: ${key}`).toBe('string');
      }
    }
  });

  it('are declared with content, and content only for declared ones', () => {
    for (const m of modules) {
      const keys = (m.manifest.customizationPackages ?? []).map((p) => p.key).sort();
      expect(Object.keys(m.customizationPackages ?? {}).sort(), m.manifest.id).toEqual(keys);
    }
  });
});
