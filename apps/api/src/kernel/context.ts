import { AsyncLocalStorage } from 'node:async_hooks';
import type { AuthContext, Principal } from '@isbp/sdk/server';
import { trace } from '@opentelemetry/api';

/** Ambient context for the current request, job or event handler. */
export interface RequestContext {
  principal: Principal;
  /**
   * The caller's authorization, when one is in effect (an HTTP request after authentication, an AI tool call). The
   * kernel uses it where a service has no `auth` argument, e.g. to check that records picked in `record` custom
   * fields are readable by the person saving them.
   */
  auth?: AuthContext;
  requestId?: string;
  ip?: string;
  userAgent?: string;
  /**
   * Merged into the metadata of every audit entry recorded in this context, e.g. the request and approver behind a
   * process action (`{ processAction: { request: 'REQ-01042', … } }`).
   */
  auditMetadata?: Record<string, unknown>;
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
export function setPrincipal(principal: Principal, auth?: AuthContext) {
  const store = storage.getStore();
  if (store) {
    store.principal = principal;
    if (auth) store.auth = auth;
  }
}

/** The caller's authorization in the current request or tool call, if any. */
export function currentAuth(): AuthContext | undefined {
  return storage.getStore()?.auth;
}

export function currentTraceId(): string | undefined {
  const span = trace.getActiveSpan();
  const id = span?.spanContext().traceId;
  return id && id !== '00000000000000000000000000000000' ? id : undefined;
}
