import type { SandboxRequest } from '@isbp/sdk/server';
import { Agent, type Dispatcher, request } from 'undici';
import { bootstrapCommand, LineSplitter, type Runner, SCRIPT_ENV } from './common';

const API = '/v1.45';

/** Container settings: no network (unless egress), read-only root, no capabilities, non-root, limits. */
export function dockerContainerSpec(req: SandboxRequest, id: string) {
  const env = Object.entries(req.env ?? {}).map(([k, v]) => `${k}=${v}`);
  env.push(`${SCRIPT_ENV}=${Buffer.from(req.script, 'utf8').toString('base64')}`);
  return {
    Image: req.image,
    Cmd: bootstrapCommand(req.language),
    Env: env,
    User: '65534:65534',
    WorkingDir: '/tmp',
    Labels: { 'io.isbp.sandbox': 'true', 'io.isbp.run': id, ...prefixed(req.labels) },
    NetworkDisabled: (req.network ?? 'none') === 'none',
    HostConfig: {
      NetworkMode: (req.network ?? 'none') === 'none' ? 'none' : 'bridge',
      ReadonlyRootfs: true,
      Tmpfs: { '/tmp': 'rw,nosuid,nodev,size=64m' },
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
      Memory: (req.memoryMb ?? 256) * 1024 * 1024,
      MemorySwap: (req.memoryMb ?? 256) * 1024 * 1024,
      NanoCpus: Math.round((req.cpu ?? 0.5) * 1e9),
      PidsLimit: 128,
      Init: true,
    },
  };
}

function prefixed(labels: Record<string, string> | undefined) {
  return Object.fromEntries(Object.entries(labels ?? {}).map(([k, v]) => [`io.isbp.${k}`, v]));
}

/** Demultiplexes Docker's log stream (8-byte frame headers: stream type, size). */
export class DockerLogDemuxer {
  private buf = Buffer.alloc(0);
  constructor(private readonly emit: (stream: 'stdout' | 'stderr', text: string) => void) {}
  push(chunk: Buffer) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.buf.length >= 8) {
      const size = this.buf.readUInt32BE(4);
      if (this.buf.length < 8 + size) break;
      const stream = this.buf[0] === 2 ? 'stderr' : 'stdout';
      this.emit(stream, this.buf.subarray(8, 8 + size).toString('utf8'));
      this.buf = this.buf.subarray(8 + size);
    }
  }
}

/** Docker Engine API (unix socket or tcp://). Use a dedicated, ideally rootless, Docker host. */
export class DockerRunner implements Runner {
  readonly isolated = true;
  private readonly dispatcher: Dispatcher;
  private readonly origin: string;

  constructor(host: string) {
    if (host.startsWith('unix://')) {
      this.dispatcher = new Agent({ connect: { socketPath: host.slice('unix://'.length) } });
      this.origin = 'http://docker';
    } else {
      this.dispatcher = new Agent();
      this.origin = host.replace(/^tcp:\/\//, 'http://');
    }
  }

  private async call(method: string, path: string, body?: unknown, ok: number[] = [200, 201, 204]) {
    const res = await request(`${this.origin}${API}${path}`, {
      method: method as never,
      dispatcher: this.dispatcher,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.body.text();
    if (!ok.includes(res.statusCode))
      throw new Error(`Docker ${method} ${path}: ${res.statusCode} ${text.slice(0, 300)}`);
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  }

  private async ensureImage(image: string, log: (l: string) => void) {
    const res = await request(`${this.origin}${API}/images/${encodeURIComponent(image)}/json`, {
      dispatcher: this.dispatcher,
    });
    await res.body.dump();
    if (res.statusCode === 200) return;
    log(`Pulling ${image} …`);
    const [name, tag = 'latest'] = splitImage(image);
    const pull = await request(
      `${this.origin}${API}/images/create?fromImage=${encodeURIComponent(name)}&tag=${encodeURIComponent(tag)}`,
      { method: 'POST', dispatcher: this.dispatcher },
    );
    await pull.body.text();
    if (pull.statusCode !== 200) throw new Error(`Could not pull ${image} (${pull.statusCode})`);
  }

  async run(req: SandboxRequest, id: string) {
    const log = (l: string) => req.onLog?.(l, 'stderr');
    await this.ensureImage(req.image, log);
    const created = await this.call(
      'POST',
      `/containers/create?name=isbp-${id}`,
      dockerContainerSpec(req, id),
    );
    const container = String(created.Id);
    let timedOut = false;
    let cancelled = false;
    const kill = () =>
      void this.call('POST', `/containers/${container}/kill`, undefined, [204, 404, 409]).catch(
        () => undefined,
      );
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, req.timeoutMs);
    const onAbort = () => {
      cancelled = true;
      kill();
    };
    req.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      await this.call('POST', `/containers/${container}/start`);
      const out = new LineSplitter((l) => req.onLog?.(l, 'stdout'));
      const err = new LineSplitter((l) => req.onLog?.(l, 'stderr'));
      const demux = new DockerLogDemuxer((stream, text) => (stream === 'stderr' ? err : out).push(text));
      const logs = await request(
        `${this.origin}${API}/containers/${container}/logs?follow=1&stdout=1&stderr=1`,
        { dispatcher: this.dispatcher },
      );
      for await (const chunk of logs.body) demux.push(Buffer.from(chunk as Uint8Array));
      out.flush();
      err.flush();
      const waited = await this.call('POST', `/containers/${container}/wait`);
      return { exitCode: Number(waited.StatusCode ?? -1), timedOut, cancelled };
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener('abort', onAbort);
      await this.call('DELETE', `/containers/${container}?force=1`, undefined, [204, 404]).catch(
        () => undefined,
      );
    }
  }
}

export function splitImage(image: string): [string, string] {
  const at = image.lastIndexOf(':');
  const slash = image.lastIndexOf('/');
  return at > slash ? [image.slice(0, at), image.slice(at + 1)] : [image, 'latest'];
}
