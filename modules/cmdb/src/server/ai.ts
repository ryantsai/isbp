import { type AiToolHandler, type AuthContext, localize } from '@isbp/sdk/server';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { formatCiNumber, impactChildDirection, MAX_IMPACT_DEPTH, relationshipLabel } from '../model';
import type { CiRefDto } from './refs';
import { selectSummaries, toSummary } from './refs';
import { cis } from './schema';
import { CiService, ciSearchCondition } from './service';

const href = (number: number) => `/cmdb/${formatCiNumber(number)}`;
const locale = (auth: AuthContext) => auth.user?.locale ?? 'en';

/** A CI as tools return it: plain strings a model can quote, plus a link for the UI. */
function compact(ci: CiRefDto, auth: AuthContext) {
  return {
    id: ci.id,
    number: ci.reference,
    name: ci.name,
    class: localize(ci.class.name, locale(auth)),
    classKey: ci.class.key,
    status: ci.status,
    environment: ci.environment,
    criticality: ci.criticality,
    href: href(ci.number),
  };
}

const findInput = z.object({
  query: z.string(),
  classKey: z.string().optional(),
  limit: z.number().int().default(10),
});
const getInput = z.object({ id: z.uuid().optional(), number: z.string().optional() });
const impactInput = z.object({ ciId: z.uuid(), depth: z.number().int().default(3) });

/** Handlers of `manifest.ai.tools` (input already validated against the manifest schemas). */
export const aiTools: Record<string, AiToolHandler> = {
  'cmdb.find_cis': async (input, ctx, auth) => {
    const { query, classKey, limit } = findInput.parse(input);
    const rows = await selectSummaries(ctx.db)
      .where(and(ciSearchCondition(query), classKey ? eq(cis.classKey, classKey) : undefined))
      .orderBy(asc(cis.name))
      .limit(Math.min(25, limit));
    return rows.map((r) => compact(toSummary(r), auth));
  },

  'cmdb.get_ci': async (input, ctx, auth) => {
    const { id, number } = getInput.parse(input);
    const svc = new CiService(ctx);
    const ci = await svc.detail(id ?? number!, false);
    const relations = await svc.relations(ci.id);
    return {
      ...compact(ci, auth),
      description: ci.description,
      tags: ci.tags,
      owner: ci.owner && { id: ci.owner.id, name: ci.owner.displayName },
      supportGroup: ci.supportGroup,
      department: ci.department,
      updatedAt: ci.updatedAt,
      relationshipCount: relations.length,
      relationships: relations.slice(0, 50).map((r) => ({
        relationshipId: r.id,
        type: r.type,
        direction: r.direction,
        /** "<this CI> <label> <other CI>", e.g. "depends on", "used by". */
        label: r.label,
        ci: compact(r.ci, auth),
      })),
    };
  },

  'cmdb.get_impact': async (input, ctx, auth) => {
    const { ciId, depth } = impactInput.parse(input);
    const result = await new CiService(ctx).impact(ciId, Math.min(MAX_IMPACT_DEPTH, depth));
    const node = (direction: 'impacted' | 'dependsOn') => (n: (typeof result.impacted)[number]) => ({
      ...compact(n.ci, auth),
      depth: n.depth,
      /** How it is linked to its parent (the CI one level closer): "<this CI> <via> <parent>". */
      via: relationshipLabel(n.edgeType, impactChildDirection(n.edgeType, direction)),
      parentId: n.parentId,
      isBusinessService: n.isService,
    });
    return {
      ci: compact(result.root, auth),
      depth: result.depth,
      impacted: result.impacted.map(node('impacted')),
      dependsOn: result.dependsOn.map(node('dependsOn')),
      impactedBusinessServices: result.impactedServices,
      truncated: result.truncated,
    };
  },
};
