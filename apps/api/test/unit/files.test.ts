import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer, type IncomingMessage } from 'node:http';
import { type AddressInfo, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contentDisposition, extensionOf, sanitizeFileName } from '../../src/kernel/files/policy';
import { ClamdScanner } from '../../src/kernel/files/scanner';
import { LocalStorage, S3Storage } from '../../src/kernel/files/storage';
import { orderRefs } from '../../src/kernel/records';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'isbp-files-unit-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const streamText = async (s: NodeJS.ReadableStream) => {
  const chunks: Buffer[] = [];
  for await (const c of s) chunks.push(Buffer.from(c as Buffer));
  return Buffer.concat(chunks).toString();
};

describe('file names', () => {
  it('strips paths, control characters and trailing dots', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('C:\\Users\\a\\report.pdf')).toBe('report.pdf');
    expect(sanitizeFileName('a\u0000b<c>.txt')).toBe('a_b_c_.txt');
    expect(sanitizeFileName('invoice.pdf.exe. . ')).toBe('invoice.pdf.exe');
    expect(sanitizeFileName('...')).toBe('file');
    expect(sanitizeFileName('.env')).toBe('env');
    const long = sanitizeFileName(`${'x'.repeat(300)}.docx`);
    expect(long).toHaveLength(200);
    expect(long.endsWith('.docx')).toBe(true);
  });

  it('takes the last extension, lower-cased', () => {
    expect(extensionOf('Setup.EXE')).toBe('exe');
    expect(extensionOf('archive.tar.gz')).toBe('gz');
    expect(extensionOf('README')).toBe('');
  });

  it('encodes Content-Disposition for any name', () => {
    expect(contentDisposition('attachment', '合約 "final".pdf')).toBe(
      `attachment; filename="__ _final_.pdf"; filename*=UTF-8''${encodeURIComponent('合約 "final".pdf')}`,
    );
    expect(contentDisposition('inline', "it's (v2)*.png")).toBe(
      `inline; filename="it's (v2)*.png"; filename*=UTF-8''it%27s%20%28v2%29%2A.png`,
    );
  });
});

describe('record refs', () => {
  it('orders link ends by byte order of type:id', () => {
    const a = { type: 'itsm.ticket', id: 'b' };
    const b = { type: 'alm.release', id: 'z' };
    expect(orderRefs(a, b)).toEqual([b, a]);
    expect(orderRefs(b, a)).toEqual([b, a]);
    // Upper case sorts before lower case in byte order (and in Postgres "C" collation).
    expect(orderRefs({ type: 'x.y', id: 'a' }, { type: 'x.y', id: 'B' })[0].id).toBe('B');
  });
});

describe('LocalStorage', () => {
  it('writes, reads and deletes under generated keys only', async () => {
    const storage = new LocalStorage(join(dir, 'blobs'));
    const src = join(dir, 'src.txt');
    await writeFile(src, 'hello');
    const key = '2026/10/0199b2c4-5f1e-7000-8000-000000000001';
    await storage.put(key, src);
    expect(await streamText(await storage.get(key))).toBe('hello');
    await storage.delete(key);
    await expect(storage.put('../../escape', src)).rejects.toThrow(/invalid storage key/);
  });
});

describe('ClamdScanner', () => {
  function fakeClamd(reply: (body: Buffer) => string) {
    const server = createServer((socket) => {
      const chunks: Buffer[] = [];
      socket.on('data', (c) => {
        chunks.push(c);
        const all = Buffer.concat(chunks);
        // Command, then length-prefixed chunks, ending with a zero length.
        if (all.length >= 14 && all.subarray(all.length - 4).readUInt32BE() === 0) {
          const payload: Buffer[] = [];
          let i = 'zINSTREAM\0'.length;
          while (i + 4 <= all.length) {
            const len = all.readUInt32BE(i);
            if (len === 0) break;
            payload.push(all.subarray(i + 4, i + 4 + len));
            i += 4 + len;
          }
          socket.end(reply(Buffer.concat(payload)));
        }
      });
    });
    return new Promise<{ port: number; close: () => void }>((resolve) =>
      server.listen(0, '127.0.0.1', () =>
        resolve({ port: (server.address() as AddressInfo).port, close: () => server.close() }),
      ),
    );
  }

  // A neutral marker, not the EICAR test string: Windows Defender quarantines EICAR on disk. The fake
  // clamd only looks for this marker, so the dirty path is still exercised end to end.
  const infected = 'ISBP-TEST-INFECTED-PAYLOAD';

  it('reports clean files and found signatures', async () => {
    const clamd = await fakeClamd((body) =>
      body.toString().includes(infected) ? 'stream: ISBP-Test-Signature FOUND\0' : 'stream: OK\0',
    );
    const scanner = new ClamdScanner('127.0.0.1', clamd.port, 2_000);
    const clean = join(dir, 'clean.txt');
    const dirty = join(dir, 'dirty.txt');
    await writeFile(clean, 'just text');
    await writeFile(dirty, infected);
    expect(await scanner.scan(clean)).toEqual({ clean: true });
    expect(await scanner.scan(dirty)).toEqual({ clean: false, signature: 'ISBP-Test-Signature' });
    clamd.close();
  });

  it('fails when the scanner is unreachable', async () => {
    const scanner = new ClamdScanner('127.0.0.1', 1, 500);
    const file = join(dir, 'clean2.txt');
    await writeFile(file, 'x');
    await expect(scanner.scan(file)).rejects.toThrow();
  });
});

describe('S3Storage', () => {
  it('puts, gets and deletes objects with SigV4 against an S3-compatible endpoint', async () => {
    const objects = new Map<string, Buffer>();
    const seen: { method: string; url: string; auth: string; sse?: string }[] = [];
    const server = createHttpServer(async (req: IncomingMessage, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      seen.push({
        method: req.method!,
        url: req.url!,
        auth: String(req.headers.authorization ?? ''),
        sse: req.headers['x-amz-server-side-encryption'] as string | undefined,
      });
      const key = req.url!.split('?')[0]!;
      if (req.method === 'PUT') {
        objects.set(key, Buffer.concat(chunks));
        res.writeHead(200, { etag: '"x"' }).end();
      } else if (req.method === 'GET') {
        const body = objects.get(key);
        if (!body) res.writeHead(404).end();
        else res.writeHead(200, { 'content-length': body.length }).end(body);
      } else if (req.method === 'DELETE') {
        objects.delete(key);
        res.writeHead(204).end();
      } else res.writeHead(405).end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const storage = new S3Storage({
      bucket: 'isbp',
      region: 'us-east-1',
      endpoint: `http://127.0.0.1:${port}`,
      forcePathStyle: true,
      accessKeyId: 'test',
      secretAccessKey: 'test-secret',
      prefix: 'files/',
      sse: 'AES256',
    });
    const src = join(dir, 's3.txt');
    await writeFile(src, 'object body');
    const key = '2026/10/0199b2c4-5f1e-7000-8000-000000000002';
    await storage.put(key, src, { contentType: 'text/plain', size: 11 });
    expect(seen[0]).toMatchObject({ method: 'PUT', sse: 'AES256' });
    expect(seen[0]!.url.startsWith(`/isbp/files/${key}`)).toBe(true);
    expect(seen[0]!.auth).toMatch(/^AWS4-HMAC-SHA256 Credential=test\//);
    expect(await streamText(await storage.get(key))).toBe('object body');
    await storage.delete(key);
    expect(objects.size).toBe(0);
    server.close();
    expect(await readFile(src, 'utf8')).toBe('object body');
  });
});
