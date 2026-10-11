// `pnpm ui:check`: guards that ESLint/tsc don't cover for the Astryx design system.
//   1. the built TEL theme matches its source (src/theme/tel.ts → src/theme/built)
//   2. no migration leftovers (LegacyButton / LegacyBadge markers) in product code
//   3. every `.tsx` under apps/web, modules/*/src and packages/ui/src imports nothing from the removed shadcn-era files
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const problems = [];

// 1. theme drift
const theme = spawnSync('pnpm', ['--filter', '@isbp/ui', 'theme:check'], {
  cwd: ROOT,
  encoding: 'utf8',
  shell: process.platform === 'win32',
});
if (theme.status !== 0)
  problems.push(
    'The built TEL theme is stale: run `pnpm ui:theme` and commit packages/ui/src/theme/built.\n' +
      (theme.stdout + theme.stderr).trim().split('\n').slice(-3).join('\n'),
  );

// 2 + 3. source scan
const REMOVED =
  'button|badge|input|textarea|label|select|checkbox|switch|dialog|alert-dialog|dropdown-menu|popover|tooltip|tabs|separator|scroll-area|spinner|kbd|command|table|sonner';
const removedImport = new RegExp(`from '(@isbp/ui/|\\.{1,2}/(components/)?)(${REMOVED})'`);
const legacy = /\bLegacy(Button|Badge)\b/;
const radix = /from '(radix-ui|class-variance-authority|sonner|cmdk)'/;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.next', 'dist', 'generated'].includes(name)) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else if (/\.(tsx|ts)$/.test(name)) yield p;
  }
}
const roots = [
  join(ROOT, 'apps/web/src'),
  join(ROOT, 'packages/ui/src'),
  ...readdirSync(join(ROOT, 'modules')).map((m) => join(ROOT, 'modules', m, 'src')),
];
for (const root of roots) {
  try {
    statSync(root);
  } catch {
    continue;
  }
  for (const file of walk(root)) {
    const text = readFileSync(file, 'utf8');
    const rel = relative(ROOT, file).replaceAll('\\', '/');
    if (legacy.test(text))
      problems.push(`${rel}: LegacyButton/LegacyBadge left over from the Astryx migration`);
    if (removedImport.test(text) || radix.test(text))
      problems.push(`${rel}: imports a replaced shadcn/Radix primitive (docs/ai/ui-components.md)`);
  }
}

if (problems.length) {
  console.error(`ui:check found ${problems.length} problem(s):\n- ` + problems.join('\n- '));
  process.exit(1);
}
process.stdout.write(
  'ui:check: theme up to date, no migration leftovers, no replaced primitives imported.\n',
);
