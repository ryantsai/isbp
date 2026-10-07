import { users } from '@isbp/db/schema';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runWithContext } from '../../src/kernel/context';
import { hashPassword } from '../../src/kernel/passwords';
import { createHarness, type Harness, PASSWORD } from './harness';

/** The Helpdesk AI demo seed on top of the CMDB, ITSM and knowledge seeds: realistic and idempotent. */
let h: Harness;

const seed = (id: string) =>
  runWithContext({ principal: { type: 'system', id: null, name: 'seed' } }, () =>
    h.kernel.registry.get(id)!.seed!(h.kernel.registry.context(id)),
  );

const count = async (q: ReturnType<typeof sql>) => (await h.kernel.db.execute<{ n: number }>(q)).rows[0]!.n;

beforeAll(async () => {
  h = await createHarness();
  const hash = await hashPassword(PASSWORD);
  await h.kernel.db.insert(users).values(
    [
      ['helpdesk', '林雅婷', 'zh-TW'],
      ['wang.mei', '王美玲', 'zh-TW'],
      ['chen.wei', '陳志偉', 'zh-TW'],
      ['sato.misaki', '佐藤 美咲', 'ja-JP'],
      ['tanaka.ken', '田中 健', 'ja-JP'],
      ['olivia', 'Olivia Bennett', 'en'],
    ].map(([username, displayName, locale]) => ({
      email: `${username}@test.example`,
      username: username!,
      displayName: displayName!,
      locale: locale!,
      passwordHash: hash,
    })),
  );
  for (const id of ['cmdb', 'knowledge', 'itsm']) if (h.kernel.registry.get(id)?.seed) await seed(id);
}, 180_000);

afterAll(async () => {
  await h?.close();
});

describe('helpdesk-ai seed', () => {
  it('creates triage insights for open tickets and sample conversations in three languages, once', async () => {
    await seed('helpdesk-ai');
    const insights = await count(
      sql`select count(*)::int as n from helpdesk_ai.insights where kind = 'triage'`,
    );
    const openTickets = await count(
      sql`select count(*)::int as n from itsm.tickets where type in ('incident', 'service_request')
          and status not in ('resolved', 'fulfilled', 'closed', 'cancelled', 'rejected')`,
    );
    expect(openTickets).toBeGreaterThan(0);
    expect(insights).toBeGreaterThan(0);
    const statuses = await h.kernel.db.execute<{ status: string }>(
      sql`select distinct status from helpdesk_ai.insights where kind = 'triage'`,
    );
    expect(statuses.rows.length).toBeGreaterThan(0);

    const conv = await h.kernel.db.execute<{
      status: string;
      locale: string;
      n: number;
      ticket_ref: string | null;
    }>(sql`select status, locale, ticket_ref, message_count as n from helpdesk_ai.conversations`);
    expect(conv.rows).toHaveLength(8);
    expect(new Set(conv.rows.map((r) => r.locale))).toEqual(new Set(['en', 'zh-TW', 'ja-JP']));
    expect(new Set(conv.rows.map((r) => r.status))).toEqual(new Set(['open', 'resolved', 'escalated']));
    for (const r of conv.rows.filter((c) => c.status === 'escalated'))
      expect(r.ticket_ref).toMatch(/^(INC|SR)-\d{5}$/);
    const messages = await count(sql`select count(*)::int as n from helpdesk_ai.messages`);
    expect(messages).toBe(conv.rows.reduce((n, r) => n + r.n, 0));
    const cited = await count(
      sql`select count(*)::int as n from helpdesk_ai.messages where jsonb_array_length(citations) > 0`,
    );
    expect(cited).toBeGreaterThan(0);

    await seed('helpdesk-ai');
    expect(await count(sql`select count(*)::int as n from helpdesk_ai.insights where kind = 'triage'`)).toBe(
      insights,
    );
    expect(await count(sql`select count(*)::int as n from helpdesk_ai.conversations`)).toBe(8);
  }, 120_000);
});
