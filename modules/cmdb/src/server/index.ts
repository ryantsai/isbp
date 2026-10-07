import { defineServerModule, localize } from '@isbp/sdk/server';
import { asc } from 'drizzle-orm';
import migrations from '../../migrations';
import { manifest } from '../manifest';
import { formatCiNumber } from '../model';
import { aiTools } from './ai';
import { selectRefs } from './refs';
import { routes } from './routes';
import { cis } from './schema';
import { seedCmdb } from './seed';
import { CiService, ciSearchCondition } from './service';

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

  seed: seedCmdb,
});
