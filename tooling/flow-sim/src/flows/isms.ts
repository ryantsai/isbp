/**
 * Information security (module `isms`): the information asset register (numbering per site and class under
 * concurrency, value = max(C, I, A), "create from" an ITAM asset, CSV export → import round trip), stocktakes
 * (custodians check their assets → a security officer signs off), shared accounts (members reviewed → password change
 * due → recorded by the custodian) and account reviews (CSV import → keep/disable/delete → tickets → complete →
 * returned or signed off).
 */
import type { ApiClient, Json } from '../client';
import { defineFlow, type FlowContext } from '../flow';
import { addDays, notificationsAbout, parseCsv, todayIn, toCsv, withExclusive } from './asset-support';

const I = '/isms';
const LOCALES = ['en', 'zh-TW', 'ja-JP'] as const;
const CUSTODIANS = ['custodian1', 'custodian2', 'custodian3'];

/**
 * Every item of a list, page by page (a page holds 200): a count is checked against the whole list, and a run's lists
 * grow with the stocktakes of earlier runs, so a first page is never the whole of them.
 */
async function everyItem(
  ctx: FlowContext,
  client: ApiClient,
  path: string,
  query: Record<string, unknown> = {},
) {
  const out: Json[] = [];
  for (let page = 1; page <= 100; page++) {
    const res = ctx.expect.ok(await client.get(path, { query: { ...query, pageSize: 200, page } })).body;
    out.push(...((res.items ?? []) as Json[]));
    // A list without a total (or a page past its end) is complete with this page.
    const total = typeof res.total === 'number' ? res.total : out.length;
    if (!res.items?.length || out.length >= total) break;
  }
  return out;
}

interface Taxonomy {
  classes: Json[];
  sites: Json[];
  labels: Json[];
}

let taxonomy: Promise<Taxonomy> | null = null;
function taxonomyOf(ctx: FlowContext): Promise<Taxonomy> {
  taxonomy ??= (async () =>
    ctx.expect.ok(await ctx.as('ismsmgr').get(`${I}/taxonomy`), 'the taxonomy').body as Taxonomy)().catch(
    (err) => {
      taxonomy = null;
      throw err;
    },
  );
  return taxonomy;
}

const level = (ctx: FlowContext) => ctx.rand.int(1, 4);

/** Random valid register fields: a class with one of its sub-classes, a site, C/I/A and maybe a label. */
function assetBody(ctx: FlowContext, t: Taxonomy, name: string, over: Record<string, unknown> = {}) {
  const cls = (
    over.classId ? t.classes.find((c) => c.id === over.classId) : ctx.rand.pick(t.classes)
  ) as Json;
  const subs = (cls.subclasses as Json[]).filter((s) => !s.archived);
  const site = (over.siteId ? t.sites.find((s) => s.id === over.siteId) : ctx.rand.pick(t.sites)) as Json;
  const [c, i, a] = [level(ctx), level(ctx), level(ctx)];
  return {
    body: {
      name,
      classId: cls.id,
      siteId: site.id,
      subclassId: subs.length && ctx.rand.bool(0.7) ? ctx.rand.pick(subs).id : undefined,
      confidentiality: c,
      integrity: i,
      availability: a,
      classificationId: ctx.rand.bool(0.5) ? ctx.rand.pick(t.labels).id : undefined,
      location: ctx.rand.bool(0.5) ? `Sim room ${ctx.rand.int(100, 999)}` : undefined,
      brand: ctx.rand.bool(0.4) ? ctx.rand.pick(['Dell', 'Cisco', 'Synology', 'Lenovo', 'HP']) : undefined,
      quantity: ctx.rand.int(1, 5),
      ...over,
    },
    cls,
    site,
    value: Math.max(c, i, a),
  };
}

/* ───────────────────────────── isms-asset-register ───────────────────────────── */

