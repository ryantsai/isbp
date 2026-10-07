import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HttpError } from '@isbp/sdk/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertDatabaseHost } from '../../src/kernel/databases';
import { blockedReason, hostAllowed, OutboundHttp } from '../../src/kernel/outbound';
import { Sandbox } from '../../src/kernel/sandbox';
import { bootstrapCommand, LineSplitter, SCRIPT_ENV } from '../../src/kernel/sandbox/common';
import { DockerLogDemuxer, dockerContainerSpec, splitImage } from '../../src/kernel/sandbox/docker';
import { kubernetesJobSpec, kubernetesSecretSpec } from '../../src/kernel/sandbox/kubernetes';
import { LocalRunner } from '../../src/kernel/sandbox/local';

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'resolved';
  } catch (err) {
    return err instanceof HttpError ? err.code : String(err);
  }
};

describe('outbound HTTP guard', () => {
  it('matches allow-list entries exactly or by *.suffix', () => {
    expect(hostAllowed('api.corp.example', ['*.corp.example'])).toBe(true);
    expect(hostAllowed('corp.example', ['*.corp.example'])).toBe(false);
    expect(hostAllowed('evilcorp.example', ['*.corp.example'])).toBe(false);
    expect(hostAllowed('LOCALHOST', ['localhost'])).toBe(true);
  });

  it('always blocks link-local and metadata; private ranges only without an allow-list match', () => {
    expect(blockedReason('169.254.169.254', 4, true)).toMatch(/metadata/);
    expect(blockedReason('fd00:ec2::254', 6, true)).toMatch(/metadata/);
    expect(blockedReason('10.1.2.3', 4, false)).toMatch(/private/);
    expect(blockedReason('10.1.2.3', 4, true)).toBeNull();
    expect(blockedReason('::1', 6, false)).toMatch(/private/);
    expect(blockedReason('8.8.8.8', 4, false)).toBeNull();
  });

  let server: Server;
  let port: number;
  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/redirect') {
        res.writeHead(302, { location: 'http://169.254.169.254/' }).end();
      } else if (req.url === '/big') {
        res.end('x'.repeat(10_000));
      } else if (req.url === '/slow') {
        setTimeout(() => res.end('late'), 2_000);
      } else res.end(JSON.stringify({ ok: true, method: req.method }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('refuses loopback targets, by IP and by a name that resolves to one (checked at connect)', async () => {
    const http = new OutboundHttp(false).client();
    expect(await code(http.request(`http://127.0.0.1:${port}/`))).toBe('TARGET_BLOCKED');
    expect(await code(http.request(`http://localhost:${port}/`))).toBe('TARGET_BLOCKED');
    expect(await code(http.request('http://169.254.169.254/latest/meta-data'))).toBe('TARGET_BLOCKED');
    expect(await code(http.request(`ftp://localhost:${port}/`))).toBe('TARGET_BLOCKED');
    expect(await code(http.request(`http://user:pw@localhost:${port}/`))).toBe('TARGET_BLOCKED');
  });

  it('allows allow-listed hosts, does not follow redirects, caps bodies and times out', async () => {
    const http = new OutboundHttp(false).client();
    const ok = await http.request(`http://localhost:${port}/`, { allowHosts: ['localhost'], method: 'post' });
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body.toString())).toEqual({ ok: true, method: 'POST' });
    const redirect = await http.request(`http://localhost:${port}/redirect`, { allowHosts: ['localhost'] });
    expect(redirect.status).toBe(302);
    const big = await http.request(`http://localhost:${port}/big`, {
      allowHosts: ['localhost'],
      maxBytes: 100,
    });
    expect(big.body.length).toBe(100);
    expect(big.truncated).toBe(true);
    const slow = http.request(`http://localhost:${port}/slow`, { allowHosts: ['localhost'], timeoutMs: 300 });
    await expect(slow).rejects.toMatchObject({ code: 'UPSTREAM_FAILED', details: { reason: 'timeout' } });
  });

  it('still blocks metadata addresses when private targets are allowed (dev/test)', async () => {
    const http = new OutboundHttp(true).client();
    expect((await http.request(`http://127.0.0.1:${port}/`)).status).toBe(200);
    expect(await code(http.request('http://169.254.169.254/'))).toBe('TARGET_BLOCKED');
  });
});

