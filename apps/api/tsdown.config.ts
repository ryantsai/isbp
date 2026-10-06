import { defineConfig } from 'tsdown';

/**
 * Bundles each entrypoint with all workspace packages (@isbp/*, modules) inlined, so the image needs
 * only production npm dependencies — migrations are embedded, nothing is read from the source tree.
 */
export default defineConfig({
  entry: ['src/main.ts', 'src/worker.ts', 'src/migrate.ts', 'src/seed.ts', 'src/telemetry.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  dts: false,
  noExternal: [/^@isbp\//],
  // package.json is "type": "module", so plain .js is ESM; keeps entrypoint names stable for Docker/Helm.
  fixedExtension: false,
});