export const ismsAssetRegister = defineFlow({
  name: 'isms-asset-register',
  area: 'isms',
  description:
    'Register assets at once (numbering per site/class), C/I/A value, create from an ITAM asset, CSV export → import',
  personas: ['ismsmgr', 'infosec', 'assetmgr', 'employee'],
  async run(ctx) {
    const mgr = ctx.as('ismsmgr');
    const sfx = ctx.rand.suffix();
    const t = await taxonomyOf(ctx);
    const cls = ctx.rand.pick(t.classes);
    const site = ctx.rand.pick(t.sites);
    const n = ctx.rand.int(1, 5);
    ctx.tag(`${n} at once`);

    const created = await ctx.step(`${n} assets of one site and class are registered at once`, async () => {
      const drafts = Array.from({ length: n }, (_, i) =>
        assetBody(ctx, t, `Sim ${ctx.rand.words(1, 3)} ${sfx} ${i}`, { classId: cls.id, siteId: site.id }),
      );
      const res = await Promise.all(drafts.map((d) => mgr.post(`${I}/assets`, d.body)));
      const out = res.map((r, i) => {
        ctx.expect.status(r, 201, 'registered');
        ctx.expect.match(
          r.body.number,
          new RegExp(`^${site.code}${cls.code}\\d{4,}$`),
          'number = site, class, n',
        );
        ctx.expect.equal(r.body.value, drafts[i]!.value, 'value = max(C, I, A)');
        return r.body as Json;
      });
      const numbers = out.map((a) => a.number as string);
      ctx.expect.equal(new Set(numbers).size, n, `unique numbers (${numbers.join(', ')})`);
      const listed = ctx.expect.ok(await mgr.get(`${I}/assets`, { query: { q: sfx, pageSize: 50 } })).body;
      ctx.expect.equal(listed.total, n, 'the register lists them');
      for (const a of out) {
        const same = ctx.expect.ok(await mgr.get(`${I}/assets/${a.number}`)).body;
        ctx.expect.equal(same.id, a.id, `${a.number} is that asset`);
      }
      return out;
    });

    await ctx.step('invalid entries and people without rights are refused', async () => {
      const base = { name: `x ${sfx}`, classId: cls.id, siteId: site.id, integrity: 1, availability: 1 };
      ctx.expect.status(await mgr.post(`${I}/assets`, { ...base, confidentiality: 5 }), 400, 'a score of 5');
      const other = t.classes.find((c) => c.id !== cls.id && (c.subclasses as Json[]).length);
      if (other) {
        const wrong = await mgr.post(`${I}/assets`, {
          ...base,
          confidentiality: 1,
          subclassId: (other.subclasses as Json[])[0].id,
        });
        ctx.expect.status(wrong, 400, 'a sub-class of another class');
      }
      ctx.expect.status(
        await ctx.as('infosec').post(`${I}/assets`, { ...base, confidentiality: 1 }),
        403,
        'a security officer reads the register, does not change it',
      );
      ctx.expect.status(await ctx.as('employee').get(`${I}/assets`), 403, 'an employee may not read it');
      ctx.expect.status(
        await ctx.as('employee').get(`${I}/assets/${created[0]!.number}`),
        [403, 404],
        'nor one asset',
      );
    });

    await ctx.step('a change recomputes the value and keeps the number', async () => {
      const a = created[0]!;
      const [c, i, av] = [level(ctx), level(ctx), level(ctx)];
      const changed = ctx.expect.ok(
        await mgr.patch(`${I}/assets/${a.number}`, { confidentiality: c, integrity: i, availability: av }),
      ).body;
      ctx.expect.equal([changed.number, changed.value], [a.number, Math.max(c, i, av)], 'number, value');
      const other = ctx.rand.pick(t.classes.filter((x) => x.id !== cls.id));
      // A sub-class belongs to its class: moving the asset clears it (or picks one of the new class).
      const subs = (other.subclasses as Json[]).filter((x) => !x.archived);
      const subclassId = subs.length && ctx.rand.bool() ? ctx.rand.pick(subs).id : null;
      if (a.subclass)
        ctx.expect.status(
          await mgr.patch(`${I}/assets/${a.number}`, { classId: other.id }),
          400,
          'keeping a sub-class of the old class is refused',
        );
      const moved = ctx.expect.ok(
        await mgr.patch(`${I}/assets/${a.number}`, { classId: other.id, subclassId }),
      ).body;
      ctx.expect.equal(moved.subclass?.id ?? null, subclassId, 'the sub-class');
      ctx.expect.equal([moved.number, moved.class.code], [a.number, other.code], 'moved class, same number');
      const events = ctx.expect.ok(await mgr.get(`${I}/assets/${a.number}/events`)).body.items as Json[];
      ctx.expect.equal(events.at(-1)?.kind, 'created', 'the first event');
      ctx.expect.truthy(
        events.filter((e) => e.kind === 'updated').length >= 1,
        'the updates are in the history',
      );
    });

    await ctx.step('the CSV export imports back unchanged', async () => {
      const locale = ctx.rand.pick(LOCALES);
      const csv = await mgr.get(`${I}/assets/export.csv`, { query: { q: sfx, locale } });
      ctx.expect.ok(csv, 'export');
      ctx.expect.truthy(typeof csv.body === 'string', 'a CSV body');
      // (The client decodes the body as UTF-8, which drops the BOM the export starts with.)
      const text = csv.body as string;
      const rows = parseCsv(text);
      ctx.expect.equal(rows.length - 1, n, 'exported rows');
      const dry = ctx.expect.ok(await mgr.post(`${I}/assets/import`, { csv: text, dryRun: true })).body;
      ctx.expect.equal(
        [dry.error, dry.rows, dry.created, dry.updated, dry.skipped, dry.unchanged],
        [null, n, 0, 0, 0, n],
        `round trip (${locale}): error, rows, created, updated, skipped, unchanged`,
      );
      // Rename one row in the file and import it for real.
      const header = rows[0]!;
      const nameCol = 1;
      const renamed = `Sim renamed ${sfx}`;
      const row = rows[1]!;
      const edited = [
        header,
        [...row.slice(0, nameCol), renamed, ...row.slice(nameCol + 1)],
        ...rows.slice(2),
      ];
      ctx.expect.status(
        await ctx.as('infosec').post(`${I}/assets/import`, { csv: toCsv(edited), dryRun: true }),
        403,
        'a security officer may not import',
      );
      const real = ctx.expect.ok(
        await mgr.post(`${I}/assets/import`, { csv: toCsv(edited), dryRun: false }),
      ).body;
      ctx.expect.equal([real.created, real.updated, real.skipped], [0, 1, 0], 'created, updated, skipped');
      const after = ctx.expect.ok(await mgr.get(`${I}/assets/${row[0]}`)).body;
      ctx.expect.equal(after.name, renamed, 'the renamed asset');
    });

    if (ctx.rand.bool(0.5))
      await ctx.step('an ITAM asset is registered from its record, once', async () => {
        ctx.tag('create from ITAM');
        const serial = `SIM-ISMS-${sfx}`.toUpperCase();
        const itam = ctx.expect.status(
          await ctx.as('assetmgr').post('/itam/assets', {
            name: `Sim server ${sfx}`,
            category: 'server',
            serialNumber: serial,
          }),
          201,
        ).body;
        const ref = `itam.asset:${itam.id}`;
        const found = ctx.expect.ok(
          await mgr.get(`${I}/sources`, { query: { type: 'itam.asset', q: serial } }),
        ).body.items as Json[];
        const src = ctx.expect.find(found, (r) => r.ref === ref, 'the ITAM asset is offered');
        ctx.expect.equal(src.registered, null, 'not registered yet');
        const hidden = `itam.asset:0192b9a0-0000-7000-8000-${String(ctx.rand.int(1, 999_999_999_999)).padStart(12, '0')}`;
        const hw = t.classes.find((c) => c.code === 'HW') ?? cls;
        const body = {
          refs: [ref, hidden],
          classId: hw.id,
          siteId: site.id,
          confidentiality: level(ctx),
          integrity: level(ctx),
          availability: level(ctx),
        };
        ctx.expect.status(
          await ctx.as('infosec').post(`${I}/assets/from-records`, body),
          403,
          'security officer',
        );
        const twice = ctx.rand.bool(0.4);
        if (twice) ctx.tag('create from twice at once');
        const sent = twice
          ? await Promise.all([1, 2].map(() => mgr.post(`${I}/assets/from-records`, body)))
          : [await mgr.post(`${I}/assets/from-records`, body)];
        // At once, the second may be refused because the first registered the record meanwhile.
        for (const r of sent) if (r.status === 409) ctx.expect.code(r, 'CONFLICT', 409);
        const res = sent.filter((r) => r.status !== 409);
        ctx.expect.truthy(res.length >= 1, 'one of them goes through');
        for (const r of res) ctx.expect.ok(r, 'create from records');
        const made = res.flatMap((r) => r.body.created as Json[]);
        ctx.expect.equal(made.length, 1, 'assets created from the record (all requests together)');
        ctx.expect.find(
          res[0]!.body.skipped as Json[],
          (s) => s.ref === hidden && s.reason === 'hidden',
          'an unknown record is skipped as hidden',
        );
        const again = ctx.expect.ok(await mgr.post(`${I}/assets/from-records`, body)).body;
        ctx.expect.equal(again.created.length, 0, 'registered only once');
        ctx.expect.find(
          again.skipped as Json[],
          (s) => s.ref === ref && s.reason === 'registered',
          'skipped',
        );
        const after = ctx.expect.ok(
          await mgr.get(`${I}/sources`, { query: { type: 'itam.asset', q: serial } }),
        ).body.items as Json[];
        ctx.expect.equal(
          after.find((r) => r.ref === ref)?.registered?.number,
          made[0]!.number,
          'the source shows its asset number',
        );
        const links = ctx.expect.ok(await mgr.get(`/records/isms.asset/${made[0]!.id}/links`)).body;
        ctx.expect.find(
          links.links as Json[],
          (l) => l.record?.type === 'itam.asset' && l.record?.id === itam.id,
          'linked to the ITAM asset',
        );
      });

    if (ctx.rand.bool(0.3))
      await ctx.step('an asset is deleted', async () => {
        const a = created.at(-1)!;
        // Another flow's request in approval may name it: then the delete is refused, listing it (decision 93).
        const res = await mgr.delete(`${I}/assets/${a.number}`);
        if (res.status === 409) {
          ctx.expect.code(res, 'IN_USE', 409, 'deleting an asset a request still names');
          return ctx.tag('still named by a request');
        }
        ctx.tag('deleted');
        ctx.expect.status(res, 204, 'deleted');
        ctx.expect.status(await mgr.get(`${I}/assets/${a.number}`), 404, 'gone');
      });
  },
});

