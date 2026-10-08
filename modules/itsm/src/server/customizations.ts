/**
 * Customisation kinds of the service desk: categories, SLA policies and service catalog items, applied with the
 * configuration service the settings pages use.
 */
import { forms, groups } from '@isbp/db/schema';
import {
  type Condition,
  CONDITION_OPS,
  type CustomizationHandler,
  type CustomizationIssue,
  likePattern,
  localize,
  type LocalizedText,
  type ModuleContext,
} from '@isbp/sdk/server';
import { and, asc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import en from '../../messages/en.json';
import ja from '../../messages/ja-JP.json';
import zh from '../../messages/zh-TW.json';
import {
  channelSchema,
  DEFAULT_PAUSE_STATUSES,
  ticketStatusSchema,
  ticketTypeSchema,
  upsertCatalogItemSchema,
  upsertCategorySchema,
  upsertSlaPolicySchema,
} from '../contracts';
import { invalidateLookups } from './lookups';
import { businessCalendars, catalogItems, categories, slaPolicies } from './schema';
import { services } from './services';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SETTINGS = '/itsm/settings';
const EVERYONE = 'everyone';
const TICKET_TYPES = ticketTypeSchema.options;
const PRIORITIES = ['1', '2', '3', '4'] as const;

const CATALOGS = { en, 'zh-TW': zh as typeof en, 'ja-JP': ja as typeof en };
/** Catalog text in every language. */
const text = (pick: (c: typeof en) => string): LocalizedText => ({
  en: pick(CATALOGS.en),
  'zh-TW': pick(CATALOGS['zh-TW']),
  'ja-JP': pick(CATALOGS['ja-JP']),
});

/** Stands in for an id in examples when there is nothing live to point at. */
const SAMPLE_ID = '0190a0a0-0000-7000-8000-000000000001';

const nameIn = (name: LocalizedText, locale: string | undefined) => localize(name, locale ?? 'en');

async function groupList(ctx: ModuleContext) {
  return ctx.db
    .select({ id: groups.id, name: groups.name })
    .from(groups)
    .where(ne(groups.key, EVERYONE))
    .orderBy(asc(groups.name))
    .limit(200);
}

async function groupExists(ctx: ModuleContext, id: string) {
  return Boolean((await ctx.db.select({ id: groups.id }).from(groups).where(eq(groups.id, id)))[0]);
}

/** Every category with its path ("Network › VPN"), read through `ctx.db` (fresh inside a change set). */
async function categoryTree(ctx: ModuleContext) {
  const rows = await ctx.db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.key));
  const byId = new Map(rows.map((r) => [r.id, r]));
  /** The category and its ancestors, nearest first. */
  const chain = (id: string) => {
    const out: string[] = [];
    let p = byId.get(id);
    while (p && !out.includes(p.id)) {
      out.push(p.id);
      p = p.parentId ? byId.get(p.parentId) : undefined;
    }
    return out;
  };
  const path = (id: string) =>
    chain(id)
      .reverse()
      .map((a) => localize(byId.get(a)!.name, 'en'))
      .join(' › ');
  return { rows, byId, chain, path };
}

/* ───────────────────────────── itsm.category ───────────────────────────── */

const cat = upsertCategorySchema.shape;

/** A category without `active`: an inactive category is an archived one. */
export const categoryValueSchema = z.object({
  key: cat.key.describe(
    'Unique key: lower-case letters, digits and dashes. SLA conditions (ticket.categoryKey) and integrations use it',
  ),
  name: cat.name.describe('Name per language: { "en", "zh-TW", "ja-JP" } (at least one)'),
  parentId: z
    .uuid()
    .nullable()
    .default(null)
    .describe('Parent category id, or null for a top-level category'),
  ticketTypes: cat.ticketTypes.describe('Ticket types the category is offered for'),
  defaultGroupId: z
    .uuid()
    .nullable()
    .default(null)
    .describe('Group new tickets of this category are routed to, or null'),
  sortOrder: cat.sortOrder.describe('Order among its siblings (lower first)'),
});
export type CategoryValue = z.infer<typeof categoryValueSchema>;

