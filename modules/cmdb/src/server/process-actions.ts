/**
 * `cmdb.update-ci`: a request form sets fields of the CIs picked in one of its configuration-item fields (status,
 * environment, criticality, support group, custom attributes) — e.g. "in maintenance" once a change is approved.
 * Each CI is updated through the CMDB's own rules and audit; setting a value it already has changes nothing, so a
 * retry is harmless.
 */
import { groups } from '@isbp/db/schema';
import {
  ErrorCodes,
  type FieldDef,
  formFields,
  HttpError,
  type LocalizedText,
  parseRecordRef,
  type ProcessActionHandler,
} from '@isbp/sdk/server';
import { asc, ne } from 'drizzle-orm';
import en from '../../messages/en.json';
import ja from '../../messages/ja-JP.json';
import zh from '../../messages/zh-TW.json';
import { CI_CRITICALITIES, CI_ENVIRONMENTS, CI_STATUSES, formatCiNumber } from '../model';
import { CiService, ENTITY } from './service';

const CATALOGS = { en, 'zh-TW': zh as typeof en, 'ja-JP': ja as typeof en };
const text = (pick: (c: typeof en) => string): LocalizedText => ({
  en: pick(CATALOGS.en),
  'zh-TW': pick(CATALOGS['zh-TW']),
  'ja-JP': pick(CATALOGS['ja-JP']),
});
const t = (pick: (c: typeof en.processActions.updateCi) => string) =>
  text((c) => pick(c.processActions.updateCi));

/** Custom attributes are configured as `attr_<key>`. */
const ATTR = 'attr_';
const BUILT_IN = ['status', 'environment', 'criticality', 'supportGroupId'] as const;

const isSet = (v: unknown) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length);

export const updateCiAction: ProcessActionHandler = {
  async fields(ctx, { form }) {
    const [groupRows, custom] = await Promise.all([
      ctx.db
        .select({ id: groups.id, name: groups.name })
        .from(groups)
        .where(ne(groups.key, 'everyone'))
        .orderBy(asc(groups.name))
        .limit(500),
      ctx.fields.definitions(ENTITY),
    ]);
    const ciFields = formFields(form)
      .filter((f) => f.type === 'record' && f.record?.types.includes(ENTITY))
      .map((f) => ({ value: f.key, label: f.label }));
    return [
      {
        key: 'ciField',
        type: 'select',
        label: t((x) => x.ciField),
        help: t((x) => x.ciFieldHelp),
        required: true,
        options: ciFields,
      },
      {
        key: 'status',
        type: 'select',
        label: t((x) => x.status),
        width: 'half',
        options: CI_STATUSES.map((s) => ({ value: s, label: text((c) => c.status[s]) })),
      },
      {
        key: 'environment',
        type: 'select',
        label: t((x) => x.environment),
        width: 'half',
        options: CI_ENVIRONMENTS.map((e) => ({ value: e, label: text((c) => c.environment[e]) })),
      },
      {
        key: 'criticality',
        type: 'select',
        label: t((x) => x.criticality),
        width: 'half',
        options: CI_CRITICALITIES.map((v) => ({ value: v, label: text((c) => c.criticality[v]) })),
      },
      ...(groupRows.length
        ? [
            {
              key: 'supportGroupId',
              type: 'select' as const,
              label: t((x) => x.supportGroup),
              width: 'half' as const,
              options: groupRows.map((g) => ({ value: g.id, label: { en: g.name } })),
            },
          ]
        : []),
      // Custom fields of CIs (empty: left as it is).
      ...custom
        .filter((f) => f.type !== 'record' && ATTR.length + f.key.length <= 64)
        .map(({ visibleWhen: _v, defaultValue: _d, required: _r, ...f }): FieldDef => ({
          ...f,
          key: `${ATTR}${f.key}`,
        })),
    ] satisfies FieldDef[];
  },

  async validate(config) {
    const some = Object.entries(config).some(
      ([k, v]) => ((BUILT_IN as readonly string[]).includes(k) || k.startsWith(ATTR)) && isSet(v),
    );
    if (!some)
      throw new HttpError(400, ErrorCodes.VALIDATION_FAILED, 'Choose at least one value to set', {
        issues: [{ path: 'status', message: 'nothing', code: 'nothing' }],
      });
  },

  async run({ config, request }, ctx) {
    const key = String(config.ciField ?? '');
    const raw = request.data[key];
    const ids = [
      ...new Set(
        (Array.isArray(raw) ? raw : raw ? [raw] : [])
          .map((v) => (typeof v === 'string' ? parseRecordRef(v) : null))
          .filter((r): r is NonNullable<typeof r> => r?.type === ENTITY)
          .map((r) => r.id),
      ),
    ];
    if (!ids.length) return { reference: null, href: null, summary: 'cmdb.processActions.updateCi.none' };
    const attributes = Object.fromEntries(
      Object.entries(config)
        .filter(([k, v]) => k.startsWith(ATTR) && isSet(v))
        .map(([k, v]) => [k.slice(ATTR.length), v]),
    );
    const patch = {
      ...Object.fromEntries(BUILT_IN.filter((k) => isSet(config[k])).map((k) => [k, config[k]])),
      ...(Object.keys(attributes).length ? { attributes } : {}),
    };
    const svc = new CiService(ctx);
    const refs: string[] = [];
    for (const id of ids) {
      const ci = await svc.update(id, patch);
      refs.push(formatCiNumber(ci.number));
    }
    return {
      reference: refs.join(', ').slice(0, 200),
      href: refs.length === 1 ? `/cmdb/${refs[0]}` : null,
      summary: 'cmdb.processActions.updateCi.updated',
    };
  },
};

export const processActions = { 'update-ci': updateCiAction };