/* ───────────────────────────── isms-stocktake ───────────────────────────── */

type Result = 'confirmed' | 'changed' | 'missing' | 'disposed';

export const ismsStocktake = defineFlow({
  name: 'isms-stocktake',
  area: 'isms',
  description:
    'Stocktake of a custodian’s assets → they confirm, correct, report missing or disposed → security signs off',
  personas: ['ismsmgr', 'infosec', ...CUSTODIANS, 'employee'],
  timeoutMs: 200_000,
  async run(ctx) {
    const mgr = ctx.as('ismsmgr');
    const sec = ctx.as('infosec');
    const t = await taxonomyOf(ctx);
    const sfx = ctx.rand.suffix();
    const today = todayIn();
    // The stocktake snapshots every asset its custodian manages: no other run may change theirs meanwhile.
    await withExclusive(ctx, CUSTODIANS, async (custodian) => {
      const who = ctx.user(custodian);
      const other = ctx.as(CUSTODIANS.find((c) => c !== custodian)!);
      const me = ctx.as(custodian);

      const leftovers = await ctx.step('what the custodian manages already', async () =>
        (await everyItem(ctx, mgr, `${I}/assets`, { manager: who.id, view: 'all' })).filter((a) =>
          ['active', 'missing'].includes(a.status as string),
        ),
      );
      if (leftovers.length) ctx.tag('earlier assets in scope');

      const m = ctx.rand.int(2, 5);
      const mine = await ctx.step(`${m} assets for the custodian`, async () =>
        Promise.all(
          Array.from({ length: m }, async (_, i) => {
            const d = assetBody(ctx, t, `Sim stock ${sfx} ${i}`, { managerId: who.id });
            return ctx.expect.status(await mgr.post(`${I}/assets`, d.body), 201).body as Json;
          }),
        ),
      );
      const total = leftovers.length + m;

      const recurrence = ctx.rand.weighted([
        ['none', 4],
        ['yearly', 1],
      ] as const);
      const name = `Sim stocktake ${sfx}`;
      const st = await ctx.step(
        'the asset manager starts a stocktake of the custodian’s assets',
        async () => {
          ctx.expect.status(
            await ctx.as('employee').post(`${I}/stocktakes`, { name, dueOn: addDays(today, 7) }),
            403,
            'an employee may not',
          );
          const res = ctx.expect.status(
            await mgr.post(`${I}/stocktakes`, {
              name,
              dueOn: addDays(today, ctx.rand.int(1, 30)),
              scope: { managerIds: [who.id] },
              recurrence,
            }),
            201,
          ).body;
          ctx.expect.match(res.reference, /^STK-\d{5,}$/, 'reference');
          ctx.expect.equal(
            [res.status, res.progress.total, res.progress.done],
            ['open', total, 0],
            'open, items',
          );
          return res as Json;
        },
      );
      const ref = st.reference as string;

      const items = await ctx.step('the custodian is told and sees only their items', async () => {
        await ctx.eventually(
          () => notificationsAbout(ctx, custodian, 'isms.stocktake.assigned', ref),
          (x) => x.length === 1,
          { label: 'the stocktake notification' },
        );
        const list = await everyItem(ctx, me, `${I}/stocktakes/${ref}/items`);
        ctx.expect.equal(list.length, total, 'their items');
        ctx.expect.truthy(
          list.every((i) => i.assignee?.id === who.id && i.canRecord),
          'every item is theirs to record',
        );
        // The to-do list is not paged: it holds 100 items at most (earliest due first), so it is complete below that.
        const todo = ctx.expect.ok(await me.get(`${I}/stocktake-items/mine`)).body.items as Json[];
        const mineHere = todo.filter((i) => i.stocktake?.reference === ref).length;
        if (todo.length < 100) ctx.expect.equal(mineHere, total, 'My items');
        ctx.expect.status(
          await other.get(`${I}/stocktakes/${ref}`),
          404,
          'another custodian does not see it',
        );
        ctx.expect.status(
          await other.post(`${I}/stocktakes/${ref}/items/${list[0]!.id}`, { result: 'confirmed' }),
          [403, 404],
          'nor records its items',
        );
        return list;
      });

      const results = new Map<string, Result>();
      for (const i of items)
        results.set(
          i.id,
          leftovers.some((l) => l.id === i.assetId)
            ? 'disposed'
            : ctx.rand.weighted([
                ['confirmed', 5],
                ['changed', 2],
                ['missing', 2],
                ['disposed', 1],
              ] as const),
        );
      const cancel = ctx.rand.bool(0.1);
      const pendingAtEnd = cancel ? 0 : ctx.rand.int(0, Math.min(2, items.length));

      await ctx.step('the custodian records their items', async () => {
        const toRecord = items.slice(0, items.length - pendingAtEnd);
        for (const i of toRecord) {
          const result = results.get(i.id)!;
          if (result === 'missing')
            ctx.expect.status(
              await me.post(`${I}/stocktakes/${ref}/items/${i.id}`, { result }),
              400,
              'missing needs a note',
            );
          const body =
            result === 'changed'
              ? { result, changes: { location: `Sim desk ${ctx.rand.int(1, 99)}` } }
              : result === 'missing' || result === 'disposed'
                ? { result, note: ctx.rand.sentence(2, 6) }
                : { result };
          if (ctx.rand.bool(0.1)) {
            ctx.tag('double record');
            const both = await Promise.all(
              [1, 2].map(() => me.post(`${I}/stocktakes/${ref}/items/${i.id}`, body)),
            );
            for (const r of both) ctx.expect.ok(r, 'recording the same result twice');
          } else
            ctx.expect.ok(await me.post(`${I}/stocktakes/${ref}/items/${i.id}`, body), `record ${result}`);
          if (result === 'changed') {
            const a = ctx.expect.ok(await mgr.get(`${I}/assets/${i.snapshot.number}`)).body;
            ctx.expect.equal(a.location, (body as Json).changes.location, 'the correction is applied');
          }
        }
        const s = ctx.expect.ok(await mgr.get(`${I}/stocktakes/${ref}`)).body;
        ctx.expect.equal(s.progress.done, toRecord.length, 'progress');
      });

      if (cancel) {
        ctx.tag('cancelled');
        await ctx.step('the asset manager cancels it', async () => {
          const res = ctx.expect.ok(await mgr.post(`${I}/stocktakes/${ref}/cancel`, {})).body;
          ctx.expect.equal(res.status, 'cancelled', 'status');
          for (const a of mine) {
            const now = ctx.expect.ok(await mgr.get(`${I}/assets/${a.number}`)).body;
            ctx.expect.equal(now.status, 'active', `${a.number} keeps its status`);
          }
          ctx.expect.status(
            await me.post(`${I}/stocktakes/${ref}/items/${items[0]!.id}`, { result: 'confirmed' }),
            409,
            'a cancelled stocktake takes no results',
          );
        });
        return;
      }

      if (pendingAtEnd)
        await ctx.step('signing off with items pending is refused', async () => {
          const early = ctx.expect.code(
            await sec.post(`${I}/stocktakes/${ref}/sign-off`, {}),
            'INVALID_STATE',
            409,
          );
          ctx.expect.equal(
            [early.body.error.details?.reason, early.body.error.details?.pending],
            ['itemsPending', pendingAtEnd],
            'reason, pending',
          );
          for (const i of items.slice(items.length - pendingAtEnd))
            ctx.expect.ok(
              await me.post(`${I}/stocktakes/${ref}/items/${i.id}`, {
                result: results.get(i.id),
                note: ctx.rand.sentence(2, 4),
                ...(results.get(i.id) === 'changed' ? { changes: { brand: 'Sim' } } : {}),
              }),
            );
        });

      await ctx.step('information security signs it off', async () => {
        ctx.expect.status(
          await mgr.post(`${I}/stocktakes/${ref}/sign-off`, {}),
          403,
          'the asset manager may not',
        );
        const note = ctx.rand.sentence(2, 6);
        let res;
        if (ctx.rand.bool(0.15)) {
          ctx.tag('double sign-off');
          const both = await Promise.all(
            [1, 2].map(() => sec.post(`${I}/stocktakes/${ref}/sign-off`, { note })),
          );
          res = ctx.expect.oneOk(both, 'one sign-off', [409]);
        } else res = ctx.expect.ok(await sec.post(`${I}/stocktakes/${ref}/sign-off`, { note }));
        ctx.expect.equal(
          [res.body.status, res.body.signOffNote, res.body.progress.done],
          ['signed_off', note, total],
          'signed off',
        );
        ctx.expect.status(
          await me.post(`${I}/stocktakes/${ref}/items/${items[0]!.id}`, { result: 'confirmed' }),
          409,
          'no results after the sign-off',
        );
      });

      await ctx.step('the register follows the results', async () => {
        for (const i of items) {
          const a = ctx.expect.ok(await mgr.get(`${I}/assets/${i.snapshot.number}`)).body;
          const result = results.get(i.id)!;
          const want = result === 'missing' ? 'missing' : result === 'disposed' ? 'disposed' : 'active';
          ctx.expect.equal(a.status, want, `${i.snapshot.number} (${result})`);
          if (want === 'active')
            ctx.expect.equal(a.lastVerifiedOn, today, `${i.snapshot.number} verified today`);
        }
        const csv = await sec.get(`${I}/stocktakes/${ref}/export.csv`, {
          query: { locale: ctx.rand.pick(LOCALES) },
        });
        ctx.expect.ok(csv, 'export');
        ctx.expect.equal(parseCsv(String(csv.body)).length >= total + 1, true, 'the export has every item');
      });

      if (recurrence === 'yearly')
        await ctx.step('next year’s stocktake is scheduled (and cancelled again)', async () => {
          const next = ctx.expect.ok(
            await mgr.get(`${I}/stocktakes`, { query: { status: 'scheduled', q: name, pageSize: 10 } }),
          ).body.items as Json[];
          ctx.expect.equal(next.length, 1, 'scheduled stocktakes');
          ctx.expect.equal(next[0]!.startOn > today, true, 'it starts later');
          ctx.expect.ok(await mgr.post(`${I}/stocktakes/${next[0]!.reference}/cancel`, {}), 'cancel it');
          ctx.tag('recurring');
        });
    });
  },
});

