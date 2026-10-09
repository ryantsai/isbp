import { myWorkQuerySchema, myWorkSchema, workCountsSchema } from '@isbp/contracts';
import type { ModuleRouter } from '@isbp/sdk/server';
import { getKernel } from '../kernel-ref';

/** My work: everything waiting for the signed-in person, from every module's `manifest.work` sources. */
export function workRoutes(app: ModuleRouter) {
  const tags = ['My work'];

  app.get(
    '/me/work',
    {
      schema: {
        tags,
        summary:
          'Everything waiting for me (approvals, to-dos, reviews, tasks), by source, soonest due first',
        querystring: myWorkQuerySchema,
        response: { 200: myWorkSchema },
      },
    },
    async (req) => {
      const sections = await getKernel().work.collect(req.auth, { limit: req.query.limit });
      const tasks = sections.filter((s) => s.kind === 'task').reduce((n, s) => n + s.count, 0);
      const total = sections.filter((s) => s.kind !== 'task').reduce((n, s) => n + s.count, 0);
      return { sections, total, tasks };
    },
  );

  app.get(
    '/me/work/counts',
    {
      schema: {
        tags,
        summary: 'How much is waiting for me, by kind (the badge counts everything but tasks)',
        response: { 200: workCountsSchema },
      },
    },
    async (req) => getKernel().work.counts(req.auth),
  );
}
