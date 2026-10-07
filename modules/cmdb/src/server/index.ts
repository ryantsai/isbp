import { defineServerModule, localize, type RecordSummary, type StatusTone } from '@isbp/sdk/server';
import { asc, desc, inArray } from 'drizzle-orm';
import migrations from '../../migrations';
import { manifest } from '../manifest';
import type { CiStatus } from '../contracts';
import { formatCiNumber } from '../model';
import { aiTools } from './ai';
import { type RefRow, selectRefs } from './refs';
import { routes } from './routes';
import { cis } from './schema';
import { seedCmdb } from './seed';
import { CiService, ciSearchCondition } from './service';

const STATUS_TONE: Record<CiStatus, StatusTone> = {
  planned: 'info',
  in_use: 'success',
  maintenance: 'warning',
  retired: 'neutral',
};

/** A CI for the record registry (links and attachments): readable with `cmdb.cis.read`. */
function ciRecord(r: RefRow, locale: string, editable: boolean): RecordSummary {
  const reference = formatCiNumber(r.ci.number);
  return {
    id: r.ci.id,
    reference,
    title: r.ci.name,
    subtitle: localize(r.className, locale),
    status: { key: `cmdb.status.${r.ci.status}`, tone: STATUS_TONE[r.ci.status] },
    href: `/cmdb/${reference}`,
    editable,
  };
}

export default defineServerModule(manifest, {
  migrations,
  routes,

  events: {
    /** People who leave no longer own CIs: clear the owner (audited) so someone picks them up. */
    'core.user.offboarded': async (event, ctx) => {
      const { userId } = event.payload as { userId: string };
      await new CiService(ctx).releaseOwner(userId);
    },
  },

  ai: aiTools,

  /** Command palette: CIs by name or number, for people who can browse the CMDB. */
  search: async (query, ctx, auth, limit) => {
    if (!auth.can('cmdb.cis.read')) return [];
    const rows = await selectRefs(ctx.db).where(ciSearchCondition(query)).orderBy(asc(cis.name)).limit(limit);
    const locale = auth.user?.locale ?? 'en';
    return rows.map((r) => {
      const reference = formatCiNumber(r.ci.number);
      return {
        id: r.ci.id,
        type: 'ci',
        title: r.ci.name,
        subtitle: `${reference} · ${localize(r.className, locale)}`,
        href: `/cmdb/${reference}`,
        icon: r.classIcon,
      };
    });
  },

  records: {
    ci: {
      async resolve(ids, ctx, auth) {
        const valid = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
        if (!auth.can('cmdb.cis.read') || !valid.length) return [];
        const rows = await selectRefs(ctx.db).where(inArray(cis.id, valid));
        return rows.map((r) => ciRecord(r, auth.user?.locale ?? 'en', auth.can('cmdb.cis.manage')));
      },
      async search(query, ctx, auth, limit) {
        if (!auth.can('cmdb.cis.read')) return [];
        const rows = await selectRefs(ctx.db)
          .where(query.trim() ? ciSearchCondition(query) : undefined)
          .orderBy(query.trim() ? asc(cis.name) : desc(cis.updatedAt))
          .limit(limit);
        return rows.map((r) => ciRecord(r, auth.user?.locale ?? 'en', auth.can('cmdb.cis.manage')));
      },
    },
  },

  seed: seedCmdb,
});
