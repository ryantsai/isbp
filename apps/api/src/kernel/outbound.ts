import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { ErrorCodes, HttpError, type HttpClient, type OutboundResponse } from '@isbp/sdk/server';
import { Agent, request } from 'undici';

/**
 * One list per address family: Node's BlockList matches IPv4 addresses against IPv6 rules such as
 * `::ffff:0:0/96`, so mixing families in one list would make every IPv4 address "private".
 */
function rules(v4: [string, number][], v6: [string, number][]) {
  const ipv4 = new BlockList();
  const ipv6 = new BlockList();
  for (const [net, prefix] of v4) ipv4.addSubnet(net, prefix, 'ipv4');
  for (const [net, prefix] of v6) ipv6.addSubnet(net, prefix, 'ipv6');
  return (address: string, family: number) =>
    family === 6 ? ipv6.check(address, 'ipv6') : ipv4.check(address, 'ipv4');
}

/** Never reachable, even when private targets are allowed: link-local and cloud metadata. */
const alwaysBlocked = rules(
  [
    ['169.254.0.0', 16],
    ['0.0.0.0', 8],
  ],
  [
    ['fe80::', 10],
    ['fd00:ec2::', 32],
    ['::ffff:169.254.0.0', 112],
    ['::ffff:0.0.0.0', 104],
  ],
);

/** Private, loopback, CGNAT, benchmarking and multicast: only for allow-listed hosts. */
const isPrivate = rules(
  [
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['172.16.0.0', 12],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['224.0.0.0', 4],
  ],
  [
    ['::1', 128],
    ['::', 128],
    ['fc00::', 7],
    ['ff00::', 8],
    // IPv4-mapped addresses: treat as private (they are a common way around IPv4-only checks).
    ['::ffff:0:0', 96],
  ],
);

/** `host` matches an allow-list entry: exact (case-insensitive) or `*.suffix`. */
export function hostAllowed(host: string, allow: readonly string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return allow.some((raw) => {
    const p = raw.trim().toLowerCase();
    if (!p) return false;
    if (p.startsWith('*.')) return h.endsWith(p.slice(1)) && h.length > p.length - 1;
    return h === p;
  });
}

/** Why `address` may not be contacted for `host`, or null. */
export function blockedReason(address: string, family: number, hostIsAllowed: boolean): string | null {
  if (alwaysBlocked(address, family)) return `${address} is a link-local or metadata address`;
  if (!hostIsAllowed && isPrivate(address, family)) return `${address} is a private network address`;
  return null;
}

class TargetBlocked extends Error {
  readonly code = 'ETARGETBLOCKED';
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

function checkedLookup(allowPrivate: boolean, allow: readonly string[]) {
  return (hostname: string, options: LookupOptions, callback: LookupCallback) => {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, []);
      const ok = allowPrivate || hostAllowed(hostname, allow);
      for (const a of addresses) {
        const reason = blockedReason(a.address, a.family, ok);
        if (reason) return callback(new TargetBlocked(`${hostname}: ${reason}`), []);
      }
      if (options.all) callback(null, addresses);
      else callback(null, addresses[0]!.address, addresses[0]!.family);
    });
  };
}

const blockedError = (message: string) => new HttpError(422, ErrorCodes.TARGET_BLOCKED, message);

function findCode(err: unknown): string | undefined {
  let e: unknown = err;
  for (let i = 0; i < 5 && e; i++) {
    const code = (e as { code?: string }).code;
    if (code) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * `ctx.http`. Agents are cached per allow-list, and each checks every address it connects to (the
 * lookup runs inside the socket connect, so a second DNS answer can't swap in a private address).
 */
export class OutboundHttp {
  private readonly agents = new Map<string, Agent>();

  constructor(private readonly allowPrivate: boolean) {}

  private agent(allow: readonly string[]): Agent {
    const key = [...allow].sort().join(',');
    let agent = this.agents.get(key);
    if (!agent) {
      if (this.agents.size > 50) {
        const [first] = this.agents.keys();
        void this.agents.get(first!)?.close();
        this.agents.delete(first!);
      }
      agent = new Agent({
        connect: { lookup: checkedLookup(this.allowPrivate, allow) as never, timeout: 10_000 },
        keepAliveTimeout: 10_000,
      });
      this.agents.set(key, agent);
    }
    return agent;
  }

  client(): HttpClient {
    return {
      request: async (raw, opts = {}): Promise<OutboundResponse> => {
        let url: URL;
        try {
          url = new URL(raw);
        } catch {
          throw new HttpError(400, ErrorCodes.VALIDATION_FAILED, 'Invalid URL');
        }
        if (url.protocol !== 'https:' && url.protocol !== 'http:')
          throw blockedError('Only http:// and https:// URLs are allowed');
        if (url.username || url.password) throw blockedError('Credentials in URLs are not allowed');
        const allow = opts.allowHosts ?? [];
        const host = url.hostname.replace(/^\[|\]$/g, '');
        if (isIP(host)) {
          const reason = blockedReason(host, isIP(host), this.allowPrivate || hostAllowed(host, allow));
          if (reason) throw blockedError(reason);
        }
        const timeoutMs = opts.timeoutMs ?? 30_000;
        const maxBytes = opts.maxBytes ?? 1024 * 1024;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
        const onAbort = () => controller.abort(new Error('cancelled'));
        opts.signal?.addEventListener('abort', onAbort, { once: true });
        const started = performance.now();
        try {
          const res = await request(url, {
            method: (opts.method ?? 'GET').toUpperCase() as never,
            headers: { 'user-agent': 'IS-Big-Platform/1.0', ...(opts.headers ?? {}) },
            body: opts.body ?? undefined,
            dispatcher: this.agent(allow),
            signal: controller.signal,
          });
          const chunks: Buffer[] = [];
          let size = 0;
          let truncated = false;
          for await (const chunk of res.body) {
            const buf = Buffer.from(chunk as Uint8Array);
            if (size + buf.length > maxBytes) {
              chunks.push(buf.subarray(0, maxBytes - size));
              size = maxBytes;
              truncated = true;
              res.body.destroy();
              break;
            }
            chunks.push(buf);
            size += buf.length;
          }
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(', ') : String(v);
          }
          return {
            status: res.statusCode,
            headers,
            body: Buffer.concat(chunks),
            truncated,
            durationMs: Math.round(performance.now() - started),
          };
        } catch (err) {
          if (err instanceof HttpError) throw err;
          if (findCode(err) === 'ETARGETBLOCKED' || err instanceof TargetBlocked)
            throw blockedError(String((err as Error).message ?? err));
          const reason = opts.signal?.aborted
            ? 'cancelled'
            : controller.signal.aborted
              ? 'timeout'
              : 'network';
          throw new HttpError(502, ErrorCodes.UPSTREAM_FAILED, `${reason}: ${(err as Error).message}`, {
            reason,
            code: findCode(err) ?? null,
          });
        } finally {
          clearTimeout(timer);
          opts.signal?.removeEventListener('abort', onAbort);
        }
      },
    };
  }

  async close() {
    await Promise.allSettled([...this.agents.values()].map((a) => a.close()));
    this.agents.clear();
  }
}
