import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SandboxRequest } from '@isbp/sdk/server';
import { LineSplitter, type Runner, scriptFile } from './common';

const INTERPRETERS: Record<SandboxRequest['language'], (file: string) => [string, string[]]> = {
  node: (f) => [process.execPath, [f]],
  python: (f) => ['python3', ['-u', f]],
  shell: (f) => ['/bin/sh', [f]],
  powershell: (f) => ['pwsh', ['-NoProfile', '-NonInteractive', '-File', f]],
};

/**
 * Development only (refused in production): runs the script as a child process in a temp directory. It
 * gets only the job's environment (never the worker's), but no filesystem or network isolation.
 */
export class LocalRunner implements Runner {
  readonly isolated = false;

  async run(req: SandboxRequest) {
    const dir = await mkdtemp(join(tmpdir(), 'isbp-script-'));
    const file = join(dir, scriptFile(req.language));
    await writeFile(file, req.script, { mode: 0o600 });
    const [cmd, args] = INTERPRETERS[req.language](file);
    try {
      return await new Promise<{ exitCode: number | null; timedOut: boolean; cancelled: boolean }>(
        (resolve) => {
          let timedOut = false;
          let cancelled = false;
          const child = spawn(cmd, args, {
            cwd: dir,
            env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir, TMPDIR: dir, ...(req.env ?? {}) },
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          const out = new LineSplitter((l) => req.onLog?.(l, 'stdout'));
          const err = new LineSplitter((l) => req.onLog?.(l, 'stderr'));
          child.stdout.setEncoding('utf8').on('data', (d: string) => out.push(d));
          child.stderr.setEncoding('utf8').on('data', (d: string) => err.push(d));
          const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
          }, req.timeoutMs);
          const onAbort = () => {
            cancelled = true;
            child.kill('SIGKILL');
          };
          req.signal?.addEventListener('abort', onAbort, { once: true });
          child.on('error', (e) => {
            req.onLog?.(`Could not start ${cmd}: ${e.message}`, 'stderr');
          });
          child.on('close', (code) => {
            clearTimeout(timer);
            req.signal?.removeEventListener('abort', onAbort);
            out.flush();
            err.flush();
            resolve({ exitCode: code, timedOut, cancelled });
          });
        },
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
