import { AsyncLocalStorage } from 'node:async_hooks';
import type { Principal } from '@isbp/sdk/server';
import { trace } from '@opentelemetry/api';

/** Ambient context for the current request, job or event handler. */
export interface RequestContext {
  principal: Principal;
  requestId?: string;
  ip?: string;
  userAgent?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const SYSTEM_PRINCIPAL: Principal = { type: 'system', id: null, name: 'system' };
export const ANONYMOUS_PRINCIPAL: Principal = { type: 'user', id: null, name: 'anonymous' };

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

export function currentPrincipal(): Principal {
  return storage.getStore()?.principal ?? SYSTEM_PRINCIPAL;
}

/** Updates the principal of the active context in place (after authentication). */
export function setPrincipal(principal: Principal) {
  const store = storage.getStore();
  if (store) store.principal = principal;
}

export function currentTraceId(): string | undefined {
  const span = trace.getActiveSpan();
  const id = span?.spanContext().traceId;
  return id && id !== '00000000000000000000000000000000' ? id : undefined;
}
