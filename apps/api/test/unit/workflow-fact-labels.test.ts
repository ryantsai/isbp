import { locales, type Messages } from '@isbp/i18n';
import { loadCoreMessages } from '@isbp/i18n/messages';
import { factsFromJsonSchema } from '@isbp/sdk';
import type { ModuleManifest, ServerModule } from '@isbp/sdk/server';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { coreManifest } from '../../src/core/manifest';
import { moduleMessages } from '../../src/generated/module-messages';
import { installedModules } from '../../src/generated/modules';

/*
 * Every workflow trigger's facts read as words in the builder's conditions and the "Test" tab, in all three
 * languages: a fact has a name (its `.meta({ label })` key, or `workflows.facts.<path with _>` in the core catalog)
 * and each of its fixed values a label (`.meta({ valueLabels })`, or `workflows.factValues.<path>.<value>`).
 * Mirrors `useFactOptions` in apps/web/src/components/workflows/use-fact-label.ts.
 */

const get = (catalog: Messages, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], catalog);

/** Facts every trigger gets from the platform (`WorkflowService.triggers`). */
const COMMON = ['requester.departmentCode', 'requester.jobTitle', 'subjectUser.departmentCode'];

const manifests: ModuleManifest[] = [
  coreManifest,
  ...(installedModules as readonly ServerModule[]).map((m) => m.manifest).filter((m) => m.id !== 'core'),
];

describe('workflow trigger facts', () => {
  for (const locale of locales)
    it(`have names and value labels (${locale})`, { timeout: 60_000 }, async () => {
      const catalog: Messages = { ...(await loadCoreMessages(locale)) };
      for (const [id, loaders] of Object.entries(moduleMessages))
        catalog[id] = (await loaders[locale]()).default;
      const missing: string[] = [];
      for (const m of manifests)
        for (const trigger of m.workflows ?? []) {
          const facts = [
            ...(trigger.facts
              ? factsFromJsonSchema(z.toJSONSchema(trigger.facts, { unrepresentable: 'any' }))
              : []),
            ...COMMON.map((path) => ({ path, label: undefined, options: undefined, valueLabels: undefined })),
          ];
          for (const f of facts) {
            const base = f.path.replaceAll('.', '_');
            const named =
              (f.label && typeof get(catalog, f.label) === 'string') ||
              typeof get(catalog, `workflows.facts.${base}`) === 'string';
            if (!named) missing.push(`${trigger.key}: ${f.path}`);
            for (const v of f.options ?? []) {
              const labelled =
                (f.valueLabels && typeof get(catalog, `${f.valueLabels}.${v}`) === 'string') ||
                typeof get(catalog, `workflows.factValues.${base}.${v}`) === 'string';
              if (!labelled) missing.push(`${trigger.key}: ${f.path} = ${v}`);
            }
          }
        }
      expect(missing, `${locale}: facts without catalog text`).toEqual([]);
    });
});
