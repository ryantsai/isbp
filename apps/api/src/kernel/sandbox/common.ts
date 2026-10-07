import type { SandboxRequest } from '@isbp/sdk/server';

export const SCRIPT_ENV = 'ISBP_SCRIPT_B64';

const FILES: Record<SandboxRequest['language'], { file: string; run: string }> = {
  python: { file: 'script.py', run: 'python3 -u /tmp/script.py' },
  node: { file: 'script.mjs', run: 'node /tmp/script.mjs' },
  powershell: { file: 'script.ps1', run: 'pwsh -NoProfile -NonInteractive -File /tmp/script.ps1' },
  shell: { file: 'script.sh', run: 'sh /tmp/script.sh' },
};

/**
 * The container command: decode the script from an environment variable into the writable /tmp (the root
 * filesystem is read-only) and exec the interpreter. The script never appears in the command line.
 */
export function bootstrapCommand(language: SandboxRequest['language']): string[] {
  const f = FILES[language];
  return [
    'sh',
    '-c',
    `printf '%s' "$${SCRIPT_ENV}" | base64 -d > /tmp/${f.file} && unset ${SCRIPT_ENV} && exec ${f.run}`,
  ];
}

export const scriptFile = (language: SandboxRequest['language']) => FILES[language].file;

/** Splits a byte stream into lines (max 4 KB each), calling `emit` per line. */
export class LineSplitter {
  private buffer = '';
  constructor(private readonly emit: (line: string) => void) {}

  push(chunk: string) {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      this.emit(this.buffer.slice(0, idx).replace(/\r$/, '').slice(0, 4_096));
      this.buffer = this.buffer.slice(idx + 1);
    }
    if (this.buffer.length > 16_384) {
      this.emit(this.buffer.slice(0, 4_096));
      this.buffer = '';
    }
  }

  flush() {
    if (this.buffer) this.emit(this.buffer.replace(/\r$/, '').slice(0, 4_096));
    this.buffer = '';
  }
}

export interface Runner {
  readonly isolated: boolean;
  run(
    req: SandboxRequest,
    id: string,
  ): Promise<{ exitCode: number | null; timedOut: boolean; cancelled: boolean }>;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
