import { roleAssignments, roles, users, uuidv7 } from '@isbp/db/schema';
import { cis } from '@isbp/module-cmdb/schema';
import type { TicketStatus } from '@isbp/module-itsm/contracts';
import { changes, ticketCis, tickets } from '@isbp/module-itsm/schema';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/kernel/passwords';
import { createHarness, everyPage, type Harness, PASSWORD, type Session } from './harness';

// The change calendar pages its changes by planned start, then id. Each test owns a window of its own.

const API = '/api/v1/itsm/changes/calendar';
const HOUR = 3_600_000;
const MINUTE = 60_000;
const DAY = 86_400_000;

let h: Harness;
let admin: Session;
let scoped: Session;
let seq = 0;

const windowUrl = (from: number, to: number, extra = '') =>
  `${API}?from=${encodeURIComponent(new Date(from).toISOString())}&to=${encodeURIComponent(new Date(to).toISOString())}${extra}`;

/** The order the API promises: start ascending, then id ascending (ids are lowercase hex, so JS and Postgres agree). */
const inOrder = (list: { id: string; start: number }[]) =>
  [...list].sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((x) => x.id);

interface NewChange {
  start: Date;
  end: Date;
  title: string;
  status?: TicketStatus;
  department?: string | null;
  ciIds?: string[];
}

/** Inserts changes straight into the tables, so windows, statuses and CIs are exactly what each test sets. */
async function insertChanges(rows: NewChange[]): Promise<string[]> {
  const db = h.kernel.db;
  const ticketRows = rows.map((r) => ({
    id: uuidv7(),
    type: 'change' as const,
    number: ++seq,
    title: r.title,
    status: r.status ?? 'scheduled',
    departmentId: r.department ?? null,
  }));
  for (let i = 0; i < ticketRows.length; i += 500)
    await db.insert(tickets).values(ticketRows.slice(i, i + 500));
  for (let i = 0; i < rows.length; i += 500)
    await db.insert(changes).values(
      rows.slice(i, i + 500).map((r, j) => ({
        ticketId: ticketRows[i + j]!.id,
        plannedStart: r.start,
        plannedEnd: r.end,
      })),
    );
  const links = rows.flatMap((r, i) =>
    (r.ciIds ?? []).map((ciId) => ({ ticketId: ticketRows[i]!.id, ciId })),
  );
  if (links.length) await db.insert(ticketCis).values(links);
  return ticketRows.map((t) => t.id);
}

beforeAll(async () => {
  h = await createHarness();
  admin = await h.login('admin');
  // An agent for the Sales organisation only: its department grant doesn't reach changes outside it.
  const db = h.kernel.db;
  const [u] = await db
    .insert(users)
    .values({
      email: 'scoped@test.example',
      username: 'scoped',
      displayName: 'Scoped',
      passwordHash: await hashPassword(PASSWORD),
      departmentId: h.ids.sales,
    })
    .returning();
  const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, 'itsm-agent'));
  await db.insert(roleAssignments).values({
    roleId: role!.id,
    userId: u!.id,
    scopeType: 'department',
    scopeDepartmentId: h.ids.sales,
  });
  await h.kernel.rbac.bump();
  scoped = await h.login('scoped');
});

afterAll(async () => {
  await h?.close();
});