type CategoryRow = typeof categories.$inferSelect;

async function categoryRow(ctx: ModuleContext, id: string): Promise<CategoryRow | null> {
  if (!UUID_RE.test(id)) return null;
  const [row] = await ctx.db.select().from(categories).where(eq(categories.id, id));
  return row ?? null;
}

/** `itsm.category`: a ticket category, live on apply; archiving deactivates it. */
export const categoryCustomization: CustomizationHandler<CategoryValue> = {
  committed: () => invalidateLookups(),
  schema: categoryValueSchema,

  async guide(ctx) {
    const [tree, teams] = await Promise.all([categoryTree(ctx), groupList(ctx)]);
    return {
      instructions: [
        'A category classifies tickets of the given types and can route new ones to a default group. Categories form a tree through parentId; the path ("Network › VPN") is built from the names.',
        'Give the name in every language people use (en, zh-TW, ja-JP). The key is permanent in practice: SLA policy conditions match on ticket.categoryKey and integrations map categories, so pick a short, stable one.',
        'Applying makes the category available at once. Archive deactivates it (existing tickets keep it); restore activates it again.',
      ].join('\n'),
      reference: {
        categories: tree.rows.map((r) => ({
          id: r.id,
          key: r.key,
          path: tree.path(r.id),
          parentId: r.parentId,
          ticketTypes: r.ticketTypes,
          active: r.active,
        })),
        groups: teams,
        ticketTypes: TICKET_TYPES,
      },
      examples: [
        {
          description: 'A VPN category under Network, routed to the network team',
          value: {
            key: 'network-vpn',
            name: { en: 'VPN', 'zh-TW': 'VPN', 'ja-JP': 'VPN' },
            parentId: tree.rows.find((r) => !r.parentId)?.id ?? SAMPLE_ID,
            ticketTypes: ['incident', 'service_request'],
            defaultGroupId: teams[0]?.id ?? null,
            sortOrder: 10,
          },
        },
      ],
    };
  },

  async list({ q, limit, includeArchived }, ctx, auth) {
    const pattern = q ? likePattern(q) : null;
    const rows = await ctx.db
      .select()
      .from(categories)
      .where(
        and(
          includeArchived ? undefined : eq(categories.active, true),
          pattern
            ? or(ilike(categories.key, pattern), sql`${categories.name}::text ilike ${pattern}`)
            : undefined,
        ),
      )
      .orderBy(asc(categories.sortOrder), asc(categories.key))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      label: nameIn(r.name, auth.user?.locale),
      description: r.key,
      archived: !r.active,
      href: SETTINGS,
    }));
  },

  async get(id, ctx, auth) {
    const r = await categoryRow(ctx, id);
    if (!r) return null;
    return {
      id: r.id,
      label: nameIn(r.name, auth.user?.locale),
      description: r.key,
      archived: !r.active,
      href: SETTINGS,
      value: {
        key: r.key,
        name: r.name,
        parentId: r.parentId,
        ticketTypes: r.ticketTypes,
        defaultGroupId: r.defaultGroupId,
        sortOrder: r.sortOrder,
      },
    };
  },

  async check({ op, id, value }, ctx) {
    if ((op !== 'create' && op !== 'update') || !value) return [];
    const issues: CustomizationIssue[] = [];
    const tree = await categoryTree(ctx);
    if (tree.rows.some((r) => r.key === value.key && r.id !== id))
      issues.push({ path: 'key', message: 'A category with this key exists', code: 'duplicate_key' });
    if (value.parentId) {
      if (!tree.byId.has(value.parentId))
        issues.push({ path: 'parentId', message: 'Unknown parent category', code: 'unknown_parent' });
      else if (id && tree.chain(value.parentId).includes(id))
        issues.push({
          path: 'parentId',
          message: 'A category cannot be moved under itself',
          code: 'invalid_parent',
        });
    }
    if (value.defaultGroupId && !(await groupExists(ctx, value.defaultGroupId)))
      issues.push({ path: 'defaultGroupId', message: 'Unknown group', code: 'unknown_group' });
    return issues;
  },

  async apply({ op, id, value }, ctx) {
    const config = services(ctx).config;
    switch (op) {
      case 'create':
        return { id: (await config.createCategory({ ...value!, active: true })).id };
      case 'update':
        await config.updateCategory(id!, value!);
        return { id: id! };
      default:
        await config.updateCategory(id!, { active: op === 'restore' });
        return { id: id! };
    }
  },
};

