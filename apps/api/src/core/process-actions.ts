/**
 * Core's process actions (what a form does after it is sent or decided): grant a role, notify people, call a
 * webhook. They run in the worker as a system principal holding core's permissions (decision 71).
 */
import { applications, groupMembers, groups, rolePermissions, roles, users } from '@isbp/db/schema';
import {
  type AuthContext,
  ErrorCodes,
  type FieldDef,
  type FormSchema,
  formFields,
  HttpError,
  type LocalizedText,
  type ModuleContext,
  type ProcessActionHandler,
  TEMPLATE_RE,
} from '@isbp/sdk/server';
import { addDays, isTimeZone, parseLocalDate, zonedInstant } from '@isbp/contracts';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { hostAllowed } from '../kernel/outbound';
import { EVERYONE_GROUP_KEY, PLATFORM_APP_KEY } from '../kernel/rbac';
import { catalogLocalized } from './customizations/shared';
import { getKernel } from './kernel-ref';
import { AccessService } from './services/access';

const DAY = 86_400_000;
const REQUESTER = 'requester';
const FIELD_PREFIX = 'field:';

const text = (key: string): Promise<LocalizedText> => catalogLocalized(`core.processActions.${key}`);

function invalid(path: string, message: string): HttpError {
  return new HttpError(400, ErrorCodes.VALIDATION_FAILED, message, {
    issues: [{ path, message, code: 'invalid' }],
  });
}

/** The person fields of a form, as choices (`field:<key>`). */
const userFieldOptions = (form: FormSchema | null) =>
  formFields(form)
    .filter((f) => f.type === 'user')
    .map((f) => ({ value: `${FIELD_PREFIX}${f.key}`, label: f.label }));

/** The person a choice points at: the requester, or the person picked in a field of the request. */
function personFrom(
  choice: unknown,
  request: { requester: { id: string } | null; data: Record<string, unknown> },
): string | null {
  if (choice === REQUESTER) return request.requester?.id ?? null;
  if (typeof choice === 'string' && choice.startsWith(FIELD_PREFIX)) {
    const v = request.data[choice.slice(FIELD_PREFIX.length)];
    return typeof v === 'string' ? v : null;
  }
  return null;
}

/* ───────────────────────────── core.grant-role ───────────────────────────── */

interface GrantableRole {
  id: string;
  key: string;
  name: string;
  requestable: boolean;
  permissions: string[];
  application: { id: string; key: string; name: string; isPlatform: boolean };
}

/**
 * Roles a form can hand out: the platform's and those of registered applications (VPN, Active Directory, server
 * access…), platform roles first, then by application and name.
 */
async function grantableRoles(ctx: ModuleContext): Promise<GrantableRole[]> {
  const rows = await ctx.db
    .select({
      id: roles.id,
      key: roles.key,
      name: roles.name,
      requestable: roles.requestable,
      appId: applications.id,
      appKey: applications.key,
      appName: applications.name,
    })
    .from(roles)
    .innerJoin(applications, eq(applications.id, roles.applicationId))
    .orderBy(asc(applications.name), asc(roles.name))
    .limit(2_000);
  const perms = rows.length
    ? await ctx.db
        .select({ roleId: rolePermissions.roleId, permission: rolePermissions.permission })
        .from(rolePermissions)
        .where(
          inArray(
            rolePermissions.roleId,
            rows.map((r) => r.id),
          ),
        )
    : [];
  return rows
    .map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      requestable: r.requestable,
      permissions: perms.filter((p) => p.roleId === r.id).map((p) => p.permission),
      application: { id: r.appId, key: r.appKey, name: r.appName, isPlatform: r.appKey === PLATFORM_APP_KEY },
    }))
    .sort((a, b) => Number(b.application.isPlatform) - Number(a.application.isPlatform));
}

/**
 * Who may put a role on a form: anyone (requestable roles), or someone who could assign it themselves — platform
 * roles need `core.roles.assign` and every permission of the role (the escalation guard), application roles the
 * right to manage that application's access (`core.applications.manage` on it).
 */
function mayHandOut(access: AccessService, auth: AuthContext, r: GrantableRole): boolean {
  return r.requestable || couldAssign(access, auth, r);
}