/* ───────────────────────────── isms-shared-account ───────────────────────────── */

const MEMBERS = ['employee1', 'employee2', 'employee3', 'employee4', 'dbuser3', 'dbuser4', 'accreviewer1'];

export const ismsSharedAccount = defineFlow({
  name: 'isms-shared-account',
  area: 'isms',
  description:
    'Shared account → custodian reviews members (password due) or a member is removed → custodian records the change',
  personas: ['infosec', 'ismsmgr', 'custodian', ...MEMBERS, 'dataowner'],
  async run(ctx) {
    const sec = ctx.as('infosec');
    const custodianName = ctx.personaOf(ctx.user('custodian').id)!;
    const cust = ctx.as('custodian');
    const sfx = ctx.rand.suffix();
    const today = todayIn();
    const members = ctx.rand.sample(MEMBERS, 2, 4);
    const outsider = 'dataowner';

    const acc = await ctx.step('information security registers the account', async () => {
      const body = {
        accountName: `svc-sim-${sfx}`,
        targetSystem: `Sim system ${sfx}`,
        custodianId: ctx.user('custodian').id,
        memberIds: members.map((m) => ctx.user(m).id),
        purpose: ctx.rand.sentence(3, 8),
      };
      ctx.expect.status(await ctx.as('ismsmgr').post(`${I}/accounts`, body), 403, 'an asset manager may not');
      const a = ctx.expect.status(await sec.post(`${I}/accounts`, body), 201).body;
      ctx.expect.match(a.reference, /^SHA-\d{5,}$/, 'reference');
      ctx.expect.equal(
        [(a.members as Json[]).length, a.passwordChange?.due],
        [members.length, false],
        'members, password due',
      );
      return a as Json;
    });
    const ref = acc.reference as string;

    await ctx.step('the custodian and the members see it, nobody else', async () => {
      const seen = ctx.expect.ok(await cust.get(`${I}/accounts/${ref}`)).body;
      ctx.expect.equal(
        [seen.viewer?.isCustodian, seen.viewer?.canRecordPassword, seen.viewer?.canManage],
        [true, true, false],
        'the custodian’s view',
      );
      ctx.expect.ok(await ctx.as(members[0]!).get(`${I}/accounts/${ref}`), 'a member sees it');
      ctx.expect.status(await ctx.as(outsider).get(`${I}/accounts/${ref}`), 404, 'an outsider does not');
      const list = ctx.expect.ok(await ctx.as(outsider).get(`${I}/accounts`, { query: { q: sfx } })).body;
      ctx.expect.equal(list.total, 0, 'an outsider’s list');
      ctx.expect.status(
        await ctx.as(members[0]!).post(`${I}/accounts/${ref}/password-changed`, { changedOn: today }),
        [403, 404],
        'a member may not record the password change',
      );
    });

    const how = ctx.rand.pick(['the custodian’s review', 'a member removed'] as const);
    ctx.tag(how);
    const kept = ctx.rand.sample(members, 0, members.length - 1);
    await ctx.step(`${how} makes the password due`, async () => {
      let res;
      if (how === 'a member removed') {
        const gone = members.find((m) => !kept.includes(m))!;
        ctx.expect.status(await sec.delete(`${I}/accounts/${ref}/members/${ctx.user(gone).id}`), [200, 204]);
        for (const m of members.filter((x) => x !== gone && !kept.includes(x))) kept.push(m);
        res = ctx.expect.ok(await sec.get(`${I}/accounts/${ref}`)).body;
      } else {
        ctx.expect.status(
          await cust.post(`${I}/accounts/${ref}/review`, { memberIds: [ctx.user(outsider).id] }),
          400,
          'keeping someone who is not a member',
        );
        res = ctx.expect.ok(
          await cust.post(`${I}/accounts/${ref}/review`, { memberIds: kept.map((m) => ctx.user(m).id) }),
        ).body;
        ctx.expect.equal(res.lastReviewedOn, today, 'reviewed today');
        ctx.expect.truthy(res.nextReviewOn > today, 'the next review is later');
      }
      ctx.expect.equal(
        (res.members as Json[])
          .filter((x) => x.active !== false)
          .map((x) => x.user.id)
          .sort(),
        kept.map((m) => ctx.user(m).id).sort(),
        'the members left',
      );
      ctx.expect.equal(
        [res.passwordChange?.due, res.passwordChange?.reason],
        [true, 'member_removed'],
        'password due',
      );
      const due = ctx.expect.ok(await sec.get(`${I}/accounts`, { query: { view: 'password', q: sfx } })).body
        .items as Json[];
      ctx.expect.find(due, (x) => x.reference === ref, 'the password-due list shows it');
    });

    await ctx.step('the custodian records the password change', async () => {
      ctx.expect.status(
        await cust.post(`${I}/accounts/${ref}/password-changed`, { changedOn: addDays(today, 3) }),
        400,
        'a change in the future',
      );
      const body = { changedOn: today, note: ctx.rand.sentence(2, 5) };
      if (ctx.rand.bool(0.15)) {
        ctx.tag('double record');
        const both = await Promise.all(
          [1, 2].map(() => cust.post(`${I}/accounts/${ref}/password-changed`, body)),
        );
        for (const r of both) ctx.expect.status(r, [200, 409], 'recording twice at once');
        ctx.expect.truthy(
          both.some((r) => r.status === 200),
          'one of them goes through',
        );
      } else ctx.expect.ok(await cust.post(`${I}/accounts/${ref}/password-changed`, body));
      const a = ctx.expect.ok(await cust.get(`${I}/accounts/${ref}`)).body;
      ctx.expect.equal([a.lastPasswordChangeOn, a.passwordChange?.due], [today, false], 'changed, not due');
      const events = ctx.expect.ok(await sec.get(`${I}/accounts/${ref}/events`, { query: { pageSize: 50 } }))
        .body.items as Json[];
      const kinds = events.map((e) => e.kind);
      for (const k of ['created', 'member_removed', 'password_changed'])
        ctx.expect.truthy(kinds.includes(k), `the history has ${k} (${kinds.join(', ')})`);
      ctx.expect.equal(
        kinds.filter((k) => k === 'password_changed').length,
        1,
        'one password change, one "password_changed" event (also for a double click)',
      );
      ctx.log(`custodian ${custodianName}`);
    });

    if (ctx.rand.bool(0.3))
      await ctx.step('information security retires the account', async () => {
        ctx.tag('retired');
        const res = ctx.expect.ok(await sec.patch(`${I}/accounts/${ref}`, { status: 'retired' })).body;
        ctx.expect.equal(res.status, 'retired', 'status');
      });
  },
});