/* ───────────────────────────── itsm.sla-policy ───────────────────────────── */

const pol = upsertSlaPolicySchema.shape;

/** Facts an SLA condition can test (see `slaFacts`). */
const SLA_FACTS = {
  'ticket.type': `one of ${TICKET_TYPES.join(', ')}`,
  'ticket.priority': '1 (critical) … 4 (low)',
  'ticket.impact': '1 (high) … 3 (low)',
  'ticket.urgency': '1 (high) … 3 (low)',
  'ticket.categoryKey': 'the key of the ticket’s category, or null',
  'ticket.major': 'true for a major incident',
  'ticket.channel': `one of ${channelSchema.options.join(', ')}`,
} as const;

/** A policy without `active`: an inactive policy is an archived one. */
export const slaPolicyValueSchema = z.object({
  name: z.string().trim().min(1).max(200).describe('Policy name'),
  description: z.string().trim().max(1000).nullable().default(null).describe('What the policy is for'),
  ticketTypes: pol.ticketTypes.describe('Ticket types the policy applies to'),
  condition: pol.condition
    .default(null)
    .describe(
      'Extra condition on ticket facts (see the guide), e.g. { "fact": "ticket.categoryKey", "op": "eq", "value": "network-vpn" }; null = every ticket of these types',
    ),
  targets: pol.targets.describe(
    'Targets for every priority "1" … "4", in business minutes: { responseMinutes, resolutionMinutes }',
  ),
  calendarId: pol.calendarId.describe('Business calendar the targets are measured on'),
  pauseStatuses: pol.pauseStatuses
    .default([...DEFAULT_PAUSE_STATUSES])
    .describe('Ticket statuses that pause the resolution timer'),
  warnAt: pol.warnAt.default(0.75).describe('Warn the assignee when this share of a target has passed'),
  sortOrder: pol.sortOrder
    .default(100)
    .describe(
      'Evaluation order: the first active policy (lowest first) whose types and condition match applies',
    ),
});
export type SlaPolicyValue = z.infer<typeof slaPolicyValueSchema>;

type PolicyRow = typeof slaPolicies.$inferSelect;

async function policyRow(ctx: ModuleContext, id: string): Promise<PolicyRow | null> {
  if (!UUID_RE.test(id)) return null;
  const [row] = await ctx.db.select().from(slaPolicies).where(eq(slaPolicies.id, id));
  return row ?? null;
}

const policyValue = (p: PolicyRow): SlaPolicyValue => ({
  name: p.name,
  description: p.description,
  ticketTypes: p.ticketTypes,
  condition: p.condition ?? null,
  targets: p.targets as SlaPolicyValue['targets'],
  calendarId: p.calendarId,
  pauseStatuses: p.pauseStatuses,
  warnAt: p.warnAt,
  sortOrder: p.sortOrder,
});

