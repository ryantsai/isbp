/**
 * `pnpm sim --api http://127.0.0.1:4010 --iterations 500 --concurrency 6 --seed 42 --flows all --report <dir>`
 *
 * Signs the personas in (setting up the simulator's own people first when needed), runs the flows, waits for
 * background work to drain, scans the logs and writes `report.json` + `report.md`. Exits 1 when anything failed.
 * See tooling/flow-sim/README.md.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { BackgroundChecks } from './checks';
import { ApiClient } from './client';
import { FLOWS } from './flows';
import { PERSONAS, PersonaDirectory, setupPersonas } from './personas';
import { Recorder } from './recorder';
import { buildReport, writeReport } from './report';
import { runFlows } from './runner';
import { assertSimApi } from './safety';

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_STACK_DIR = process.env.SIM_DIR ?? join(PACKAGE_DIR, '.state', 'stack');

const { values: args } = parseArgs({
  options: {
    api: { type: 'string', default: 'http://127.0.0.1:4010' },
    iterations: { type: 'string', default: '1' },
    concurrency: { type: 'string', default: '4' },
    seed: { type: 'string', default: '1' },
    flows: { type: 'string', default: 'all' },
    report: { type: 'string' },
    db: { type: 'string', default: 'postgres://isbp:isbp@localhost:5432/isbp_sim' },
    redis: { type: 'string', default: 'redis://localhost:6379/12' },
    'worker-metrics': { type: 'string', default: 'http://127.0.0.1:9475/metrics' },
    logs: { type: 'string' },
    'api-log': { type: 'string' },
    'worker-log': { type: 'string' },
    'drain-timeout': { type: 'string', default: '120' },
    'flow-timeout': { type: 'string', default: '180' },
    'slow-ms': { type: 'string', default: '3000' },
    setup: { type: 'boolean', default: false },
    list: { type: 'boolean', default: false },
    'allow-any-stack': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
  allowPositionals: false,
});

const out = (line = '') => process.stdout.write(`${line}\n`);
const none = (v: string | undefined) => (!v || v === 'none' ? null : v);
const int = (v: string | undefined, name: string, min = 1) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw new Error(`--${name} must be an integer ≥ ${min}`);
  return n;
};

if (args.help) {
  out(`pnpm sim [options]

  --api <url>              API origin (default http://127.0.0.1:4010, the sim stack)
  --iterations <n>         each iteration runs every selected flow once (default 1)
  --concurrency <n>        flow runs in flight at once, across iterations (default 4)
  --seed <n>               random seed: the same seed makes the same choices (default 1)
  --flows all|a,b          flows to run (default all; --list shows them)
  --report <dir>           where report.json and report.md go (default .state/reports/<time>)
  --db <url|none>          the stack's database, for read-only drain checks (default the sim DB)
  --redis <url|none>       the stack's Redis, for queue checks (default redis://localhost:6379/12)
  --worker-metrics <url|none>   the worker's Prometheus endpoint (default http://127.0.0.1:9475/metrics)
  --logs <dir>             directory with api.log and worker.log (default $SIM_DIR or .state/stack)
  --api-log <file>, --worker-log <file>   log files to scan instead
  --drain-timeout <s>      how long to wait for background work after the last flow (default 120)
  --flow-timeout <s>       a flow run that takes longer fails (default 180)
  --slow-ms <ms>           requests slower than this are reported (default 3000)
  --setup                  set the personas up again (normally only when one can't sign in)
  --list                   list flows and personas
  --allow-any-stack        allow --api on ports 3000/4000 (the demo stack: don't)`);
  process.exit(0);
}

if (args.list) {
  out('Flows:');
  for (const f of FLOWS) out(`  ${f.name.padEnd(28)} ${f.area.padEnd(10)} ${f.description ?? ''}`);
  out('\nPersonas (ctx.as(name); pools pick one member per run):');
  for (const p of PERSONAS)
    out(`  ${p.name.padEnd(12)} ${(p.pool ?? '').padEnd(9)} ${p.username.padEnd(16)} ${p.about}`);
  process.exit(0);
}

async function main(): Promise<number> {
  const api = args.api!.replace(/\/+$/, '');
  assertSimApi(api, args['allow-any-stack']!);
  const iterations = int(args.iterations, 'iterations');
  const concurrency = int(args.concurrency, 'concurrency');
  const seed = int(args.seed, 'seed', 0);
  const flowTimeoutMs = int(args['flow-timeout'], 'flow-timeout') * 1000;
  const drainTimeoutMs = int(args['drain-timeout'], 'drain-timeout', 0) * 1000;
  const selected =
    args.flows === 'all'
      ? FLOWS
      : args.flows!.split(',').map((name) => {
          const f = FLOWS.find((x) => x.name === name.trim());
          if (!f) throw new Error(`Unknown flow "${name}" (--list shows them)`);
          return f;
        });
  const startedAt = new Date();
  const runToken = Math.floor(startedAt.getTime() / 1000)
    .toString(36)
    .slice(-6);
  const reportDir = resolve(
    args.report ?? join(PACKAGE_DIR, '.state', 'reports', startedAt.toISOString().replace(/[:.]/g, '-')),
  );
  const logDir = args.logs ?? DEFAULT_STACK_DIR;
  const logs = [
    { name: 'api', path: args['api-log'] ?? join(logDir, 'api.log') },
    { name: 'worker', path: args['worker-log'] ?? join(logDir, 'worker.log') },
  ].filter((l) => existsSync(l.path));

  const ready = await fetch(`${api}/readyz`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!ready?.ok) throw new Error(`The API at ${api} is not ready (start it with pnpm sim:stack)`);

  const recorder = new Recorder(int(args['slow-ms'], 'slow-ms'));
  const directory = new PersonaDirectory(
    api,
    (spec, credentials) => new ApiClient(spec.name, api, recorder, credentials),
  );

  out(
    `flow-sim → ${api} · ${selected.length} flows × ${iterations} iterations · concurrency ${concurrency} · seed ${seed}`,
  );
  let failed = await directory.signInAll();
  if (failed.includes('admin'))
    throw new Error(
      'The seeded admin cannot sign in: is the database seeded, and SEED_ADMIN_PASSWORD right?',
    );
  if (failed.length || args.setup) {
    out(`setting up personas${failed.length ? ` (${failed.length} could not sign in)` : ''}…`);
    await setupPersonas(api, directory.client('admin'), out);
    directory.reload();
    failed = await directory.signInAll();
    if (failed.length) throw new Error(`These personas still cannot sign in: ${failed.join(', ')}`);
  }
  for (const f of selected)
    for (const p of f.personas)
      if (!directory.isKnown(p)) throw new Error(`Flow ${f.name} uses an unknown persona "${p}"`);

  const checks = new BackgroundChecks({
    databaseUrl: none(args.db),
    redisUrl: none(args.redis),
    workerMetricsUrl: none(args['worker-metrics']),
    logs,
    runToken,
  });
  const baseline = await checks.open();
  if (baseline.unavailable.length) out(`note: ${baseline.unavailable.join('; ')}`);

  const abort = new AbortController();
  let interrupted = 0;
  process.on('SIGINT', () => {
    interrupted++;
    if (interrupted > 1) process.exit(130);
    out('\ninterrupted: finishing the runs in flight, then writing the report (Ctrl-C again to quit now)');
    abort.abort();
  });

  let lastPrint = 0;
  let failures = 0;
  // The first few runs of each failure signature are printed; the report has them all.
  const printed = new Map<string, number>();
  const outcome = await runFlows({
    flows: selected,
    iterations,
    concurrency,
    seed,
    runToken,
    flowTimeoutMs,
    directory,
    recorder,
    signal: abort.signal,
    onResult(r, done, total) {
      if (!r.ok) {
        failures++;
        const seen = (printed.get(r.error!.signature) ?? 0) + 1;
        printed.set(r.error!.signature, seen);
        if (seen <= 3)
          out(
            `  ✗ ${r.flow} #${r.iteration}: ${r.error!.step ? `[${r.error!.step}] ` : ''}${r.error!.message.slice(0, 200)}`,
          );
      }
      const now = Date.now();
      if (now - lastPrint > 10_000 || done === total) {
        lastPrint = now;
        const secs = Math.round((now - startedAt.getTime()) / 1000);
        out(
          `  ${done}/${total} runs · ${failures} failed · ${recorder.serverErrorCount} 5xx · ` +
            `${recorder.slowCount} slow · ${secs} s`,
        );
      }
    },
  });

  out(`flows done in ${Math.round(outcome.wallMs / 1000)} s; waiting for background work…`);
  const drain = await checks.drain(drainTimeoutMs);
  const [failedJobs, failedProcessActions] = await Promise.all([
    checks.failedJobs(),
    checks.failedProcessActions(),
  ]);
  const logScan = checks.scanLogs();
  await checks.close();

  const report = buildReport({
    api,
    seed,
    iterations,
    concurrency,
    runToken,
    startedAt,
    flows: selected,
    outcome,
    recorder,
    background: { baseline, drain, failedJobs, failedProcessActions },
    logs: logScan,
  });
  writeReport(reportDir, report);

  const t = report.totals;
  out('');
  out(
    `${report.ok ? 'PASS' : 'FAIL'} · ${t.passed}/${t.runs} runs passed · ${report.failures.length} failure signatures`,
  );
  out(
    `  ${t.requests} requests · ${t.serverErrors} 5xx · ${t.transportErrors} without response · ${t.slowRequests} slow · ` +
      `drained: ${t.drained === null ? 'not checked' : t.drained ? 'yes' : 'NO'} · failed jobs ${t.failedJobs} · ` +
      `failed process actions ${t.failedProcessActions} · log errors ${t.logErrors}`,
  );
  out(
    `  ${Math.round(report.timing.wallMs / 1000)} s wall · ${Math.round(report.timing.perIterationMs / 100) / 10} s per iteration ` +
      `(500 iterations ≈ ${report.timing.estimate500IterationsMinutes} min)`,
  );
  for (const f of report.failures.slice(0, 10)) out(`  ${String(f.count).padStart(4)}× ${f.signature}`);
  out(`report: ${join(reportDir, 'report.md')}`);
  return report.ok ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err: Error) => {
    console.error(`flow-sim: ${err.message}`);
    process.exit(2);
  },
);