describe('change calendar paging', () => {
  it('pages through every change once, in planned-start order, with ties and a null cursor at the end', async () => {
    const day = Date.UTC(2031, 0, 10, 9);
    // Five starts an hour apart, five changes on each: every start is a tie.
    const rows = Array.from({ length: 5 }, (_, k) => day + k * HOUR).flatMap((start) =>
      Array.from({ length: 5 }, (_, n) => ({
        start: new Date(start),
        end: new Date(start + 30 * MINUTE),
        title: `Tie ${start} #${n}`,
      })),
    );
    const ids = await insertChanges(rows);
    const expected = inOrder(rows.map((r, i) => ({ id: ids[i]!, start: r.start.getTime() })));

    const { items, pages } = await everyPage(h, admin, windowUrl(day - HOUR, day + 6 * HOUR, '&limit=7'));
    expect(pages).toBe(4); // 25 changes, 7 a page: 7 + 7 + 7 + 4
    expect(items.map((i) => i.id)).toEqual(expected);
    expect(new Set(items.map((i) => i.id)).size).toBe(rows.length);

    // An empty window is one empty page with no next cursor.
    const empty = await h.call(admin, 'GET', windowUrl(Date.UTC(2031, 0, 20), Date.UTC(2031, 0, 21)));
    expect(empty.body).toEqual({ items: [], nextCursor: null });
  });

  it('keeps the order of starts that differ only in microseconds', async () => {
    const base = Date.UTC(2031, 1, 10, 9);
    const rows = Array.from({ length: 6 }, (_, n) => ({
      start: new Date(base),
      end: new Date(base + HOUR),
      title: `Micro ${n}`,
    }));
    const ids = await insertChanges(rows);
    // Starts inside one millisecond (JS Dates can't hold these): 0, 1, 1, 2, 3 and 3 microseconds.
    const offsets = [0, 1, 1, 2, 3, 3];
    for (const [i, us] of offsets.entries()) {
      const at = new Date(base).toISOString().replace('.000Z', `.${String(us).padStart(6, '0')}Z`);
      await h.kernel.db.execute(
        sql`update itsm.changes set planned_start = ${at}::timestamptz where ticket_id = ${ids[i]}::uuid`,
      );
    }
    const expected = inOrder(ids.map((id, i) => ({ id, start: offsets[i]! })));

    // One change a page: each cursor must carry the microseconds, or ties would repeat or vanish.
    const { items, pages } = await everyPage(h, admin, windowUrl(base - HOUR, base + 2 * HOUR, '&limit=1'));
    expect(pages).toBe(6);
    expect(items.map((i) => i.id)).toEqual(expected);
  });

  it('serves 200 changes by default and up to 500 a page', async () => {
    const base = Date.UTC(2031, 2, 1);
    const total = 1005;
    await insertChanges(
      Array.from({ length: total }, (_, i) => {
        const start = base + Math.floor(i / 10) * MINUTE; // ten changes a minute
        return { start: new Date(start), end: new Date(start + HOUR), title: `Bulk ${i}` };
      }),
    );
    const url = windowUrl(base - HOUR, base + 2 * DAY);

    const byDefault = await h.call(admin, 'GET', url);
    expect(byDefault.status).toBe(200);
    expect(byDefault.body.items).toHaveLength(200);
    expect(byDefault.body.nextCursor).toEqual(expect.any(String));

    const big = await h.call(admin, 'GET', `${url}&limit=500`);
    expect(big.body.items).toHaveLength(500);

    const { items, pages } = await everyPage(h, admin, `${url}&limit=500`);
    expect(pages).toBe(3); // 500 + 500 + 5
    expect(items).toHaveLength(total);
    expect(new Set(items.map((i) => i.id)).size).toBe(total);

    for (const limit of ['501', '0', '-1', 'abc', '1.5']) {
      const res = await h.call(admin, 'GET', `${url}&limit=${limit}`);
      expect(res.status, `limit=${limit}`).toBe(400);
      expect(res.body.error.code, `limit=${limit}`).toBe('VALIDATION_FAILED');
    }
  });

  it('answers a malformed cursor with 400 VALIDATION_FAILED', async () => {
    const url = windowUrl(Date.UTC(2031, 3, 10), Date.UTC(2031, 3, 12));
    const id = uuidv7();
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const cursors = [
      'not-a-cursor',
      '',
      encode('2031-04-10T00:00:00.000000Z'),
      encode(['2031-04-10T00:00:00.000000Z']),
      encode(['2031-04-10T00:00:00.000000Z', id, 'extra']),
      encode([2031, id]),
      encode(['2031-02-30T00:00:00.000000Z', id]), // 30 February
      encode(['2031-04-10T00:00:00Z', id]), // no microseconds
      encode(['2031-04-10T00:00:00.000000Z', 'not-a-uuid']),
      'x'.repeat(600), // over the length limit
    ];
    for (const cursor of cursors) {
      const res = await h.call(admin, 'GET', `${url}&cursor=${encodeURIComponent(cursor)}`);
      expect(res.status, cursor.slice(0, 40)).toBe(400);
      expect(res.body.error.code, cursor.slice(0, 40)).toBe('VALIDATION_FAILED');
    }
    const structural = await h.call(admin, 'GET', `${url}&cursor=not-a-cursor`);
    expect(structural.body.error.details.issues).toEqual([{ path: 'cursor', message: 'invalid cursor' }]);
  });

  it('flags each change with its own conflicts, whichever page it lands on', async () => {
    const [a, b] = (
      await h.kernel.db
        .insert(cis)
        .values([
          { name: 'calendar-ci-a', classKey: 'server', criticality: 'medium' },
          { name: 'calendar-ci-b', classKey: 'server', criticality: 'medium' },
        ])
        .returning({ id: cis.id })
    ).map((c) => c.id);
    const day = Date.UTC(2031, 4, 10);
    const at = (hours: number) => new Date(day + hours * HOUR);
    await insertChanges([
      { title: 'A overlaps', start: at(10), end: at(12), ciIds: [a!] },
      { title: 'A overlaps too', start: at(11), end: at(13), ciIds: [a!], status: 'implementing' },
      { title: 'B alone', start: at(10), end: at(11), ciIds: [b!] },
      { title: 'B later', start: at(12), end: at(13), ciIds: [b!] },
      // A draft isn't an active change, so it neither conflicts nor makes another change conflict.
      { title: 'B draft', start: at(10.5), end: at(11.5), ciIds: [b!], status: 'draft' },
      { title: 'A later', start: at(14), end: at(15), ciIds: [a!] },
    ]);

    // Two to a page: the first page holds one of the overlapping pair, the second page the other.
    const { items, pages } = await everyPage(
      h,
      admin,
      windowUrl(day + 9 * HOUR, day + 16 * HOUR, '&limit=2'),
    );
    expect(pages).toBe(3);
    expect(Object.fromEntries(items.map((i) => [i.title, i.hasConflict]))).toEqual({
      'A overlaps': true,
      'A overlaps too': true,
      'B alone': false,
      'B later': false,
      'B draft': false,
      'A later': false,
    });
  });

  it('shows a scoped agent only its own changes, on every page', async () => {
    const day = Date.UTC(2031, 5, 10, 9);
    const slot = (k: number) => ({ start: new Date(day + k * HOUR), end: new Date(day + (k + 1) * HOUR) });
    await insertChanges([
      ...[0, 1, 2, 3, 4].map((k) => ({ ...slot(k), title: `Sales ${k}`, department: h.ids.sales })),
      ...[0, 1, 2, 3].map((k) => ({ ...slot(k), title: `Finance ${k}`, department: h.ids.finance })),
      ...[0, 1, 2].map((k) => ({ ...slot(k), title: `Unassigned ${k}`, department: null })),
    ]);
    const url = windowUrl(day - HOUR, day + 10 * HOUR, '&limit=2');

    const mine = await everyPage(h, scoped, url);
    expect(mine.pages).toBe(3);
    expect(mine.items.map((i) => i.title).sort()).toEqual([
      'Sales 0',
      'Sales 1',
      'Sales 2',
      'Sales 3',
      'Sales 4',
    ]);
    expect((await everyPage(h, admin, url)).items).toHaveLength(12);
  });

  it('keeps the window rules: `to` after `from`, at most 400 days', async () => {
    const from = Date.UTC(2031, 6, 1);
    const same = await h.call(admin, 'GET', windowUrl(from, from));
    expect(same.status).toBe(400);
    expect(same.body.error.code).toBe('VALIDATION_FAILED');
    const tooLong = await h.call(admin, 'GET', windowUrl(from, from + 401 * DAY));
    expect(tooLong.status).toBe(400);
    const allowed = await h.call(admin, 'GET', windowUrl(from, from + 400 * DAY));
    expect(allowed.status).toBe(200);
  });
});