/** Category keys a condition compares `ticket.categoryKey` with. */
function categoryKeysOf(c: Condition | null): string[] {
  if (!c) return [];
  if ('all' in c) return c.all.flatMap(categoryKeysOf);
  if ('any' in c) return c.any.flatMap(categoryKeysOf);
  if ('not' in c) return categoryKeysOf(c.not);
  if (c.fact !== 'ticket.categoryKey') return [];
  return (Array.isArray(c.value) ? c.value : [c.value]).filter((v): v is string => typeof v === 'string');
}

function factsOf(c: Condition | null): string[] {
  if (!c) return [];
  if ('all' in c) return c.all.flatMap(factsOf);
  if ('any' in c) return c.any.flatMap(factsOf);
  if ('not' in c) return factsOf(c.not);
  return [c.fact];
}

async function calendarList(ctx: ModuleContext) {
  return ctx.db
    .select({
      id: businessCalendars.id,
      name: businessCalendars.name,
      timezone: businessCalendars.timezone,
      alwaysOpen: businessCalendars.alwaysOpen,
    })
    .from(businessCalendars)
    .orderBy(asc(businessCalendars.name));
}

const slaText = (c: typeof en) => c.customizations.templates.slaTargets;

/** `itsm.sla-policy`: an SLA policy, live for tickets raised afterwards; archiving deactivates it. */
export const slaPolicyCustomization: CustomizationHandler<SlaPolicyValue> = {
  committed: () => invalidateLookups(),
  schema: slaPolicyValueSchema,

  async guide(ctx) {
    const [calendars, tree] = await Promise.all([calendarList(ctx), categoryTree(ctx)]);
    return {
      instructions: [
        'An SLA policy sets response and resolution targets per priority (P1 critical … P4 low) for some ticket types. When a ticket is raised, the first active policy in sortOrder whose ticketTypes include its type and whose condition holds starts its timers; changes apply to tickets raised afterwards.',
        'Targets are business minutes on the calendar (a 24×7 calendar counts wall-clock time); every priority needs both targets. The resolution timer pauses in pauseStatuses; the assignee is warned at warnAt of the target.',
        `A condition is { fact, op, value } or { all: [...] } / { any: [...] } / { not: ... }; ops: ${CONDITION_OPS.join(', ')}. Facts are listed in \`facts\`; ticket.categoryKey compares category keys. Put narrower policies first (lower sortOrder).`,
        'Archive deactivates the policy (running timers keep their targets); restore activates it again.',
      ].join('\n'),
      reference: {
        facts: SLA_FACTS,
        priorities: { 1: 'P1 critical', 2: 'P2 high', 3: 'P3 moderate', 4: 'P4 low' },
        calendars,
        categories: tree.rows.filter((r) => r.active).map((r) => ({ key: r.key, path: tree.path(r.id) })),
        ticketTypes: TICKET_TYPES,
        statuses: ticketStatusSchema.options,
        defaultPauseStatuses: DEFAULT_PAUSE_STATUSES,
      },
      examples: [
        {
          description: 'Faster targets for VPN incidents, around the clock',
          value: {
            name: 'VPN incidents',
            description: 'Remote workers depend on the VPN',
            ticketTypes: ['incident'],
            condition: { fact: 'ticket.categoryKey', op: 'eq', value: 'network-vpn' },
            targets: {
              '1': { responseMinutes: 15, resolutionMinutes: 120 },
              '2': { responseMinutes: 30, resolutionMinutes: 240 },
              '3': { responseMinutes: 120, resolutionMinutes: 1440 },
              '4': { responseMinutes: 480, resolutionMinutes: 4320 },
            },
            calendarId: calendars[0]?.id ?? SAMPLE_ID,
            pauseStatuses: [...DEFAULT_PAUSE_STATUSES],
            warnAt: 0.75,
            sortOrder: 10,
          },
        },
      ],
    };
  },

  async list({ q, limit, includeArchived }, ctx) {
    const pattern = q ? likePattern(q) : null;
    const rows = await ctx.db
      .select()
      .from(slaPolicies)
      .where(
        and(
          includeArchived ? undefined : eq(slaPolicies.active, true),
          pattern ? or(ilike(slaPolicies.name, pattern), ilike(slaPolicies.description, pattern)) : undefined,
        ),
      )
      .orderBy(asc(slaPolicies.sortOrder), asc(slaPolicies.createdAt))
      .limit(limit);
    return rows.map((p) => ({
      id: p.id,
      label: p.name,
      description: p.description,
      archived: !p.active,
      href: `${SETTINGS}?tab=sla`,
    }));
  },

  async get(id, ctx) {
    const p = await policyRow(ctx, id);
    if (!p) return null;
    return {
      id: p.id,
      label: p.name,
      description: p.description,
      archived: !p.active,
      href: `${SETTINGS}?tab=sla`,
      value: policyValue(p),
    };
  },

  async check({ op, value }, ctx) {
    if ((op !== 'create' && op !== 'update') || !value) return [];
    const issues: CustomizationIssue[] = [];
    const [calendar] = await ctx.db
      .select({ id: businessCalendars.id })
      .from(businessCalendars)
      .where(eq(businessCalendars.id, value.calendarId));
    if (!calendar) issues.push({ path: 'calendarId', message: 'Unknown calendar', code: 'unknown_calendar' });
    for (const fact of new Set(factsOf(value.condition)))
      if (!(fact in SLA_FACTS))
        issues.push({ path: 'condition', message: `Unknown fact ${fact}`, code: 'unknown_fact' });
    const keys = [...new Set(categoryKeysOf(value.condition))];
    if (keys.length) {
      const known = new Set(
        (
          await ctx.db.select({ key: categories.key }).from(categories).where(inArray(categories.key, keys))
        ).map((r) => r.key),
      );
      for (const key of keys)
        if (!known.has(key))
          issues.push({
            path: 'condition',
            message: `No category has the key ${key}`,
            code: 'unknown_category',
          });
    }
    return issues;
  },

  async apply({ op, id, value }, ctx) {
    const config = services(ctx).config;
    switch (op) {
      case 'create':
        return { id: (await config.createPolicy({ ...value!, active: true })).id };
      case 'update':
        await config.updatePolicy(id!, value!);
        return { id: id! };
      default:
        await config.updatePolicy(id!, { active: op === 'restore' });
        return { id: id! };
    }
  },

  templates: [
    {
      id: 'sla-targets',
      label: 'itsm.customizations.templates.slaTargets.label',
      description: 'itsm.customizations.templates.slaTargets.description',
      fields: async (ctx) => {
        const calendars = await calendarList(ctx);
        const minutes = (
          key: string,
          metric: 'response' | 'resolution',
          p: (typeof PRIORITIES)[number],
          d: number,
        ) => ({
          key,
          type: 'number' as const,
          label: text((c) => slaText(c)[metric].replace('{priority}', c.priority[p])),
          required: true,
          defaultValue: d,
          validation: { min: 1, max: 525_600 },
          width: 'half' as const,
        });
        const defaults = { '1': [15, 240], '2': [60, 480], '3': [240, 1440], '4': [480, 2880] } as const;
        return [
          {
            key: 'name',
            type: 'text',
            label: text((c) => c.settingsPage.sla.name),
            required: true,
            validation: { maxLength: 200 },
          },
          {
            key: 'ticketTypes',
            type: 'multiselect',
            label: text((c) => c.settingsPage.sla.types),
            required: true,
            options: TICKET_TYPES.map((t) => ({ value: t, label: text((c) => c.types[t]) })),
            defaultValue: ['incident', 'service_request'],
          },
          {
            key: 'calendarId',
            type: 'select',
            label: text((c) => c.settingsPage.sla.calendar),
            required: true,
            options: calendars.map((c) => ({ value: c.id, label: { en: c.name } })),
            ...(calendars[0] ? { defaultValue: calendars[0].id } : {}),
          },
          ...PRIORITIES.flatMap((p) => [
            minutes(`p${p}Response`, 'response', p, defaults[p][0]),
            minutes(`p${p}Resolution`, 'resolution', p, defaults[p][1]),
          ]),
        ];
      },
      build: async (answers) => {
        const name = String(answers.name);
        const n = (key: string) => Math.round(Number(answers[key]));
        return {
          op: 'create',
          label: name,
          value: {
            name,
            description: null,
            ticketTypes: answers.ticketTypes as SlaPolicyValue['ticketTypes'],
            condition: null,
            targets: Object.fromEntries(
              PRIORITIES.map((p) => [
                p,
                { responseMinutes: n(`p${p}Response`), resolutionMinutes: n(`p${p}Resolution`) },
              ]),
            ) as SlaPolicyValue['targets'],
            calendarId: String(answers.calendarId),
            pauseStatuses: [...DEFAULT_PAUSE_STATUSES],
            warnAt: 0.75,
            sortOrder: 100,
          },
        };
      },
    },
  ],
};