/** Whether `auth` could assign the role by hand (then no duration limit of requests applies). */
function couldAssign(access: AccessService, auth: AuthContext, r: GrantableRole): boolean {
  return r.application.isPlatform
    ? access.canGrant(r.permissions, auth)
    : auth.can('core.applications.manage', { recordType: 'application', recordId: r.application.id });
}

/** "VPN · Remote access" for an application role, the role's name for a platform role. */
const roleLabel = (r: GrantableRole) =>
  r.application.isPlatform ? r.name : `${r.application.name} · ${r.name}`;

export const grantRoleAction: ProcessActionHandler = {
  async fields(ctx, { form, auth }) {
    const access = new AccessService(ctx);
    const all = await grantableRoles(ctx);
    const [role, person, requester, duration, durationHint, reason] = await Promise.all([
      text('grantRole.role'),
      text('grantRole.person'),
      text('grantRole.requester'),
      text('grantRole.duration'),
      text('grantRole.durationHint'),
      text('grantRole.reason'),
    ]);
    return [
      {
        key: 'roleId',
        type: 'select',
        label: role,
        required: true,
        options: all
          .filter((r) => !auth || mayHandOut(access, auth, r))
          .map((r) => ({ value: r.id, label: { en: roleLabel(r) } })),
      },
      {
        key: 'person',
        type: 'select',
        label: person,
        required: true,
        defaultValue: REQUESTER,
        options: [{ value: REQUESTER, label: requester }, ...userFieldOptions(form)],
      },
      {
        key: 'durationDays',
        type: 'number',
        label: duration,
        help: durationHint,
        validation: { min: 1, max: 3650 },
        width: 'half',
      },
      {
        key: 'reason',
        type: 'text',
        label: reason,
        defaultValue: '{{request.reference}}: {{request.form}}',
        validation: { maxLength: 500 },
      },
    ] satisfies FieldDef[];
  },

  async validate(config, ctx, { auth }) {
    const access = new AccessService(ctx);
    const role = (await grantableRoles(ctx)).find((r) => r.id === config.roleId);
    if (!role) throw invalid('roleId', 'Unknown role');
    if (couldAssign(access, auth, role)) return;
    if (!role.requestable)
      throw new HttpError(
        403,
        ErrorCodes.PRIVILEGE_ESCALATION,
        'Only requestable roles, or roles you could assign yourself, can be granted by a form',
        role.application.isPlatform
          ? { missing: role.permissions }
          : { permission: 'core.applications.manage', application: role.application.key },
      );
    const [r] = await ctx.db.select({ max: roles.maxDurationDays }).from(roles).where(eq(roles.id, role.id));
    const days = typeof config.durationDays === 'number' ? config.durationDays : null;
    if (r?.max && (!days || days > r.max))
      throw new HttpError(400, ErrorCodes.VALIDATION_FAILED, 'Longer than the role allows', {
        issues: [{ path: 'durationDays', message: 'max', code: 'max', params: { max: r.max } }],
      });
  },

  async run({ config, request, auth }, ctx) {
    const userId = personFrom(config.person, request);
    if (!userId) throw invalid('person', 'The request names nobody to grant the role to');
    const days = typeof config.durationDays === 'number' ? config.durationDays : null;
    const access = new AccessService(ctx);
    const granted = await access.grantForRequest(
      {
        roleId: String(config.roleId),
        userId,
        expiresAt: days ? new Date(Date.now() + days * DAY) : null,
        reason: String(config.reason || request.reference),
      },
      auth,
    );
    const [role] = await ctx.db
      .select({
        name: roles.name,
        appId: applications.id,
        appKey: applications.key,
        appName: applications.name,
      })
      .from(roles)
      .innerJoin(applications, eq(applications.id, roles.applicationId))
      .where(eq(roles.id, String(config.roleId)));
    const isApp = Boolean(role && role.appKey !== PLATFORM_APP_KEY);
    // An application role links to its application (where its holders are listed).
    return {
      reference: role ? (isApp ? `${role.appName} · ${role.name}` : role.name) : null,
      href: role && isApp ? `/admin/applications/${role.appId}` : null,
      summary: `core.processActions.grantRole.${granted.outcome}`,
    };
  },
};

