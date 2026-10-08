import type { AiToolHandler, AuthContext } from '@isbp/sdk/server';
import { changeSetHref, changeSetReference } from '../contracts';
import { toolInputs } from '../tool-inputs';
import { ChangeSetService } from './change-sets';
import type { ChangeSetItemRow, ChangeSetRow } from './schema';

/*
 * The assistant's AI tools, in the registry for the in-app agent and for outside agents over MCP. They read the
 * customisation kinds and build change sets; none of them applies anything.
 */

/** A change set as tools return it: status, link and every item's latest dry run. */
export function changeSetResult(row: ChangeSetRow, items: ChangeSetItemRow[]) {
  return {
    changeSet: {
      id: row.id,
      reference: changeSetReference(row.number),
      title: row.title,
      status: row.status,
      href: changeSetHref(row.id),
      itemCount: items.length,
    },
    items: items.map((i) => ({
      id: i.id,
      ref: i.ref,
      kind: i.kind,
      op: i.op,
      targetId: i.targetId,
      label: i.label,
      check: i.check
        ? {
            ok: i.check.ok,
            needsApprover: i.check.needsApprover,
            code: i.check.code,
            message: i.check.message,
            issues: i.check.issues.slice(0, 15),
          }
        : null,
    })),
    note:
      row.status === 'draft'
        ? 'This is a draft: nothing is live until it is applied (assistant.apply_change_set, which the person confirms) ' +
          'or approved in a review (assistant.request_review). Items with check.ok=false must be fixed; ' +
          'needsApprover=true items need someone who holds the permission.'
        : `The change set is ${row.status}.`,
  };
}

async function result(service: ChangeSetService, id: string, auth: AuthContext) {
  const row = await service.load(id, auth);
  return changeSetResult(row, await service.itemsOf(id));
}

export const aiTools: Record<string, AiToolHandler> = {
  'assistant.list_kinds': async (_input, ctx, auth) => ({
    kinds: ctx.customizations.kinds(auth).map((k) => ({
      kind: k.kind,
      description: k.description,
      operations: k.operations,
      canApply: k.canApply,
    })),
  }),

  'assistant.describe_kind': async (input, ctx, auth) => {
    const { kind } = toolInputs.describeKind.parse(input);
    const d = await ctx.customizations.describe(kind, auth);
    return {
      kind: d.kind.kind,
      description: d.kind.description,
      operations: d.kind.operations,
      canApply: d.kind.canApply,
      schema: d.schema,
      guide: d.guide,
    };
  },

  'assistant.list_objects': async (input, ctx, auth) => {
    const q = toolInputs.listObjects.parse(input);
    return {
      items: await ctx.customizations.list(
        q.kind,
        { q: q.query, limit: q.limit, includeArchived: q.includeArchived },
        auth,
      ),
    };
  },

  'assistant.get_object': async (input, ctx, auth) => {
    const q = toolInputs.getObject.parse(input);
    const obj = await ctx.customizations.get(q.kind, q.id, auth);
    return obj ?? { error: 'not_found' };
  },

  'assistant.propose_change': async (input, ctx, auth) => {
    const q = toolInputs.proposeChange.parse(input);
    const service = new ChangeSetService(ctx);
    const { changeSet, item } = await service.propose(
      q.changeSetId ?? null,
      {
        ref: q.ref,
        kind: q.kind,
        op: q.op,
        targetId: q.targetId ?? null,
        label: q.label,
        value: q.value,
        note: q.note,
      },
      auth,
    );
    return {
      item: { id: item.id, ref: item.ref, label: item.label },
      ...(await result(service, changeSet.id, auth)),
    };
  },

  'assistant.remove_change': async (input, ctx, auth) => {
    const q = toolInputs.removeChange.parse(input);
    const service = new ChangeSetService(ctx);
    await service.removeItem(q.changeSetId, q.item, auth);
    return result(service, q.changeSetId, auth);
  },

  'assistant.get_change_set': async (input, ctx, auth) => {
    const q = toolInputs.getChangeSet.parse(input);
    return result(new ChangeSetService(ctx), q.changeSetId, auth);
  },

  'assistant.apply_change_set': async (input, ctx, auth) => {
    const q = toolInputs.applyChangeSet.parse(input);
    const service = new ChangeSetService(ctx);
    // The registry only runs this destructive tool once the person confirmed it, archives and deletes included.
    await service.apply(q.changeSetId, { confirm: true }, auth);
    return result(service, q.changeSetId, auth);
  },

  'assistant.rollback_change_set': async (input, ctx, auth) => {
    const q = toolInputs.rollbackChangeSet.parse(input);
    const service = new ChangeSetService(ctx);
    await service.rollback(q.changeSetId, { confirm: true, reason: q.reason }, auth);
    return result(service, q.changeSetId, auth);
  },

  'assistant.request_review': async (input, ctx, auth) => {
    const q = toolInputs.requestReview.parse(input);
    const service = new ChangeSetService(ctx);
    await service.submit(q.changeSetId, { note: q.note }, auth);
    return result(service, q.changeSetId, auth);
  },

  'assistant.update_change_set': async (input, ctx, auth) => {
    const q = toolInputs.updateChangeSet.parse(input);
    const service = new ChangeSetService(ctx);
    await service.update(q.changeSetId, { title: q.title, summary: q.summary }, auth);
    return result(service, q.changeSetId, auth);
  },
};