/* ───────────────────────────── itsm.catalog-item ───────────────────────────── */

const item = upsertCatalogItemSchema.shape;

/** How the service desk fulfils one published request form (the object id is the form key). */
export const catalogItemValueSchema = z.object({
  formKey: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .describe('Key of a published request form (Administration → Forms). Fixed after creation'),
  active: item.active.describe(
    'Submissions open service requests; false keeps the settings but pauses fulfilment',
  ),
  categoryId: z.uuid().nullable().default(null).describe('Category of the service requests, or null'),
  groupId: z.uuid().nullable().default(null).describe('Group the service requests are assigned to, or null'),
  priority: item.priority.describe('Priority of the service requests: 1 (critical) … 4 (low)'),
  fulfilOn: item.fulfilOn.describe(
    'submitted: open the service request when the form is sent; approved: after its approval workflow approves it',
  ),
});
export type CatalogItemValue = z.infer<typeof catalogItemValueSchema>;

/** Published, active forms, read through `ctx.db` (a change set may publish one before adding it). */
async function publishedForms(ctx: ModuleContext, keys?: string[]) {
  return ctx.db
    .select({
      key: forms.key,
      name: forms.name,
      hasApproval: sql<boolean>`${forms.workflowDefinitionId} is not null`,
    })
    .from(forms)
    .where(
      and(
        isNotNull(forms.publishedVersion),
        isNull(forms.archivedAt),
        eq(forms.active, true),
        keys ? inArray(forms.key, keys) : undefined,
      ),
    )
    .orderBy(asc(forms.key));
}

