import { httpErrors, likePattern, type ModuleContext, type Page } from '@isbp/sdk/server';
import { and, asc, desc, eq, gte, ilike, lt, or, type SQL, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { CallDetailOut, CallerDto, CallOut, callQuerySchema } from '../contracts';
import { PERIOD_HOURS } from '../model';
import { calls, endpoints } from './schema';

type CallRow = typeof calls.$inferSelect;

const toDto = (c: CallRow, e: { id: string; slug: string; name: string }): CallOut => ({
  id: c.id,
  endpoint: e,
  version: c.version,
  caller: {
    type: c.callerType,
    id: c.callerType === 'client' ? c.clientId : c.userId,
    name: c.callerName,
  },
  status: c.status,
  errorCode: c.errorCode,
  durationMs: c.durationMs,
  rows: c.rows,
  cached: c.cached,
  params: c.params,
  requestId: c.requestId,
  createdAt: c.createdAt,
});

/** The execution log of Data API calls: filters, the callers seen, one call, and retention. */
export class CallService {
  constructor(private readonly ctx: ModuleContext) {}

  private since(period: keyof typeof PERIOD_HOURS) {
    return new Date(Date.now() - PERIOD_HOURS[period] * 3_600_000);
  }

  async list(query: z.infer<typeof callQuerySchema>): Promise<Page<CallOut>> {
    const conds: SQL[] = [gte(calls.createdAt, this.since(query.period))];
    if (query.endpoint) conds.push(eq(calls.endpointId, query.endpoint));
    if (query.status === 'ok') conds.push(lt(calls.status, 400));
    if (query.status === 'error') conds.push(gte(calls.status, 400));
    if (query.caller) {
      const [type, id] = query.caller.split(':') as ['user' | 'client', string];
      conds.push(type === 'user' ? eq(calls.userId, id) : eq(calls.clientId, id));
    }
    if (query.q) {
      const p = likePattern(query.q);
      conds.push(
        or(
          ilike(endpoints.slug, p),
          ilike(calls.callerName, p),
          ilike(calls.errorCode, p),
          ilike(calls.requestId, p),
        )!,
      );
    }
    const where = and(...conds);
    const key = query.sort?.replace(/^-/, '');
    const dir = query.sort && !query.sort.startsWith('-') ? asc : desc;
    const column =
      key === 'durationMs' ? calls.durationMs : key === 'status' ? calls.status : calls.createdAt;
    const [{ total } = { total: 0 }] = await this.ctx.db
      .select({ total: sql<number>`count(*)::int` })
      .from(calls)
      .innerJoin(endpoints, eq(endpoints.id, calls.endpointId))
      .where(where);
    const rows = await this.ctx.db
      .select({ call: calls, endpoint: { id: endpoints.id, slug: endpoints.slug, name: endpoints.name } })
      .from(calls)
      .innerJoin(endpoints, eq(endpoints.id, calls.endpointId))
      .where(where)
      .orderBy(query.sort ? dir(column) : desc(calls.createdAt), desc(calls.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    return {
      items: rows.map((r) => toDto(r.call, r.endpoint)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** People and API clients that called in the last 30 days (for the caller filter). */
  async callers(): Promise<CallerDto[]> {
    const rows = await this.ctx.db
      .selectDistinctOn([calls.callerType, calls.userId, calls.clientId], {
        type: calls.callerType,
        userId: calls.userId,
        clientId: calls.clientId,
        name: calls.callerName,
      })
      .from(calls)
      .where(gte(calls.createdAt, this.since('30d')))
      .orderBy(calls.callerType, calls.userId, calls.clientId, desc(calls.createdAt));
    return rows
      .map((r) => ({ type: r.type, id: r.type === 'client' ? r.clientId : r.userId, name: r.name }))
      .filter((r) => r.id)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(id: string): Promise<CallDetailOut> {
    const [r] = await this.ctx.db
      .select({ call: calls, endpoint: { id: endpoints.id, slug: endpoints.slug, name: endpoints.name } })
      .from(calls)
      .innerJoin(endpoints, eq(endpoints.id, calls.endpointId))
      .where(eq(calls.id, id));
    if (!r) throw httpErrors.notFound('Call not found');
    return { ...toDto(r.call, r.endpoint), errorMessage: r.call.errorMessage };
  }

  /** Deletes calls older than `logRetentionDays` (the retention job). */
  async purge(): Promise<number> {
    const days = Math.max(
      1,
      Math.floor(Number(await this.ctx.settings.get<number>('logRetentionDays')) || 30),
    );
    const result = await this.ctx.db.execute(
      sql`delete from ${calls} where ${calls.createdAt} < ${new Date(Date.now() - days * 86_400_000)}`,
    );
    return result.rowCount ?? 0;
  }
}
