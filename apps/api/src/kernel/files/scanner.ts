import { createReadStream } from 'node:fs';
import { connect } from 'node:net';

export type ScanResult = { clean: true } | { clean: false; signature: string };

/**
 * ClamAV `clamd` over TCP (INSTREAM). Uploads are scanned before they are stored; when a scanner is
 * configured but unreachable, the upload is refused (fail closed).
 */
export class ClamdScanner {
  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs = 30_000,
  ) {}

  scan(path: string): Promise<ScanResult> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: this.host, port: this.port });
      let reply = '';
      let settled = false;
      const done = (err: Error | null, result?: ScanResult) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (err) reject(err);
        else resolve(result!);
      };
      socket.setTimeout(this.timeoutMs, () => done(new Error('clamd timed out')));
      socket.on('error', (err) => done(err));
      socket.on('data', (chunk) => {
        reply += chunk.toString('utf8');
      });
      socket.on('end', () => {
        const text = reply.replace(/\0/g, '').trim();
        if (/: OK$/.test(text)) return done(null, { clean: true });
        const found = /: (.+) FOUND$/.exec(text);
        if (found) return done(null, { clean: false, signature: found[1]! });
        done(new Error(`unexpected clamd reply: ${text.slice(0, 120)}`));
      });
      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        const file = createReadStream(path, { highWaterMark: 64 * 1024 });
        file.on('data', (chunk) => {
          const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
          const len = Buffer.alloc(4);
          len.writeUInt32BE(buf.length);
          socket.write(len);
          socket.write(buf);
        });
        file.on('error', (err) => done(err));
        file.on('end', () => socket.write(Buffer.alloc(4)));
      });
    });
  }
}