describe('webhook target guard (IPv4 rules and IPv6 rules are checked separately)', () => {
  it('accepts public IPv4 targets and refuses private and IPv4-mapped ones', async () => {
    const { assertWebhookTarget } = await import('../../src/kernel/notifications/channels');
    await expect(assertWebhookTarget('https://8.8.8.8/hook', false)).resolves.toBeInstanceOf(URL);
    await expect(assertWebhookTarget('https://10.0.0.1/hook', false)).rejects.toThrow(/private/);
    await expect(assertWebhookTarget('https://[::ffff:10.0.0.1]/hook', false)).rejects.toThrow(/private/);
    await expect(assertWebhookTarget('https://[fe80::1]/hook', false)).rejects.toThrow(/private/);
  });
});

describe('database host guard', () => {
  it('refuses link-local and metadata addresses but allows private networks', async () => {
    expect(await code(assertDatabaseHost('169.254.169.254'))).toBe('TARGET_BLOCKED');
    expect(await code(assertDatabaseHost('10.0.0.5'))).toBe('resolved');
    expect(await code(assertDatabaseHost('localhost'))).toBe('resolved');
  });
});

describe('script sandbox', () => {
  const req = {
    image: 'python:3.13-alpine',
    language: 'python' as const,
    script: 'print("hi")',
    env: { REGION: 'tw', API_TOKEN: 's3cret' },
    timeoutMs: 30_000,
    cpu: 0.5,
    memoryMb: 256,
  };

  it('decodes the script from the environment into /tmp (never on the command line)', () => {
    const cmd = bootstrapCommand('python');
    expect(cmd[0]).toBe('sh');
    expect(cmd.join(' ')).toContain(`$${SCRIPT_ENV}`);
    expect(cmd.join(' ')).not.toContain('print("hi")');
    expect(cmd.join(' ')).toContain('/tmp/script.py');
  });

  it('Docker: no network, read-only root, no capabilities, non-root, limits', () => {
    const spec = dockerContainerSpec(req, 'run1');
    expect(spec.User).toBe('65534:65534');
    expect(spec.NetworkDisabled).toBe(true);
    expect(spec.HostConfig).toMatchObject({
      NetworkMode: 'none',
      ReadonlyRootfs: true,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
      Memory: 256 * 1024 * 1024,
      NanoCpus: 500_000_000,
      PidsLimit: 128,
    });
    expect(spec.Env).toContain('REGION=tw');
    expect(dockerContainerSpec({ ...req, network: 'egress' }, 'r').HostConfig.NetworkMode).toBe('bridge');
    expect(splitImage('mcr.microsoft.com/powershell:lts-alpine-3.20')).toEqual([
      'mcr.microsoft.com/powershell',
      'lts-alpine-3.20',
    ]);
    expect(splitImage('localhost:5000/tools')).toEqual(['localhost:5000/tools', 'latest']);
  });

  it('Docker: demultiplexes stdout and stderr frames', () => {
    const got: string[] = [];
    const demux = new DockerLogDemuxer((s, t) => got.push(`${s}:${t}`));
    const frame = (type: number, text: string) => {
      const body = Buffer.from(text);
      const head = Buffer.alloc(8);
      head[0] = type;
      head.writeUInt32BE(body.length, 4);
      return Buffer.concat([head, body]);
    };
    const all = Buffer.concat([frame(1, 'out\n'), frame(2, 'err\n')]);
    demux.push(all.subarray(0, 5));
    demux.push(all.subarray(5));
    expect(got).toEqual(['stdout:out\n', 'stderr:err\n']);
  });

  it('Kubernetes: restricted pod, secrets for script and env, deadline and egress label', () => {
    const job = kubernetesJobSpec(
      { ...req, network: 'egress', labels: { job: 'Nightly Feed' } },
      'isbp-abc',
      'isbp-abc-env',
    );
    const pod = job.spec.template.spec;
    expect(job.spec.activeDeadlineSeconds).toBe(30);
    expect(job.spec.backoffLimit).toBe(0);
    expect(pod.automountServiceAccountToken).toBe(false);
    expect(pod.securityContext).toMatchObject({
      runAsNonRoot: true,
      seccompProfile: { type: 'RuntimeDefault' },
    });
    expect(pod.containers[0]!.securityContext).toEqual({
      allowPrivilegeEscalation: false,
      readOnlyRootFilesystem: true,
      capabilities: { drop: ['ALL'] },
    });
    expect(job.metadata.labels['isbp.io/egress']).toBe('allowed');
    expect((job.metadata.labels as Record<string, string>)['isbp.io/job']).toBe('Nightly-Feed');
    expect(JSON.stringify(job)).not.toContain('s3cret');
    const secret = kubernetesSecretSpec(req, 'isbp-abc-env');
    expect(Buffer.from(Buffer.from(secret.data.script!, 'base64').toString(), 'base64').toString()).toBe(
      'print("hi")',
    );
    expect(Buffer.from(secret.data.env1!, 'base64').toString()).toBe('s3cret');
  });

  it('splits output into capped lines', () => {
    const lines: string[] = [];
    const s = new LineSplitter((l) => lines.push(l));
    s.push('a\r\nb');
    s.push('c\n');
    s.push('x'.repeat(5_000));
    s.flush();
    expect(lines[0]).toBe('a');
    expect(lines[1]).toBe('bc');
    expect(lines[2]!.length).toBe(4_096);
  });

  it('enforces the image allow-list and limits', async () => {
    const sandbox = new Sandbox('local', ['node:24-alpine'], new LocalRunner()).service();
    const run = (patch: object) =>
      code(
        sandbox.run({ image: 'node:24-alpine', language: 'node', script: '', timeoutMs: 5_000, ...patch }),
      );
    expect(await run({ image: 'ubuntu:latest' })).toBe('SANDBOX_UNAVAILABLE');
    expect(await run({ env: { ISBP_MASTER_KEY: 'x' } })).toBe('SANDBOX_UNAVAILABLE');
    expect(await run({ env: { 'BAD NAME': 'x' } })).toBe('SANDBOX_UNAVAILABLE');
    expect(await run({ memoryMb: 1_000_000 })).toBe('SANDBOX_UNAVAILABLE');
    expect(
      await code(
        new Sandbox('none', ['node:24-alpine'])
          .service()
          .run({ image: 'node:24-alpine', language: 'node', script: '', timeoutMs: 5_000 }),
      ),
    ).toBe('SANDBOX_UNAVAILABLE');
  });

  it('local runner: runs Node scripts with only the job environment, and times out', async () => {
    const sandbox = new Sandbox('local', ['node:24-alpine'], new LocalRunner()).service();
    const lines: string[] = [];
    const ok = await sandbox.run({
      image: 'node:24-alpine',
      language: 'node',
      script:
        'console.log("region", process.env.REGION); console.error("db", process.env.DATABASE_URL ?? "none");',
      env: { REGION: 'tw' },
      timeoutMs: 10_000,
      onLog: (l, s) => lines.push(`${s}:${l}`),
    });
    expect(ok.exitCode).toBe(0);
    expect(lines).toEqual(['stdout:region tw', 'stderr:db none']);
    const slow = await sandbox.run({
      image: 'node:24-alpine',
      language: 'node',
      script: 'setTimeout(() => {}, 60_000)',
      timeoutMs: 1_000,
    });
    expect(slow.timedOut).toBe(true);
    expect(slow.durationMs).toBeLessThan(5_000);
  });
});
