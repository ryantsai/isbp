#!/usr/bin/env tsx
/**
 * IS Big Platform module tooling.
 *
 *   pnpm create-module <id> [--description "…"] [--icon lucide-name] [--no-install]
 *   pnpm modules:sync            regenerate installed-module registries
 *   pnpm modules:check           fail if registries are out of date (CI)
 *   pnpm docs:reference          regenerate docs/ai/reference.md from the manifests
 *   pnpm docs:check              fail if docs/ai/reference.md is out of date (CI)
 */
import { execSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { namesFor, render, validateModuleId } from './naming';
import { renderReference } from './reference';
import { discoverModules, syncAppDependencies, syncRegistries } from './registry';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const templateDir = resolve(here, '../templates/module');

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    description: { type: 'string' },
    icon: { type: 'string', default: 'box' },
    'no-install': { type: 'boolean', default: false },
    check: { type: 'boolean', default: false },
  },
});

const [command, arg] = positionals;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function run(cmd: string, cwd = root) {
  console.warn(`  $ ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

function create(id: string | undefined) {
  if (!id) throw new Error('Usage: pnpm create-module <module-id>');
  const problem = validateModuleId(id);
  if (problem) throw new Error(problem);
  const target = join(root, 'modules', id);
  if (existsSync(target)) throw new Error(`modules/${id} already exists`);

  const names = namesFor(id);
  const extra = {
    __ICON__: values.icon ?? 'box',
    __DESCRIPTION__: values.description ?? `${names.title} module`,
  };
  mkdirSync(target, { recursive: true });
  cpSync(templateDir, target, { recursive: true });
  for (const file of walk(target)) {
    const content = readFileSync(file, 'utf8');
    writeFileSync(file, render(content, names, extra));
    if (file.endsWith('.tpl')) renameSync(file, file.slice(0, -4));
  }
  console.warn(`\n✓ Scaffolded modules/${id}`);

  // Order matters when a dev server is running: dependencies and migrations first, registries last, so the
  // registry change (which restarts the API) finds a complete module.
  syncAppDependencies(root, discoverModules(root), true);
  if (!values['no-install']) {
    run('pnpm install');
    run('pnpm exec drizzle-kit generate --name=init', target);
    run('pnpm exec isbp-embed-migrations migrations', target);
  }
  const stale = syncRegistries(root);
  stale.forEach((f) => console.warn(`✓ Updated ${relative(root, f)}`));

  console.warn(`
Next steps
  1. pnpm dev                         → open http://localhost:3000/${id}
  2. Edit modules/${id}/src/manifest.ts (permissions, navigation, events, AI tools)
  3. Change the schema in src/server/schema.ts, then: pnpm --filter @isbp/module-${id} db:generate
  4. Grant "${id}.items.*" via a role, or use the "${id}-manager" role the manifest creates.
`);
}

async function docs(check: boolean) {
  const file = join(root, 'docs/ai/reference.md');
  const prettier = await import('prettier');
  const options = (await prettier.resolveConfig(file)) ?? {};
  const next = await prettier.format(await renderReference(root), { ...options, parser: 'markdown' });
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (current === next) return console.warn('✓ docs/ai/reference.md is up to date');
  if (check) {
    console.error('✗ docs/ai/reference.md is out of date. Run `pnpm docs:reference`.');
    process.exit(1);
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, next);
  console.warn('✓ Updated docs/ai/reference.md');
}

try {
  if (command === 'docs') await docs(values.check);
  else if (command === 'create') create(arg);
  else if (command === 'sync') {
    const stale = syncRegistries(root, values.check);
    if (values.check && stale.length) {
      console.error(
        `✗ Module registries are out of date:\n${stale.map((f) => `  - ${relative(root, f)}`).join('\n')}\nRun \`pnpm modules:sync\`.`,
      );
      process.exit(1);
    }
    console.warn(
      stale.length
        ? values.check
          ? ''
          : `✓ Updated ${stale.length} file(s)`
        : '✓ Module registries are up to date',
    );
  } else {
    console.error(
      'Usage:\n  create-module create <module-id> [--description "…"] [--icon lucide-name] [--no-install]\n  create-module sync [--check]\n  create-module docs [--check]',
    );
    process.exit(1);
  }
} catch (err) {
  console.error(`✗ ${(err as Error).message}`);
  process.exit(1);
}