/** `itsm.catalog-item`: a published form fulfilled by the service desk, live on apply. */
export const catalogItemCustomization: CustomizationHandler<CatalogItemValue> = {
  committed: () => invalidateLookups(),
  schema: catalogItemValueSchema,

  async guide(ctx, auth) {
    const [published, items, tree, teams] = await Promise.all([
      publishedForms(ctx),
      ctx.db.select({ formKey: catalogItems.formKey }).from(catalogItems),
      categoryTree(ctx),
      groupList(ctx),
    ]);
    const inCatalog = new Set(items.map((i) => i.formKey));
    return {
      instructions: [
        'A catalog item says how the service desk fulfils a published request form: each submission opens a service request with this category, group and priority, when the form is sent (fulfilOn "submitted") or once its approval workflow approves it ("approved", for forms with an approval).',
        'The id of a catalog item is its form key, and the key cannot change. A form must be published (Administration → Forms) before it can be added; a form already in the catalog is changed with an update.',
        'Delete stops fulfilling the form (existing tickets stay); setting active to false pauses it but keeps the settings.',
      ].join('\n'),
      reference: {
        forms: published.map((f) => ({
          key: f.key,
          name: nameIn(f.name, auth.user?.locale),
          hasApproval: f.hasApproval,
          inCatalog: inCatalog.has(f.key),
        })),
        categories: tree.rows
          .filter((r) => r.active && r.ticketTypes.includes('service_request'))
          .map((r) => ({ id: r.id, key: r.key, path: tree.path(r.id) })),
        groups: teams,
        priorities: { 1: 'P1 critical', 2: 'P2 high', 3: 'P3 moderate', 4: 'P4 low' },
      },
      examples: [
        {
          description: 'Laptop requests become P3 service requests for the IT asset team after approval',
          value: {
            formKey: 'laptop-request',
            active: true,
            categoryId: null,
            groupId: teams[0]?.id ?? null,
            priority: 3,
            fulfilOn: 'approved',
          },
        },
      ],
    };
  },

  async list({ q, limit }, ctx, auth) {
    const pattern = q ? likePattern(q) : null;
    const rows = await ctx.db
      .select({ formKey: catalogItems.formKey, active: catalogItems.active, name: forms.name })
      .from(catalogItems)
      .leftJoin(forms, eq(forms.key, catalogItems.formKey))
      .where(
        pattern
          ? or(ilike(catalogItems.formKey, pattern), sql`${forms.name}::text ilike ${pattern}`)
          : undefined,
      )
      .orderBy(asc(catalogItems.formKey))
      .limit(limit);
    return rows.map((r) => ({
      id: r.formKey,
      label: r.name ? nameIn(r.name, auth.user?.locale) : r.formKey,
      description: r.formKey,
      href: `${SETTINGS}?tab=catalog`,
    }));
  },

  async get(id, ctx, auth) {
    const [r] = await ctx.db
      .select({ item: catalogItems, name: forms.name })
      .from(catalogItems)
      .leftJoin(forms, eq(forms.key, catalogItems.formKey))
      .where(eq(catalogItems.formKey, id));
    if (!r) return null;
    return {
      id: r.item.formKey,
      label: r.name ? nameIn(r.name, auth.user?.locale) : r.item.formKey,
      description: r.item.formKey,
      href: `${SETTINGS}?tab=catalog`,
      value: {
        formKey: r.item.formKey,
        active: r.item.active,
        categoryId: r.item.categoryId,
        groupId: r.item.groupId,
        priority: r.item.priority,
        fulfilOn: r.item.fulfilOn,
      },
    };
  },

  async check({ op, id, value }, ctx) {
    if ((op !== 'create' && op !== 'update') || !value) return [];
    const issues: CustomizationIssue[] = [];
    if (op === 'update' && value.formKey !== id)
      issues.push({
        path: 'formKey',
        message: 'The form of a catalog item cannot change',
        code: 'immutable',
      });
    if (op === 'create') {
      const [existing] = await ctx.db
        .select({ formKey: catalogItems.formKey })
        .from(catalogItems)
        .where(eq(catalogItems.formKey, value.formKey));
      if (existing)
        issues.push({
          path: 'formKey',
          message: 'This form is already in the catalog: change it with an update',
          code: 'duplicate_key',
        });
    }
    if (!(await services(ctx).config.isPublishedForm(value.formKey)))
      issues.push({ path: 'formKey', message: 'No published form has this key', code: 'unknown_form' });
    if (value.categoryId) {
      const [c] = await ctx.db
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.id, value.categoryId));
      if (!c) issues.push({ path: 'categoryId', message: 'Unknown category', code: 'unknown_category' });
    }
    if (value.groupId && !(await groupExists(ctx, value.groupId)))
      issues.push({ path: 'groupId', message: 'Unknown group', code: 'unknown_group' });
    return issues;
  },

  async apply({ op, id, value }, ctx) {
    const config = services(ctx).config;
    if (op === 'delete') {
      await config.deleteCatalogItem(id!);
      return { id: id! };
    }
    const { formKey, ...settings } = value!;
    await config.upsertCatalogItem(formKey, settings);
    return { id: formKey };
  },
};
