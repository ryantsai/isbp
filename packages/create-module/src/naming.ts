import { MODULE_ID_RE, RESERVED_MODULE_IDS } from '@isbp/sdk';

export interface ModuleNames {
  /** kebab-case module id — URL segment, permission/event prefix */
  id: string;
  /** Postgres schema name (id with "-" → "_") */
  schema: string;
  /** "Asset Tracker" */
  title: string;
  /** "assetTracker" */
  camel: string;
  /** "AssetTracker" */
  pascal: string;
}

export function validateModuleId(raw: string): string | null {
  if (!MODULE_ID_RE.test(raw))
    return 'Module ids are kebab-case, 3–40 characters, starting with a letter (e.g. "asset-tracker").';
  if (RESERVED_MODULE_IDS.has(raw) || raw === 'core') return `"${raw}" is reserved by the platform.`;
  return null;
}

export function namesFor(id: string): ModuleNames {
  const words = id.split('-');
  const pascal = words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join('');
  return {
    id,
    schema: id.replaceAll('-', '_'),
    title: words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' '),
    camel: pascal[0]!.toLowerCase() + pascal.slice(1),
    pascal,
  };
}

export function render(template: string, names: ModuleNames, extra: Record<string, string> = {}): string {
  const values: Record<string, string> = {
    __ID__: names.id,
    __SCHEMA__: names.schema,
    __TITLE__: names.title,
    __CAMEL__: names.camel,
    __PASCAL__: names.pascal,
    ...extra,
  };
  return template.replace(/__(ID|SCHEMA|TITLE|CAMEL|PASCAL|ICON|DESCRIPTION)__/g, (m) => values[m] ?? m);
}
