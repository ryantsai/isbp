import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import { NOTIFY_CHANNEL } from './service';

type Listener = () => void;

/**
 * Fans live "you have new notifications" pings out to Server-Sent Event streams on this replica.
 * One Redis subscription per process (started on the first stream), however many browsers listen.
 */
export class NotificationHub {
  private subscriber?: Redis;
  private starting?: Promise<void>;
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(
    private readonly redis: Redis,
    private readonly log: FastifyBaseLogger,
  ) {}

  private start(): Promise<void> {
    this.starting ??= (async () => {
      const sub = this.redis.duplicate();
      sub.on('error', (err) => this.log.warn({ err }, 'notification hub redis error'));
      sub.on('message', (_channel, message) => {
        try {
          const { userIds } = JSON.parse(message) as { userIds: string[] };
          for (const id of userIds) this.listeners.get(id)?.forEach((fn) => fn());
        } catch (err) {
          this.log.warn({ err }, 'bad notification ping');
        }
      });
      await sub.subscribe(NOTIFY_CHANNEL);
      this.subscriber = sub;
    })();
    return this.starting;
  }

  async subscribe(userId: string, fn: Listener): Promise<() => void> {
    await this.start();
    let set = this.listeners.get(userId);
    if (!set) {
      set = new Set();
      this.listeners.set(userId, set);
    }
    set.add(fn);
    return () => {
      set.delete(fn);
      if (!set.size) this.listeners.delete(userId);
    };
  }

  get connections(): number {
    let n = 0;
    for (const s of this.listeners.values()) n += s.size;
    return n;
  }

  async close() {
    this.listeners.clear();
    await this.subscriber?.quit().catch(() => undefined);
  }
}
