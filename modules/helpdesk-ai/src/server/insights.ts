import { aiUsage } from '@isbp/db/schema';
import type { AuthContext, ModuleContext } from '@isbp/sdk/server';
import { and, avg, count, eq, gte, sql, sum } from 'drizzle-orm';
import type { Out } from '../contracts';
import { aiInfo, readSettings } from './assist';
import { conversations, insights } from './schema';

const validZone = (tz: string | undefined) => {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
};

const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : null);

/** Accuracy, deflection and cost of the module's AI over the last `days` days. */
export async function overview(
  ctx: ModuleContext,
  days: number,
  auth: AuthContext,
): Promise<Out['Overview']> {
  const since = new Date(Date.now() - days * 86_400_000);
  const tz = validZone(auth.user?.timezone);
  const db = ctx.db;

  const [triageRows, convRows, kinds, usageRows, daily, ai, settings, status] = await Promise.all([
    db
      .select({ status: insights.status, n: count(), confidence: avg(insights.confidence) })
      .from(insights)
      .where(and(eq(insights.kind, 'triage'), gte(insights.createdAt, since)))
      .groupBy(insights.status),
    db
      .select({ status: conversations.status, deflected: conversations.deflected, n: count() })
      .from(conversations)
      .where(and(gte(conversations.createdAt, since), sql`${conversations.messageCount} > 0`))
      .groupBy(conversations.status, conversations.deflected),
    db
      .select({ kind: insights.kind, n: count() })
      .from(insights)
      .where(gte(insights.createdAt, since))
      .groupBy(insights.kind),
    db
      .select({
        feature: aiUsage.feature,
        calls: count(),
        errors: sql<number>`count(*) filter (where ${aiUsage.status} <> 'ok')`.mapWith(Number),
        inputTokens: sum(aiUsage.inputTokens).mapWith(Number),
        outputTokens: sum(aiUsage.outputTokens).mapWith(Number),
        costUsd: sum(aiUsage.costUsd).mapWith(Number),
      })
      .from(aiUsage)
      // Model calls only: tool invocations through the registry are logged too, but cost nothing.
      .where(
        and(
          eq(aiUsage.moduleId, 'helpdesk-ai'),
          gte(aiUsage.createdAt, since),
          sql`${aiUsage.kind} <> 'tool'`,
        ),
      )
      .groupBy(aiUsage.feature),
    db.execute<{
      date: string;
      conversations: number;
      escalations: number;
      deflections: number;
      triage: number;
    }>(sql`
      with days as (
        select generate_series(
          (now() at time zone ${tz})::date - (${days}::int - 1),
          (now() at time zone ${tz})::date,
          interval '1 day'
        )::date as day
      ),
      c as (
        select (created_at at time zone ${tz})::date as day,
               count(*)::int as conversations,
               count(*) filter (where status = 'escalated')::int as escalations,
               count(*) filter (where deflected)::int as deflections
        from helpdesk_ai.conversations
        where created_at >= ${since} and message_count > 0
        group by 1
      ),
      t as (
        select (created_at at time zone ${tz})::date as day, count(*)::int as triage
        from helpdesk_ai.insights
        where kind = 'triage' and created_at >= ${since}
        group by 1
      )
      select to_char(days.day, 'YYYY-MM-DD') as date,
             coalesce(c.conversations, 0) as conversations,
             coalesce(c.escalations, 0) as escalations,
             coalesce(c.deflections, 0) as deflections,
             coalesce(t.triage, 0) as triage
      from days left join c on c.day = days.day left join t on t.day = days.day
      order by days.day`),
    aiInfo(ctx),
    readSettings(ctx),
    ctx.ai.status(),
  ]);

  const by = (s: string) => triageRows.find((r) => r.status === s)?.n ?? 0;
  const suggestions = triageRows.reduce((n, r) => n + r.n, 0);
  const accepted = by('applied') + by('partially_applied') + by('auto_applied');
  const decided = accepted + by('dismissed');
  const weighted = triageRows.reduce(
    (acc, r) => (r.confidence == null ? acc : { s: acc.s + Number(r.confidence) * r.n, n: acc.n + r.n }),
    { s: 0, n: 0 },
  );

  const total = convRows.reduce((n, r) => n + r.n, 0);
  const escalated = convRows.filter((r) => r.status === 'escalated').reduce((n, r) => n + r.n, 0);
  const deflected = convRows.filter((r) => r.deflected).reduce((n, r) => n + r.n, 0);
  const open = convRows.filter((r) => r.status === 'open').reduce((n, r) => n + r.n, 0);

  const byFeature = usageRows
    .map((r) => ({
      feature: r.feature,
      calls: r.calls,
      errors: r.errors ?? 0,
      inputTokens: r.inputTokens ?? 0,
      outputTokens: r.outputTokens ?? 0,
      costUsd: r.costUsd ?? 0,
    }))
    .sort((a, b) => b.costUsd - a.costUsd || b.calls - a.calls);

  return {
    days,
    ai: {
      mode: ai.mode,
      provider: ai.provider,
      model: ai.model,
      embeddings: status.embeddings.model,
      vectorStore: status.vectorStore,
    },
    settings,
    triage: {
      suggestions,
      pending: by('suggested'),
      applied: by('applied'),
      partiallyApplied: by('partially_applied'),
      autoApplied: by('auto_applied'),
      dismissed: by('dismissed'),
      acceptanceRate: ratio(accepted, decided),
      averageConfidence: weighted.n ? weighted.s / weighted.n : null,
    },
    conversations: {
      total,
      open,
      deflected,
      escalated,
      deflectionRate: ratio(deflected, deflected + escalated),
    },
    kbDrafts: kinds.find((k) => k.kind === 'kb_draft')?.n ?? 0,
    summaries: kinds.find((k) => k.kind === 'summary')?.n ?? 0,
    usage: {
      calls: byFeature.reduce((n, f) => n + f.calls, 0),
      inputTokens: byFeature.reduce((n, f) => n + f.inputTokens, 0),
      outputTokens: byFeature.reduce((n, f) => n + f.outputTokens, 0),
      costUsd: byFeature.reduce((n, f) => n + f.costUsd, 0),
      byFeature,
    },
    daily: daily.rows.map((r) => ({
      date: r.date,
      conversations: Number(r.conversations),
      escalations: Number(r.escalations),
      deflections: Number(r.deflections),
      triage: Number(r.triage),
    })),
  };
}