/* ───────────────────────────── core.notify ───────────────────────────── */

export const notifyAction: ProcessActionHandler = {
  async fields(ctx, { form }) {
    const list = await ctx.db
      .select({ id: groups.id, name: groups.name })
      .from(groups)
      .where(ne(groups.key, EVERYONE_GROUP_KEY))
      .orderBy(asc(groups.name))
      .limit(500);
    const [toRequester, userFields, person, groupsLabel, title, message] = await Promise.all([
      text('notify.toRequester'),
      text('notify.userFields'),
      text('notify.person'),
      text('notify.groups'),
      text('notify.title'),
      text('notify.message'),
    ]);
    const people = userFieldOptions(form);
    return [
      { key: 'toRequester', type: 'boolean', label: toRequester, defaultValue: true },
      ...(people.length
        ? [{ key: 'userFields', type: 'multiselect' as const, label: userFields, options: people }]
        : []),
      { key: 'person', type: 'user', label: person, width: 'half' },
      ...(list.length
        ? [
            {
              key: 'groups',
              type: 'multiselect' as const,
              label: groupsLabel,
              options: list.map((g) => ({ value: g.id, label: { en: g.name } })),
            },
          ]
        : []),
      {
        key: 'title',
        type: 'text',
        label: title,
        required: true,
        defaultValue: '{{request.form}} ({{request.reference}})',
        validation: { maxLength: 200 },
      },
      { key: 'message', type: 'textarea', label: message, validation: { maxLength: 4000 } },
    ] satisfies FieldDef[];
  },

  async validate(config) {
    const some =
      config.toRequester === true ||
      Boolean(config.person) ||
      (Array.isArray(config.userFields) && config.userFields.length > 0) ||
      (Array.isArray(config.groups) && config.groups.length > 0);
    if (!some)
      throw new HttpError(400, ErrorCodes.VALIDATION_FAILED, 'Choose who to notify', {
        issues: [{ path: 'toRequester', message: 'recipients', code: 'recipients' }],
      });
  },

  async run({ config, request }, ctx) {
    const ids = new Set<string>();
    if (config.toRequester === true && request.requester) ids.add(request.requester.id);
    if (typeof config.person === 'string') ids.add(config.person);
    for (const choice of Array.isArray(config.userFields) ? config.userFields : []) {
      const id = personFrom(choice, request);
      if (id) ids.add(id);
    }
    const groupIds = (Array.isArray(config.groups) ? config.groups : []).filter(
      (g): g is string => typeof g === 'string',
    );
    if (groupIds.length)
      for (const m of await ctx.db
        .select({ userId: groupMembers.userId })
        .from(groupMembers)
        .innerJoin(users, eq(users.id, groupMembers.userId))
        .where(and(inArray(groupMembers.groupId, groupIds), eq(users.status, 'active'))))
        ids.add(m.userId);
    await ctx.notifications.notify({
      type: 'core.process-action.message',
      recipients: [...ids],
      params: {
        title: String(config.title ?? '').slice(0, 200),
        message: String(config.message ?? '').slice(0, 4000),
        reference: request.reference,
      },
      href: request.href,
    });
    return { reference: null, href: null, summary: 'core.processActions.notify.sent' };
  },
};

/* ───────────────────────────── core.webhook ───────────────────────────── */

/** `processActions.webhookHosts`: one host or `*.suffix` per line (commas and spaces also separate). */
async function webhookHosts(ctx: ModuleContext): Promise<string[]> {
  const raw = (await ctx.settings.get<string>('processActions.webhookHosts')) ?? '';
  return raw
    .split(/[\s,]+/)
    .map((h) => h.trim())
    .filter(Boolean);
}

const RESERVED_HEADERS = new Set([
  'host',
  'content-length',
  'content-type',
  'transfer-encoding',
  'connection',
]);

