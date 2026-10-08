import { formSubmissions, forms, formVersions, portalItems } from '@isbp/db/schema';
import { formatRequestNumber } from '@isbp/contracts';
import type {
  Db,
  FormsService,
  FormSubmissionInfo,
  ModuleManifest,
  PortalItem,
  PortalService,
} from '@isbp/sdk/server';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { publicFormSchema } from './process-actions';

/** `ctx.portal`: module records in "My requests" (`core.portal_items`). */
export function createPortalService(db: Db, manifest: ModuleManifest): PortalService {
  return {
    async track(item: PortalItem, opts = {}) {
      if (!item.kind.startsWith(`${manifest.id}.`))
        throw new Error(`[${manifest.id}] portal item kind "${item.kind}" must start with "${manifest.id}."`);
      const people = [...new Set(item.people.filter((p): p is string => !!p))];
      const values = {
        kind: item.kind,
        entityId: item.id,
        moduleId: manifest.id,
        reference: item.reference,
        title: item.title,
        state: item.state,
        statusKey: item.statusKey,
        tone: item.tone ?? null,
        href: item.href,
        icon: item.icon ?? null,
        people,
        ...(item.createdAt ? { createdAt: item.createdAt } : {}),
      };
      const {
        kind: _k,
        entityId: _e,
        createdAt: _c,
        ...update
      } = values as typeof values & { createdAt?: Date };
      await (opts.tx ?? db)
        .insert(portalItems)
        .values(values)
        .onConflictDoUpdate({
          target: [portalItems.kind, portalItems.entityId],
          set: { ...update, updatedAt: new Date() },
        });
    },
    async untrack(kind, id, opts = {}) {
      await (opts.tx ?? db)
        .delete(portalItems)
        .where(and(eq(portalItems.kind, kind), eq(portalItems.entityId, id)));
    },
  };
}

/** `ctx.forms`: read Phase 1 form submissions and report a module's fulfilment progress on them. */
export function createFormsService(db: Db, manifest: ModuleManifest): FormsService {
  return {
    async submission(id): Promise<FormSubmissionInfo | null> {
      const [row] = await db
        .select({ sub: formSubmissions, form: forms, schema: formVersions.schema })
        .from(formSubmissions)
        .innerJoin(forms, eq(forms.id, formSubmissions.formId))
        .innerJoin(
          formVersions,
          and(
            eq(formVersions.formId, formSubmissions.formId),
            eq(formVersions.version, formSubmissions.version),
          ),
        )
        .where(eq(formSubmissions.id, id));
      if (!row) return null;
      return {
        id: row.sub.id,
        number: row.sub.number,
        reference: formatRequestNumber(row.sub.number),
        form: {
          id: row.form.id,
          key: row.form.key,
          name: row.form.name,
          icon: row.form.icon,
          category: row.form.category,
        },
        version: row.sub.version,
        // A form's process actions (with their sealed secrets) stay with the platform.
        schema: publicFormSchema(row.schema),
        data: row.sub.data,
        submittedBy: row.sub.submittedBy,
        status: row.sub.status,
        createdAt: row.sub.createdAt,
      };
    },
    async published() {
      const rows = await db
        .select()
        .from(forms)
        .where(and(isNotNull(forms.publishedVersion), isNull(forms.archivedAt), eq(forms.active, true)));
      return rows.map((f) => ({
        key: f.key,
        name: f.name,
        icon: f.icon,
        category: f.category,
        hasApproval: Boolean(f.workflowDefinitionId),
      }));
    },
    async setFulfilment(submissionId, fulfilment, opts = {}) {
      await (opts.tx ?? db)
        .update(formSubmissions)
        .set({
          fulfilment: fulfilment
            ? { ...fulfilment, moduleId: manifest.id, updatedAt: new Date().toISOString() }
            : null,
        })
        .where(eq(formSubmissions.id, submissionId));
    },
  };
}
