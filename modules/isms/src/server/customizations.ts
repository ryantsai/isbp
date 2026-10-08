/**
 * Customisation kind `isms.asset-class`: a class of the information asset register with its sub-classes and C/I/A
 * guidance, built on the admin page's schema and service, so the assistant (and outside agents over MCP) can only
 * propose what Information security → Settings would accept. Archived classes stay on existing assets.
 */
import type { CustomizationHandler, CustomizationIssue } from '@isbp/sdk/server';
import { localize } from '@isbp/sdk/server';
import { upsertClassSchema } from '../contracts';
import { defaultClassValue, TaxonomyService, type UpsertClassData } from './taxonomy';

const summary = (c: {
  id: string;
  code: string;
  name: Record<string, string | undefined>;
  archived: boolean;
  subclasses: unknown[];
}) => ({
  id: c.id,
  label: `${c.code} ${localize(c.name, 'en')}`,
  description: `${c.subclasses.length} sub-classes`,
  archived: c.archived,
  href: '/isms/settings',
});

export const assetClassKind: CustomizationHandler<UpsertClassData> = {
  schema: upsertClassSchema,

  async guide(ctx) {
    const classes = await new TaxonomyService(ctx).classes(true);
    return {
      instructions: [
        'A class groups information assets (e.g. hardware) and gives every asset number its class code: numbers are <site code><class code><4-digit sequence>, e.g. HQ01HW0001.',
        'code: 2-4 capital letters, unique, and it cannot change once the class exists.',
        'name and every sub-class name: text in en, zh-TW and ja-JP.',
        'guidance: for c (confidentiality), i (integrity) and a (availability), what each score 1-4 means for assets of this class, per language. An asset value is the highest of its three scores, so write the guidance so that a higher score always means more impact. Leave a level empty when it does not apply.',
        'subclasses: the full list in display order. Keep the id of an existing sub-class when you change it; a sub-class left out is archived (assets keep it). Keys are lowercase slugs, unique within the class.',
      ].join('\n'),
      reference: {
        classes: classes.map((c) => ({
          id: c.id,
          code: c.code,
          name: localize(c.name, 'en'),
          archived: c.archived,
          subclasses: c.subclasses.map((s) => ({
            id: s.id,
            key: s.key,
            name: localize(s.name, 'en'),
            archived: s.archived,
          })),
          assets: c.assetCount,
        })),
      },
      examples: [{ description: 'The default hardware class', value: defaultClassValue('HW', 20) }],
    };
  },

  async list({ q, limit, includeArchived }, ctx) {
    const classes = await new TaxonomyService(ctx).classes(includeArchived);
    const term = q?.trim().toLowerCase();
    return classes
      .filter(
        (c) =>
          !term ||
          c.code.toLowerCase().includes(term) ||
          Object.values(c.name).some((n) => n?.toLowerCase().includes(term)),
      )
      .slice(0, limit)
      .map(summary);
  },

  async get(id, ctx) {
    const svc = new TaxonomyService(ctx);
    try {
      const dto = await svc.classById(id);
      return { ...summary(dto), value: svc.valueOf(dto) };
    } catch {
      return null;
    }
  },

  async check({ op, id, value }, ctx) {
    const issues: CustomizationIssue[] = [];
    if (!value) return issues;
    const classes = await new TaxonomyService(ctx).classes(true);
    if (op === 'create' && classes.some((c) => c.code === value.code))
      issues.push({ path: 'code', message: `Class code ${value.code} is taken`, code: 'duplicate' });
    if (op === 'update') {
      const current = classes.find((c) => c.id === id);
      if (current && current.code !== value.code)
        issues.push({ path: 'code', message: 'The code of a class cannot change', code: 'immutable' });
      const own = new Set(current?.subclasses.map((s) => s.id) ?? []);
      value.subclasses.forEach((s, i) => {
        if (s.id && !own.has(s.id))
          issues.push({
            path: `subclasses.${i}.id`,
            message: 'Not a sub-class of this class',
            code: 'unknown',
          });
      });
    }
    const keys = new Set<string>();
    value.subclasses.forEach((s, i) => {
      if (keys.has(s.key))
        issues.push({ path: `subclasses.${i}.key`, message: 'Duplicate key', code: 'duplicate' });
      keys.add(s.key);
    });
    return issues;
  },

  async apply({ op, id, value }, ctx, auth) {
    const svc = new TaxonomyService(ctx);
    if (op === 'create') return { id: (await svc.createClass(value!, auth)).id };
    if (op === 'update') return { id: (await svc.updateClass(id!, value!, auth)).id };
    return { id: (await svc.setClassArchived(id!, op === 'archive', auth)).id };
  },
};

export const customizations = { 'asset-class': assetClassKind };