/** Where a webhook may go: HTTPS, to a host on the allow-list (an administrator's decision). */
async function assertTarget(ctx: ModuleContext, raw: unknown): Promise<{ url: URL; allow: string[] }> {
  let url: URL;
  try {
    url = new URL(String(raw));
  } catch {
    throw invalid('url', 'url');
  }
  if (url.protocol !== 'https:')
    throw new HttpError(400, ErrorCodes.VALIDATION_FAILED, 'Webhooks must use HTTPS', {
      issues: [{ path: 'url', message: 'https', code: 'https' }],
    });
  const allow = await webhookHosts(ctx);
  if (!hostAllowed(url.hostname, allow))
    throw new HttpError(400, ErrorCodes.VALIDATION_FAILED, `${url.hostname} is not an allowed webhook host`, {
      issues: [{ path: 'url', message: 'host', code: 'host' }],
    });
  return { url, allow };
}

export const webhookAction: ProcessActionHandler = {
  secrets: ['headerValue'],
  jsonTemplates: ['body'],

  async fields() {
    const [url, urlHint, headerName, headerValue, headerValueHint, body] = await Promise.all([
      text('webhook.url'),
      text('webhook.urlHint'),
      text('webhook.headerName'),
      text('webhook.headerValue'),
      text('webhook.headerValueHint'),
      text('webhook.body'),
    ]);
    return [
      { key: 'url', type: 'url', label: url, help: urlHint, required: true },
      {
        key: 'headerName',
        type: 'text',
        label: headerName,
        defaultValue: 'Authorization',
        validation: { maxLength: 64, pattern: '[A-Za-z0-9-]+' },
        width: 'half',
      },
      { key: 'headerValue', type: 'text', label: headerValue, help: headerValueHint, width: 'half' },
      {
        key: 'body',
        type: 'textarea',
        label: body,
        required: true,
        validation: { maxLength: 20_000 },
        defaultValue: JSON.stringify(
          {
            request: '{{request.reference}}',
            form: '{{request.formKey}}',
            outcome: '{{request.outcome}}',
            requester: '{{requester.email}}',
            url: '{{request.url}}',
          },
          null,
          2,
        ),
      },
    ] satisfies FieldDef[];
  },

  async validate(config, ctx) {
    await assertTarget(ctx, config.url);
    if (typeof config.headerName === 'string' && RESERVED_HEADERS.has(config.headerName.toLowerCase()))
      throw invalid('headerName', 'reserved');
    // Placeholders stand for values: with each replaced by a number the body must be JSON.
    try {
      JSON.parse(String(config.body ?? '').replace(TEMPLATE_RE, '0'));
    } catch {
      throw new HttpError(400, ErrorCodes.VALIDATION_FAILED, 'The body is not valid JSON', {
        issues: [{ path: 'body', message: 'json', code: 'json' }],
      });
    }
  },

  async run({ config }, ctx) {
    const { url, allow } = await assertTarget(ctx, config.url).catch((err: HttpError) => {
      throw new HttpError(422, ErrorCodes.TARGET_BLOCKED, err.message);
    });
    const body = String(config.body ?? '');
    try {
      JSON.parse(body);
    } catch {
      throw invalid('body', 'The rendered body is not valid JSON');
    }
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (typeof config.headerName === 'string' && config.headerName && typeof config.headerValue === 'string')
      headers[config.headerName] = config.headerValue;
    let res;
    try {
      res = await ctx.http.request(url.toString(), {
        method: 'POST',
        headers,
        body,
        timeoutMs: 15_000,
        maxBytes: 64 * 1024,
        allowHosts: allow,
      });
    } catch (err) {
      // Timeouts and network errors are worth another try; a blocked target is not.
      if (err instanceof HttpError && err.code === ErrorCodes.UPSTREAM_FAILED) throw new Error(err.message);
      throw err;
    }
    if (res.status >= 500 || res.status === 429) throw new Error(`The webhook answered HTTP ${res.status}`);
    if (res.status >= 400)
      throw new HttpError(502, ErrorCodes.REMOTE_REJECTED, `The webhook answered HTTP ${res.status}`, {
        status: res.status,
      });
    return { reference: `HTTP ${res.status}`, href: null, summary: null };
  },
};

/* ───────────────────────────── core.remind ───────────────────────────── */

const FROM_STEP = 'step';
const FROM_OUTCOME = 'outcome';
/** `<step id>.<field key>` of a step field (`steps.<step>.<key>` in conditions and templates). */
const STEP_FIELD_PATTERN = '[a-zA-Z_][\\w-]{0,63}\\.[a-z][a-zA-Z0-9_]{0,63}';
/** Date-only reminders go out at this hour in the requester's time zone. */
const REMINDER_HOUR = 9;

