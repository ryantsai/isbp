import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** A registered webhook: the mock POSTs change notifications to `url` with `headers`. */
export interface MockWebhook {
  id: string;
  system: 'sdp' | 'ado';
  url: string;
  headers: Record<string, string>;
}

/**
 * State of every mocked system, kept in memory and (with `file`) written to disk after each change, so
 * links created by a dev stack survive a restart. Each plugin owns one key.
 */
export class MockStore {
  private state: Record<string, unknown> = {};
  private timer: NodeJS.Timeout | null = null;
  webhooks: MockWebhook[] = [];

  constructor(private readonly file: string | null) {
    if (file && existsSync(file)) {
      try {
        const saved = JSON.parse(readFileSync(file, 'utf8')) as {
          state?: Record<string, unknown>;
          webhooks?: MockWebhook[];
        };
        this.state = saved.state ?? {};
        this.webhooks = saved.webhooks ?? [];
      } catch {
        this.state = {};
      }
    }
  }

  /** The plugin's state, seeded on first use. */
  get<T>(key: string, seed: () => T): T {
    if (!(key in this.state)) {
      this.state[key] = seed();
      this.changed();
    }
    return this.state[key] as T;
  }

  /** Replaces every plugin's state with a fresh seed (`POST /_mock/reset`). */
  reset(): void {
    this.state = {};
    this.webhooks = [];
    this.changed();
  }

  /** Schedules a write (debounced). Call after mutating a plugin's state. */
  changed(): void {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 200);
  }

  flush(): void {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ state: this.state, webhooks: this.webhooks }));
    renameSync(tmp, this.file);
  }
}