/* ───────────────────────────── isms-account-review ───────────────────────────── */

type Decision = 'keep' | 'disable' | 'delete';

export const ismsAccountReview = defineFlow({
  name: 'isms-account-review',
  area: 'isms',
  description:
    'Account review → reviewer imports the accounts → keep/disable/delete → tickets → complete → returned or signed off',
  personas: ['infosec', 'ismsmgr', 'accreviewer', 'custodian'],
  timeoutMs: 200_000,
  async run(ctx) {
    const sec = ctx.as('infosec');
    const rv = ctx.as('accreviewer');
    const sfx = ctx.rand.suffix();
    const today = todayIn();
    const target = `Sim system ${sfx}`;
    const recurrence = ctx.rand.weighted([
      ['none', 3],
      ['quarterly', 1],
      ['yearly', 1],
    ] as const);

    const review = await ctx.step('information security starts a review for the reviewer', async () => {
      const body = { target, reviewerId: ctx.user('accreviewer').id, dueOn: addDays(today, 14), recurrence };
      ctx.expect.status(await ctx.as('ismsmgr').post(`${I}/reviews`, body), 403, 'an asset manager may not');
      const r = ctx.expect.status(await sec.post(`${I}/reviews`, body), 201).body;
      ctx.expect.match(r.reference, /^ACR-\d{5,}$/, 'reference');
      ctx.expect.equal([r.status, r.source], ['open', 'manual'], 'status, source');
      return r as Json;
    });
    const ref = review.reference as string;

    await ctx.step('the reviewer is told; others do not see it', async () => {
      await ctx.eventually(
        () => notificationsAbout(ctx, 'accreviewer', 'isms.review.assigned', ref),
        (x) => x.length === 1,
        { label: 'the review notification' },
      );
      ctx.expect.status(await ctx.as('custodian').get(`${I}/reviews/${ref}`), 404, 'another person');
    });

    const n = ctx.rand.int(2, 8);
    const accounts = Array.from({ length: n }, (_, i) => ({
      name: `sim_${sfx.replace(/[^a-z0-9]/gi, '')}_${i}`,
      user: ctx.rand.words(2),
      privilege: ctx.rand.pick(['admin', 'user']),
      state: ctx.rand.pick(['enabled', 'disabled']),
    }));
    const withBad = ctx.rand.bool(0.4);
    await ctx.step('the reviewer imports the system’s account list', async () => {
      const lines = [
        ['Account', 'User name', 'Privilege', 'Current state'],
        ...accounts.map((a) => [
          a.name,
          a.user,
          a.privilege === 'admin' ? 'Administrator' : 'User',
          a.state === 'enabled' ? 'Enabled' : 'Disabled',
        ]),
        ...(withBad
          ? [
              [accounts[0]!.name, 'again', 'User', 'Enabled'],
              ['', 'no account', 'User', 'Enabled'],
            ]
          : []),
      ];
      const csv = toCsv(lines);
      const dry = ctx.expect.ok(await rv.post(`${I}/reviews/${ref}/import`, { csv, dryRun: true })).body;
      ctx.expect.equal(
        [dry.error, dry.rows, dry.added, dry.skipped],
        [null, n + (withBad ? 2 : 0), n, withBad ? 2 : 0],
        'dry run: error, rows, added, skipped',
      );
      const empty = ctx.expect.ok(await rv.get(`${I}/reviews/${ref}/items`)).body;
      ctx.expect.equal(empty.total, 0, 'a dry run adds nothing');
      const real = ctx.expect.ok(await rv.post(`${I}/reviews/${ref}/import`, { csv, dryRun: false })).body;
      ctx.expect.equal(real.added, n, 'added');
      const r = ctx.expect.ok(await rv.get(`${I}/reviews/${ref}`)).body;
      ctx.expect.equal([r.source, r.progress.total], ['csv', n], 'source, accounts');
    });

    const items = ctx.expect.ok(await rv.get(`${I}/reviews/${ref}/items`, { query: { pageSize: 100 } })).body
      .items as Json[];
    const decisions = new Map<string, Decision>(
      items.map((i) => [
        i.id,
        ctx.rand.weighted([
          ['keep', 5],
          ['disable', 2],
          ['delete', 2],
        ] as const),
      ]),
    );
    const removals = items.filter((i) => decisions.get(i.id) !== 'keep');

    await ctx.step('the reviewer decides every account', async () => {
      ctx.expect.status(
        await ctx
          .as('custodian')
          .post(`${I}/reviews/${ref}/items/${items[0]!.id}/decision`, { decision: 'keep' }),
        [403, 404],
        'someone else may not decide',
      );
      const keep = items.filter((i) => decisions.get(i.id) === 'keep').map((i) => i.id);
      if (keep.length)
        ctx.expect.ok(
          await rv.post(`${I}/reviews/${ref}/decisions`, { itemIds: keep, decision: 'keep' }),
          'keep',
        );
      for (const i of removals)
        ctx.expect.ok(
          await rv.post(`${I}/reviews/${ref}/items/${i.id}/decision`, {
            decision: decisions.get(i.id),
            note: ctx.rand.sentence(2, 6),
          }),
          `${decisions.get(i.id)} ${i.accountName}`,
        );
      if (removals.length) {
        const early = ctx.expect.code(
          await rv.post(`${I}/reviews/${ref}/complete`, {}),
          'INVALID_STATE',
          409,
        );
        ctx.expect.equal(
          early.body.error.details?.pending,
          removals.length,
          'pending until the dates are entered',
        );
        ctx.expect.status(
          await rv.post(`${I}/reviews/${ref}/items/${removals[0]!.id}/decision`, {
            decision: decisions.get(removals[0]!.id),
            doneOn: addDays(today, 5),
          }),
          400,
          'a date in the future',
        );
      }
    });

    if (removals.length)
      await ctx.step('the reviewer raises tickets for the accounts to change', async () => {
        const twice = ctx.rand.bool(0.25);
        if (twice) ctx.tag('double raise tickets');
        const res = twice
          ? await Promise.all([1, 2].map(() => rv.post(`${I}/reviews/${ref}/tickets`, {})))
          : [await rv.post(`${I}/reviews/${ref}/tickets`, {})];
        for (const r of res) ctx.expect.ok(r, 'raise tickets');
        const raised = res.reduce((s, r) => s + (r.body.raised as number), 0);
        const failed = res.reduce((s, r) => s + (r.body.failed as number), 0);
        ctx.expect.equal(
          [raised, failed],
          [removals.length, 0],
          'tickets raised (all requests together), failed',
        );
        const tickets = ctx.expect.ok(
          await rv.get('/itsm/tickets', { query: { view: 'mine', q: target, pageSize: 100 } }),
        ).body.items as Json[];
        ctx.expect.equal(tickets.length, removals.length, 'tickets in the service desk');
        const again = ctx.expect.ok(await rv.post(`${I}/reviews/${ref}/tickets`, {})).body;
        ctx.expect.equal([again.raised, again.failed], [0, 0], 'raising again raises none');
        const listed = ctx.expect.ok(await rv.get(`${I}/reviews/${ref}/items`, { query: { pageSize: 100 } }))
          .body.items as Json[];
        for (const i of listed.filter((x) => decisions.get(x.id) !== 'keep'))
          ctx.expect.truthy(i.ticket?.reference, `${i.accountName} names its ticket`);
        // The accounts were changed: the reviewer enters the date.
        const byDecision = new Map<Decision, string[]>();
        for (const i of removals)
          byDecision.set(decisions.get(i.id)!, [...(byDecision.get(decisions.get(i.id)!) ?? []), i.id]);
        for (const [decision, itemIds] of byDecision)
          ctx.expect.ok(await rv.post(`${I}/reviews/${ref}/decisions`, { itemIds, decision, doneOn: today }));
      });

    const complete = async () => {
      let res;
      if (ctx.rand.bool(0.1)) {
        ctx.tag('double complete');
        const both = await Promise.all([1, 2].map(() => rv.post(`${I}/reviews/${ref}/complete`, {})));
        res = ctx.expect.oneOk(both, 'one completion', [409]);
      } else res = ctx.expect.ok(await rv.post(`${I}/reviews/${ref}/complete`, {}));
      ctx.expect.equal(res.body.status, 'completed', 'completed');
    };

    if (ctx.rand.bool(0.1)) {
      ctx.tag('cancelled');
      await ctx.step('information security cancels the review', async () => {
        ctx.expect.equal(
          ctx.expect.ok(await sec.post(`${I}/reviews/${ref}/cancel`, {})).body.status,
          'cancelled',
          'status',
        );
        ctx.expect.code(
          await rv.post(`${I}/reviews/${ref}/items/${items[0]!.id}/decision`, { decision: 'keep' }),
          'INVALID_STATE',
          409,
        );
      });
      return;
    }

    await ctx.step('the reviewer completes it', complete);
    await ctx.step('information security is told it is ready', async () => {
      await ctx.eventually(
        () => notificationsAbout(ctx, 'infosec', 'isms.review.ready', ref),
        (x) => x.length >= 1,
        { label: 'the ready notification' },
      );
    });

    if (ctx.rand.bool(0.25)) {
      ctx.tag('returned');
      await ctx.step('information security returns it; the reviewer changes a decision', async () => {
        const back = ctx.expect.ok(await sec.post(`${I}/reviews/${ref}/reopen`, {})).body;
        ctx.expect.equal(back.status, 'open', 'reopened');
        const it = items[0]!;
        ctx.expect.ok(
          await rv.post(`${I}/reviews/${ref}/items/${it.id}/decision`, {
            decision: decisions.get(it.id) === 'keep' ? 'disable' : 'keep',
            doneOn: today,
            note: 'Changed after the security review',
          }),
        );
        await complete();
      });
    }

    await ctx.step('information security signs it off', async () => {
      ctx.expect.status(await rv.post(`${I}/reviews/${ref}/sign-off`, {}), 403, 'the reviewer may not');
      const note = ctx.rand.sentence(2, 5);
      const res = ctx.expect.ok(await sec.post(`${I}/reviews/${ref}/sign-off`, { note })).body;
      ctx.expect.equal([res.status, res.signOffNote], ['signed_off', note], 'signed off');
      ctx.expect.code(
        await rv.post(`${I}/reviews/${ref}/items/${items[0]!.id}/decision`, {
          decision: 'delete',
          doneOn: today,
        }),
        'INVALID_STATE',
        409,
      );
      const csv = await rv.get(`${I}/reviews/${ref}/export.csv`, { query: { locale: 'en' } });
      ctx.expect.ok(csv, 'export');
      ctx.expect.truthy(String(csv.body).includes(target), 'the export names the system');
      for (const a of accounts)
        ctx.expect.truthy(String(csv.body).includes(a.name), `the export lists ${a.name}`);
    });

    if (recurrence !== 'none')
      await ctx.step('the next review is scheduled (and cancelled again)', async () => {
        const next = ctx.expect.ok(
          await sec.get(`${I}/reviews`, { query: { status: 'scheduled', q: target, pageSize: 10 } }),
        ).body.items as Json[];
        ctx.expect.equal(next.length, 1, 'scheduled reviews');
        ctx.expect.equal(next[0]!.reviewer?.id, ctx.user('accreviewer').id, 'the same reviewer');
        ctx.expect.ok(await sec.post(`${I}/reviews/${next[0]!.reference}/cancel`, {}), 'cancel it');
        ctx.tag(`recurring ${recurrence}`);
      });
  },
});