/** The date fields of a form, as choices (`field:<key>`). */
const dateFieldOptions = (form: FormSchema | null) =>
  formFields(form)
    .filter((f) => f.type === 'date')
    .map((f) => ({ value: `${FIELD_PREFIX}${f.key}`, label: f.label }));

/**
 * When a reminder is due: a date (`YYYY-MM-DD`, at 09:00 in `timeZone`) or an instant (an ISO date-time), plus
 * `offsetDays` (negative: before). Null when the value isn't a date.
 */
export function reminderDue(value: unknown, offsetDays: number, timeZone: string): Date | null {
  if (typeof value !== 'string') return null;
  const day = parseLocalDate(value);
  if (day) return zonedInstant({ ...addDays(day, offsetDays), hour: REMINDER_HOUR }, timeZone);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : new Date(at.getTime() + offsetDays * DAY);
}

export const remindAction: ProcessActionHandler = {
  async fields(ctx, { form }) {
    const [groupRows, roleRows] = await Promise.all([
      ctx.db
        .select({ key: groups.key, name: groups.name })
        .from(groups)
        .where(ne(groups.key, EVERYONE_GROUP_KEY))
        .orderBy(asc(groups.name))
        .limit(500),
      ctx.db
        .select({ key: roles.key, name: roles.name })
        .from(roles)
        .innerJoin(applications, eq(applications.id, roles.applicationId))
        .where(eq(applications.key, PLATFORM_APP_KEY))
        .orderBy(asc(roles.name))
        .limit(500),
    ]);
    const [
      toRequester,
      userFields,
      groupsLabel,
      rolesLabel,
      dateFrom,
      fromStep,
      fromOutcome,
      stepField,
      stepFieldHint,
      offsetDays,
      offsetDaysHint,
      onlyFuture,
      title,
      message,
    ] = await Promise.all([
      text('notify.toRequester'),
      text('notify.userFields'),
      text('notify.groups'),
      text('remind.roles'),
      text('remind.dateFrom'),
      text('remind.fromStep'),
      text('remind.fromOutcome'),
      text('remind.stepField'),
      text('remind.stepFieldHint'),
      text('remind.offsetDays'),
      text('remind.offsetDaysHint'),
      text('remind.onlyFuture'),
      text('notify.title'),
      text('notify.message'),
    ]);
    const people = userFieldOptions(form);
    const dates = dateFieldOptions(form);
    return [
      {
        key: 'dateFrom',
        type: 'select',
        label: dateFrom,
        required: true,
        defaultValue: dates[0]?.value ?? FROM_OUTCOME,
        options: [
          ...dates,
          { value: FROM_STEP, label: fromStep },
          { value: FROM_OUTCOME, label: fromOutcome },
        ],
      },
      {
        key: 'stepField',
        type: 'text',
        label: stepField,
        help: stepFieldHint,
        required: true,
        placeholder: { en: 'review.wipeDue' },
        visibleWhen: { fact: 'dateFrom', op: 'eq', value: FROM_STEP },
        validation: { maxLength: 130, pattern: STEP_FIELD_PATTERN },
      },
      {
        key: 'offsetDays',
        type: 'number',
        label: offsetDays,
        help: offsetDaysHint,
        defaultValue: 0,
        validation: { min: -3650, max: 3650 },
        width: 'half',
      },
      { key: 'onlyFuture', type: 'boolean', label: onlyFuture, defaultValue: true, width: 'half' },
      { key: 'toRequester', type: 'boolean', label: toRequester, defaultValue: true },
      ...(people.length
        ? [{ key: 'userFields', type: 'multiselect' as const, label: userFields, options: people }]
        : []),
      ...(groupRows.length
        ? [
            {
              key: 'groups',
              type: 'multiselect' as const,
              label: groupsLabel,
              options: groupRows.map((g) => ({ value: g.key, label: { en: g.name } })),
            },
          ]
        : []),
      ...(roleRows.length
        ? [
            {
              key: 'roles',
              type: 'multiselect' as const,
              label: rolesLabel,
              options: roleRows.map((r) => ({ value: r.key, label: { en: r.name } })),
            },
          ]
        : []),
      {
        key: 'title',
        type: 'text',
        label: title,
        required: true,
        defaultValue: '{{request.form}} ({{request.reference}})',
        validation: { maxLength: 200 },
      },
      { key: 'message', type: 'textarea', label: message, validation: { maxLength: 4000 } },
    ] satisfies FieldDef[];
  },

  async validate(config) {
    const some =
      config.toRequester === true ||
      (Array.isArray(config.userFields) && config.userFields.length > 0) ||
      (Array.isArray(config.groups) && config.groups.length > 0) ||
      (Array.isArray(config.roles) && config.roles.length > 0);
    if (!some)
      throw new HttpError(400, ErrorCodes.VALIDATION_FAILED, 'Choose who to remind', {
        issues: [{ path: 'toRequester', message: 'recipients', code: 'recipients' }],
      });
  },

  /**
   * Schedules the reminder (`core.scheduled_reminders`), idempotent on the run: a retried run finds the reminder it
   * made. People named in the request are fixed now; groups and roles are resolved when it is sent.
   */
  async run({ config, request, runId }, ctx) {
    const reminders = getKernel().reminders;
    const source = { type: 'form-submission', id: request.id, runId };
    const scheduled = (dueAt: Date) => ({
      reference: null,
      href: null,
      summary: 'core.processActions.remind.scheduled',
      summaryParams: { date: dueAt.toISOString() },
    });
    const existing = await reminders.bySource(source);
    if (existing) return scheduled(existing.dueAt);

    const offset = typeof config.offsetDays === 'number' ? Math.trunc(config.offsetDays) : 0;
    const from = String(config.dateFrom ?? FROM_OUTCOME);
    let base: unknown;
    if (from === FROM_OUTCOME) base = new Date().toISOString();
    else if (from === FROM_STEP) {
      const [stepId = '', key = ''] = String(config.stepField ?? '').split('.');
      base = request.steps?.[stepId]?.[key];
    } else if (from.startsWith(FIELD_PREFIX)) base = request.data[from.slice(FIELD_PREFIX.length)];
    // An empty (optional) date means there is nothing to remind of: done, nothing scheduled.
    if (base === undefined || base === null || base === '')
      return { reference: null, href: null, summary: 'core.processActions.remind.noDate' };
    const [person] = request.requester
      ? await ctx.db
          .select({ timezone: users.timezone })
          .from(users)
          .where(eq(users.id, request.requester.id))
      : [];
    const dueAt = reminderDue(base, offset, isTimeZone(person?.timezone) ? person!.timezone : 'UTC');
    if (!dueAt) throw invalid('dateFrom', 'The chosen value is not a date');
    if (config.onlyFuture !== false && dueAt.getTime() <= Date.now())
      return {
        reference: null,
        href: null,
        summary: 'core.processActions.remind.passed',
        summaryParams: { date: dueAt.toISOString() },
      };

    const userIds = new Set<string>();
    if (config.toRequester === true && request.requester) userIds.add(request.requester.id);
    for (const choice of Array.isArray(config.userFields) ? config.userFields : []) {
      const id = personFrom(choice, request);
      if (id) userIds.add(id);
    }
    const keys = (v: unknown) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    await ctx.transaction(async (tx) => {
      const row = await reminders.schedule(
        {
          moduleId: 'core',
          type: 'core.reminder.due',
          recipients: { userIds: [...userIds], groupKeys: keys(config.groups), roleKeys: keys(config.roles) },
          params: {
            title: String(config.title ?? '').slice(0, 200),
            message: String(config.message ?? '').slice(0, 4000),
            reference: request.reference,
            form: request.form.name,
          },
          href: request.href,
          dueAt,
          source,
        },
        tx,
      );
      await ctx.audit.record(
        {
          action: 'core.reminder.scheduled',
          category: 'system',
          entityType: 'form_submission',
          entityId: request.id,
          entityLabel: request.reference,
          metadata: { reminderId: row.id, runId, dueAt: dueAt.toISOString() },
        },
        { tx },
      );
    });
    return scheduled(dueAt);
  },
};

export const processActions = {
  'grant-role': grantRoleAction,
  notify: notifyAction,
  webhook: webhookAction,
  remind: remindAction,
};
