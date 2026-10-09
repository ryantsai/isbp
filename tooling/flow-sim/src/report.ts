/** `report.json` (everything) and `report.md` (the same, for people) in the report directory. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BackgroundState, DrainResult, FailedJob, FailedRun, LogGroup } from './checks';
import type { FlowDefinition } from './flow';
import { percentiles, type Recorder, type RequestRecord } from './recorder';
import type { RunOutcome } from './runner';

export interface ReportInput {
  api: string;
  seed: number;
  iterations: number;
  concurrency: number;
  runToken: string;
  startedAt: Date;
  flows: FlowDefinition[];
  outcome: RunOutcome;
  recorder: Recorder;
  background: {
    baseline: BackgroundState | null;
    drain: DrainResult | null;
    failedJobs: { count: number; jobs: FailedJob[] };
    failedProcessActions: { count: number; runs: FailedRun[] };
  };
  logs: { errors: LogGroup[]; warnings: { source: string; msg: string; count: number }[] };
}

export function buildReport(input: ReportInput) {
  const { outcome, recorder } = input;
  const results = outcome.results;
  const failedRuns = results.filter((r) => !r.ok);

  const flows = input.flows.map((f) => {
    const mine = results.filter((r) => r.flow === f.name);
    const tags: Record<string, number> = {};
    for (const r of mine) for (const t of r.tags) tags[t] = (tags[t] ?? 0) + 1;
    return {
      name: f.name,
      area: f.area,
      runs: mine.length,
      passed: mine.filter((r) => r.ok).length,
      failed: mine.filter((r) => !r.ok).length,
      ...percentiles(mine.map((r) => r.ms)),
      tags,
    };
  });

  const bySignature = new Map<string, typeof failedRuns>();
  for (const r of failedRuns) {
    const list = bySignature.get(r.error!.signature) ?? [];
    list.push(r);
    bySignature.set(r.error!.signature, list);
  }
  const failures = [...bySignature.entries()]
    .map(([signature, runs]) => {
      const first = runs[0]!;
      return {
        signature,
        flow: first.flow,
        step: first.error!.step,
        count: runs.length,
        iterations: runs.slice(0, 25).map((r) => r.iteration),
        first: {
          iteration: first.iteration,
          atMs: first.startedAt,
          message: first.error!.message,
          personas: first.personas,
          request: first.error!.request,
          details: first.error!.details,
          stack: first.error!.stack,
          trail: first.error!.trail,
        },
      };
    })
    .sort((a, b) => b.count - a.count);

  const spans = outcome.iterationSpans.map((s) => s.ms);
  const completedIterations = new Set(results.map((r) => r.iteration)).size;
  const perIterationMs = completedIterations ? outcome.wallMs / completedIterations : 0;
  const drain = input.background.drain;
  const totals = {
    runs: results.length,
    passed: results.length - failedRuns.length,
    failed: failedRuns.length,
    requests: recorder.requestCount,
    serverErrors: recorder.serverErrorCount,
    slowRequests: recorder.slowCount,
    transportErrors: recorder.transportErrorCount,
    reauthentications: recorder.reauthentications,
    failedJobs: input.background.failedJobs.count,
    failedProcessActions: input.background.failedProcessActions.count,
    logErrors: input.logs.errors.reduce((n, g) => n + g.count, 0),
    drained: drain ? drain.drained : null,
  };
  const ok =
    !outcome.aborted &&
    totals.failed === 0 &&
    totals.serverErrors === 0 &&
    totals.transportErrors === 0 &&
    totals.failedJobs === 0 &&
    totals.failedProcessActions === 0 &&
    totals.logErrors === 0 &&
    drain?.drained !== false;

  return {
    ok,
    api: input.api,
    seed: input.seed,
    runToken: input.runToken,
    startedAt: input.startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    iterations: { requested: input.iterations, completed: completedIterations },
    concurrency: input.concurrency,
    aborted: outcome.aborted,
    totals,
    timing: {
      wallMs: outcome.wallMs,
      perIterationMs: Math.round(perIterationMs),
      iterationSpan: percentiles(spans),
      estimate500IterationsMinutes: Math.round((perIterationMs * 500) / 60_000),
    },
    flows,
    failures,
    serverErrors: groupRequests(recorder.serverErrors),
    serverErrorSamples: recorder.serverErrors.slice(0, 50),
    transportErrors: recorder.transportErrors.slice(0, 50),
    slowRequests: recorder.slow
      .slice()
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 50),
    routes: recorder.routeSummary(),
    waits: recorder.waitSummary(),
    background: input.background,
    logs: input.logs,
  };
}

export type Report = ReturnType<typeof buildReport>;

function groupRequests(list: RequestRecord[]) {
  const map = new Map<string, { route: string; status: number; count: number; first: RequestRecord }>();
  for (const r of list) {
    const key = `${r.method} ${r.template} ${r.status}`;
    const g = map.get(key);
    if (g) g.count++;
    else map.set(key, { route: `${r.method} ${r.template}`, status: r.status, count: 1, first: r });
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

const ms = (n: number) => (n >= 10_000 ? `${(n / 1000).toFixed(1)} s` : `${Math.round(n)} ms`);
const cell = (s: unknown) =>
  String(s ?? '')
    .replaceAll('|', '\\|')
    .replaceAll('\n', ' ');
const block = (s: string) => `\n\`\`\`\n${s.replaceAll('```', "'''")}\n\`\`\`\n`;

export function renderMarkdown(r: Report): string {
  const out: string[] = [];
  const t = r.totals;
  out.push(`# Flow simulation report — ${r.ok ? 'PASS' : 'FAIL'}`, '');
  out.push(
    `${r.api} · seed ${r.seed} · ${r.iterations.completed}/${r.iterations.requested} iterations · concurrency ` +
      `${r.concurrency} · ${r.startedAt} → ${r.finishedAt}${r.aborted ? ' · **aborted**' : ''}`,
    '',
  );
  out.push('| Check | Result |', '| --- | --- |');
  out.push(`| Flow runs | ${t.passed} passed, ${t.failed} failed (of ${t.runs}) |`);
  out.push(`| Requests | ${t.requests} |`);
  out.push(`| 5xx responses | ${t.serverErrors} |`);
  out.push(`| No response (transport errors) | ${t.transportErrors} |`);
  out.push(`| Slower than 3 s | ${t.slowRequests} |`);
  out.push(`| Sessions re-established mid-run | ${t.reauthentications} |`);
  out.push(
    `| Background work drained | ${t.drained === null ? 'not checked' : t.drained ? 'yes' : '**no**'} |`,
  );
  out.push(`| Failed background jobs | ${t.failedJobs} |`);
  out.push(`| Failed process actions | ${t.failedProcessActions} |`);
  out.push(`| Error-level log entries | ${t.logErrors} |`);
  out.push(
    `| Wall time | ${ms(r.timing.wallMs)} (${ms(r.timing.perIterationMs)} per iteration; 500 iterations ≈ ` +
      `${r.timing.estimate500IterationsMinutes} min) |`,
    '',
  );

  out.push('## Flows', '', '| Flow | Area | Runs | Passed | Failed | p50 | p95 | max | Variants |');
  out.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const f of r.flows)
    out.push(
      `| ${f.name} | ${f.area} | ${f.runs} | ${f.passed} | ${f.failed} | ${ms(f.p50)} | ${ms(f.p95)} | ${ms(f.max)} | ${cell(
        Object.entries(f.tags)
          .map(([k, v]) => `${k} ${v}`)
          .join(', '),
      )} |`,
    );
  out.push('');

  out.push('## Failures by signature', '');
  if (!r.failures.length) out.push('None.', '');
  for (const f of r.failures) {
    out.push(`### ${f.count}× ${cell(f.signature)}`, '');
    out.push(
      `- Flow **${f.flow}**, step _${cell(f.step ?? '(none)')}_; iterations ${f.iterations.join(', ')}`,
    );
    out.push(`- First (iteration ${f.first.iteration}): ${cell(f.first.message)}`);
    out.push(
      `- Personas: ${cell(
        Object.entries(f.first.personas)
          .map(([k, v]) => `${k} = ${v}`)
          .join(', ') || '(fixed)',
      )}`,
    );
    if (f.first.request)
      out.push(
        `- Request: \`${f.first.request.method} ${f.first.request.path}\` → ${f.first.request.status}` +
          `${f.first.request.requestId ? ` (request id ${f.first.request.requestId})` : ''}`,
        block(f.first.request.body),
      );
    if (f.first.details !== undefined)
      out.push('- Details:', block(JSON.stringify(f.first.details, null, 2)));
    if (f.first.stack) out.push('- Stack:', block(f.first.stack));
    if (f.first.trail.length)
      out.push('<details><summary>Trail</summary>', block(f.first.trail.join('\n')), '</details>');
    out.push('');
  }

  out.push('## 5xx responses', '');
  if (!r.serverErrors.length) out.push('None.', '');
  else {
    out.push('| Count | Route | Status | First (flow › step) | Body |', '| --- | --- | --- | --- | --- |');
    for (const g of r.serverErrors)
      out.push(
        `| ${g.count} | ${cell(g.route)} | ${g.status} | ${cell(`${g.first.flow ?? 'setup'} › ${g.first.step ?? ''}`)} | ${cell(
          (g.first.body ?? '').slice(0, 200),
        )} |`,
      );
    out.push('');
  }
  if (r.transportErrors.length) {
    out.push('## No response', '', '| Route | Flow › step | Error |', '| --- | --- | --- |');
    for (const e of r.transportErrors.slice(0, 20))
      out.push(
        `| ${cell(`${e.method} ${e.template}`)} | ${cell(`${e.flow} › ${e.step}`)} | ${cell(e.error)} |`,
      );
    out.push('');
  }

  out.push('## Slow requests (> 3 s)', '');
  if (!r.slowRequests.length) out.push('None.', '');
  else {
    out.push('| Time | Route | Status | Flow › step |', '| --- | --- | --- | --- |');
    for (const s of r.slowRequests.slice(0, 25))
      out.push(
        `| ${ms(s.ms)} | ${cell(`${s.method} ${s.template}`)} | ${s.status} | ${cell(`${s.flow} › ${s.step}`)} |`,
      );
    out.push('');
  }

  out.push('## Latency by route (slowest p95 first)', '');
  out.push(
    '| Route | Count | p50 | p95 | p99 | max | Statuses |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const x of r.routes.slice(0, 40))
    out.push(
      `| ${cell(x.route)} | ${x.count} | ${ms(x.p50)} | ${ms(x.p95)} | ${ms(x.p99)} | ${ms(x.max)} | ${cell(
        Object.entries(x.statuses)
          .map(([k, v]) => `${k}×${v}`)
          .join(' '),
      )} |`,
    );
  out.push('');

  out.push('## Waiting for background work (`eventually`)', '');
  out.push('| Flow · what | ok | timed out | p50 | p95 | max |', '| --- | --- | --- | --- | --- | --- |');
  for (const w of r.waits)
    out.push(
      `| ${cell(`${w.flow} · ${w.label}`)} | ${w.ok} | ${w.timedOut} | ${ms(w.p50)} | ${ms(w.p95)} | ${ms(w.max)} |`,
    );
  out.push('');

  out.push('## Background work', '');
  const d = r.background.drain;
  if (!d) out.push('Not checked.', '');
  else {
    out.push(
      d.drained
        ? `Drained ${ms(d.waitedMs)} after the last flow finished.`
        : `**Not drained** after ${ms(d.waitedMs)}: ${d.pending.join('; ')}.`,
      '',
    );
    const s = d.final;
    if (s.outbox)
      out.push(
        `- Outbox: ${s.outbox.pending} pending (${s.outbox.withErrors} with errors, oldest ${s.outbox.oldestPendingSeconds ?? 0} s)`,
      );
    if (s.processActions)
      out.push(
        `- Process action runs: ${Object.entries(s.processActions)
          .map(([k, v]) => `${k} ${v}`)
          .join(', ')}`,
      );
    if (s.worker && r.background.baseline?.worker) {
      const b = r.background.baseline.worker;
      out.push(
        `- Worker (this run): ${s.worker.handled - b.handled} events handled, ${s.worker.handlerErrors - b.handlerErrors} handler errors (retried), ${s.worker.jobsFailed - b.jobsFailed} failed job attempts`,
      );
    }
    if (s.queues) {
      out.push(
        '',
        '| Queue | waiting | active | delayed | failed (all time) |',
        '| --- | --- | --- | --- | --- |',
      );
      for (const [q, c] of Object.entries(s.queues))
        out.push(`| ${q} | ${c.wait} | ${c.active} | ${c.delayed} | ${c.failed} |`);
    }
    if (s.unavailable.length) out.push('', `Not checked: ${s.unavailable.join('; ')}.`);
    out.push('');
  }
  const fj = r.background.failedJobs;
  out.push(`### Jobs that failed during the run: ${fj.count}`, '');
  for (const j of fj.jobs)
    out.push(`- ${j.queue} ${cell(j.name)} (${j.attempts} attempts): ${cell(j.reason)}`);
  const fp = r.background.failedProcessActions;
  out.push('', `### Process actions that failed: ${fp.count}`, '');
  for (const p of fp.runs)
    out.push(
      `- ${p.type} (${p.actionId}, ${p.attempts} attempts): ${cell(p.errorCode ?? '')} ${cell(p.error)}`,
    );
  out.push('');

  out.push('## Log entries at error level', '');
  if (!r.logs.errors.length) out.push('None.', '');
  for (const g of r.logs.errors) {
    out.push(`### ${g.count}× [${g.source}] ${cell(g.signature)}`, '');
    out.push(`- First: ${g.first.time ?? '?'}${g.first.req ? ` · ${cell(g.first.req)}` : ''}`);
    if (g.first.stack) out.push(block(g.first.stack));
    out.push('');
  }
  if (r.logs.warnings.length) {
    out.push('### Warnings (counts)', '');
    for (const w of r.logs.warnings) out.push(`- ${w.count}× [${w.source}] ${cell(w.msg)}`);
    out.push('');
  }
  return `${out.join('\n')}\n`;
}

export function writeReport(dir: string, report: Report) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(dir, 'report.md'), renderMarkdown(report));
}
