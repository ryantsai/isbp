import { workflowDefinitions, workflowVersions } from '@isbp/db/schema';
import type { Db } from '@isbp/sdk/server';
import { and, eq, isNull } from 'drizzle-orm';
import type { WorkflowEngine } from './engine';

/**
 * Installs each trigger's `defaultGraph` once, as a published system definition named
 * `<trigger>.default` — the trigger's default unless an admin already chose another. Admins can edit
 * and republish it afterwards; it is never overwritten (idempotent, runs on every migrate).
 */
export async function installDefaultWorkflows(db: Db, engine: WorkflowEngine) {
  for (const { def } of engine.triggers()) {
    if (!def.defaultGraph) continue;
    const key = `${def.key}.default`;
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: workflowDefinitions.id })
        .from(workflowDefinitions)
        .where(eq(workflowDefinitions.key, key));
      if (existing) return;
      const [current] = await tx
        .select({ id: workflowDefinitions.id })
        .from(workflowDefinitions)
        .where(
          and(
            eq(workflowDefinitions.triggerKey, def.key),
            eq(workflowDefinitions.isDefault, true),
            isNull(workflowDefinitions.archivedAt),
          ),
        );
      const [row] = await tx
        .insert(workflowDefinitions)
        .values({
          key,
          // An i18n key: the admin UI shows it translated until someone renames the definition.
          name: def.name,
          description: 'Installed from the module manifest. Edit and publish to change it.',
          triggerKey: def.key,
          isDefault: !current,
          isSystem: true,
          draft: def.defaultGraph!,
          publishedVersion: 1,
        })
        .returning();
      await tx
        .insert(workflowVersions)
        .values({ definitionId: row!.id, version: 1, graph: def.defaultGraph! });
    });
  }
}
