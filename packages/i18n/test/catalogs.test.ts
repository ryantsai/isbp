import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type MessageFormatElement, parse, TYPE } from '@formatjs/icu-messageformat-parser';
import { describe, expect, it } from 'vitest';
import { flattenMessages, locales, type Messages } from '../src/index';
import { namespaces } from '../src/messages';

const root = join(import.meta.dirname, '..', '..', '..');
const load = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as Messages;

/** ICU argument names used by a message (parsed, so plural branch text is never mistaken for one). */
function placeholders(message: string): string[] {
  const names = new Set<string>();
  const walk = (elements: MessageFormatElement[]) => {
    for (const el of elements) {
      if ('value' in el && el.type !== TYPE.literal) names.add(String(el.value));
      if ('options' in el) for (const option of Object.values(el.options)) walk(option.value);
      if (el.type === TYPE.tag) walk(el.children);
    }
  };
  walk(parse(message, { ignoreTag: false }));
  return [...names].sort();
}

function compare(en: Messages, other: Messages, label: string) {
  const a = flattenMessages(en);
  const b = flattenMessages(other);
  expect(Object.keys(b).sort(), `${label}: keys`).toEqual(Object.keys(a).sort());
  for (const [key, value] of Object.entries(a)) {
    expect(placeholders(b[key] ?? ''), `${label}: placeholders of "${key}"`).toEqual(placeholders(value));
  }
}

describe('core catalogs', () => {
  for (const ns of namespaces) {
    for (const locale of locales.filter((l) => l !== 'en')) {
      it(`${locale}/${ns}.json matches en (keys + ICU placeholders)`, () => {
        const dir = join(root, 'packages', 'i18n', 'messages');
        compare(
          load(join(dir, 'en', `${ns}.json`)),
          load(join(dir, locale, `${ns}.json`)),
          `${locale}/${ns}`,
        );
      });
    }
  }
});

describe('module catalogs', () => {
  const modulesDir = join(root, 'modules');
  for (const mod of readdirSync(modulesDir)) {
    for (const locale of locales.filter((l) => l !== 'en')) {
      it(`${mod}: ${locale}.json matches en.json`, () => {
        const dir = join(modulesDir, mod, 'messages');
        compare(load(join(dir, 'en.json')), load(join(dir, `${locale}.json`)), `${mod}/${locale}`);
      });
    }
  }
});

interface ManifestRole {
  key: string;
  name: string;
  description?: string;
}

/**
 * Every role a manifest declares is translated as `<module>.systemRoles.<key>.{name,description}` (the web shows
 * it through `useRoleText`), with the manifest's English text in en. The other locales follow from the key checks
 * above. Core's roles live in the core namespace (`core.json`).
 */
function expectRoleTexts(roles: readonly ManifestRole[], catalog: Messages, label: string) {
  const texts = (catalog.systemRoles ?? {}) as Record<string, { name?: string; description?: string }>;
  for (const role of roles) {
    expect(texts[role.key]?.name, `${label}: systemRoles.${role.key}.name`).toBe(role.name);
    expect(texts[role.key]?.description, `${label}: systemRoles.${role.key}.description`).toBe(
      role.description ?? '',
    );
  }
  expect(Object.keys(texts).sort(), `${label}: systemRoles without a manifest role`).toEqual(
    roles.map((r) => r.key).sort(),
  );
}

describe('role names and descriptions', () => {
  it('core: every core role has catalog text', async () => {
    const { coreManifest } = (await import(join(root, 'apps', 'api', 'src', 'core', 'manifest.ts'))) as {
      coreManifest: { roles?: ManifestRole[] };
    };
    expectRoleTexts(
      coreManifest.roles ?? [],
      load(join(root, 'packages', 'i18n', 'messages', 'en', 'core.json')),
      'core',
    );
  });

  const modulesDir = join(root, 'modules');
  for (const mod of readdirSync(modulesDir)) {
    it(`${mod}: every manifest role has catalog text`, async () => {
      const { manifest } = (await import(join(modulesDir, mod, 'src', 'manifest.ts'))) as {
        manifest: { roles?: ManifestRole[] };
      };
      expectRoleTexts(manifest.roles ?? [], load(join(modulesDir, mod, 'messages', 'en.json')), mod);
    });
  }
});
