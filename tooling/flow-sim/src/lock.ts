/**
 * Harness-level locks. A flow that changes global state (installing a built-in package, a platform setting) runs that
 * part under a named lock, so concurrent runs of it (other iterations) never see each other's half-done changes:
 *
 * ```ts
 * import { exclusive } from '../lock';
 * await exclusive('isms-pack', async () => { … install, apply, roll back … });
 * ```
 *
 * In-process only (one simulator drives a stack at a time). The wait counts towards the flow's timeout, so a flow
 * that takes a lock declares a `timeoutMs` that allows for the runs queued before it.
 */
import { addTrail } from './context';

const tails = new Map<string, Promise<void>>();

export async function exclusive<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const before = tails.get(name) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => (release = resolve));
  const tail = before.then(() => mine);
  tails.set(name, tail);
  const started = Date.now();
  await before;
  const waited = Date.now() - started;
  if (waited > 50) addTrail(`waited ${Math.round(waited / 1000)} s for the lock "${name}"`);
  try {
    return await fn();
  } finally {
    release();
    if (tails.get(name) === tail) tails.delete(name);
  }
}
