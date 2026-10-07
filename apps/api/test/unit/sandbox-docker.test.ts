import { describe, expect, it } from 'vitest';
import { Sandbox } from '../../src/kernel/sandbox';
import { DockerRunner } from '../../src/kernel/sandbox/docker';

/** Runs real containers: CI sets ISBP_TEST_DOCKER=1 (GitHub runners have Docker). Skipped elsewhere. */
describe.skipIf(!process.env.ISBP_TEST_DOCKER)('Docker script runner', () => {
  const sandbox = new Sandbox(
    'docker',
    ['alpine:3.22', 'python:3.13-alpine'],
    new DockerRunner(process.env.SANDBOX_DOCKER_HOST ?? 'unix:///var/run/docker.sock'),
  ).service();

  it('runs a script as nobody, without network, on a read-only root', async () => {
    const lines: string[] = [];
    const result = await sandbox.run({
      image: 'alpine:3.22',
      language: 'shell',
      script: [
        'echo "user=$(id -u) region=$REGION"',
        'touch /etc/x 2>/dev/null && echo writable || echo read-only',
        'wget -q -T 3 -O /dev/null http://example.com 2>/dev/null && echo online || echo offline',
        'echo oops >&2',
      ].join('\n'),
      env: { REGION: 'tw' },
      timeoutMs: 120_000,
      onLog: (l, s) => lines.push(`${s}:${l}`),
    });
    expect(result.exitCode).toBe(0);
    expect(lines).toEqual(
      expect.arrayContaining([
        'stdout:user=65534 region=tw',
        'stdout:read-only',
        'stdout:offline',
        'stderr:oops',
      ]),
    );
  }, 180_000);

  it('runs Python and reports the exit code', async () => {
    const lines: string[] = [];
    const result = await sandbox.run({
      image: 'python:3.13-alpine',
      language: 'python',
      script: 'import sys\nprint("sum", sum(range(10)))\nsys.exit(3)',
      timeoutMs: 120_000,
      onLog: (l) => lines.push(l),
    });
    expect(lines).toContain('sum 45');
    expect(result.exitCode).toBe(3);
  }, 180_000);

  it('kills the container at the timeout', async () => {
    const result = await sandbox.run({
      image: 'alpine:3.22',
      language: 'shell',
      script: 'sleep 60',
      timeoutMs: 2_000,
    });
    expect(result.timedOut).toBe(true);
    expect(result.durationMs).toBeLessThan(30_000);
  }, 120_000);
});
