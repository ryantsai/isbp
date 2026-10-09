import { workflowDefinitions } from '@isbp/db/schema';
import { walkSteps } from '@isbp/sdk';
import type { ModuleContext } from '@isbp/sdk/server';
import { eq } from 'drizzle-orm';
import { getKernel } from '../kernel-ref';

/**
 * The form fields each approval step's approvers come from, for the steps whose approvers all come from answers
 * (`data.<key>`). The dry run ("who will approve this?") finds nobody while such an answer is empty, which looks the
 * same as nobody being able to approve; the preview says which answer it waits for instead. Steps are keyed by id.
 */
export async function approverFields(
  ctx: ModuleContext,
  definitionId: string,
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const [def] = await ctx.db
    .select({ publishedVersion: workflowDefinitions.publishedVersion })
    .from(workflowDefinitions)
    .where(eq(workflowDefinitions.id, definitionId));
  if (!def || def.publishedVersion === null) return out;
  const graph = await getKernel().workflows.graph(definitionId, def.publishedVersion);
  for (const { step } of walkSteps(graph.steps)) {
    if (step.type !== 'approval' || !step.approvers.length) continue;
    const keys = step.approvers.map((rule) =>
      rule.type === 'fact' && rule.fact.startsWith('data.') ? rule.fact.slice('data.'.length) : null,
    );
    if (keys.every((k): k is string => Boolean(k))) out.set(step.id, keys);
  }
  return out;
}
