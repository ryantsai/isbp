/**
 * Request forms: random but valid answers generated from a form's own schema (the same `FieldDef`s the browser
 * renders), so a flow keeps working when an administrator changes the form. Fields that pick things that must exist
 * (`record`, `user`, `rows`) and answers that form rules tie together are the flow's to give, as overrides.
 */
import type { Json } from './client';
import { type FlowContext, FlowError } from './flow';

export interface AnswerOptions {
  /** Only required fields (and overrides). */
  requiredOnly?: boolean;
  /** Chance that an optional field is answered (default 0.6). */
  optionalRate?: number;
}

export interface Forms {
  /** The published version of a form, as `persona` sees it (`GET /forms/by-key/:key`). */
  published(key: string, persona: string): Promise<Json>;
  /** Answers by field key for the schema's fields; `overrides` win (`undefined` leaves a field out). */
  answers(
    schema: { elements?: Json[] },
    overrides?: Record<string, unknown>,
    opts?: AnswerOptions,
  ): Record<string, unknown>;
}

const DISPLAY = new Set(['heading', 'paragraph', 'divider']);

export function createForms(ctx: FlowContext): Forms {
  const { rand } = ctx;

  const text = (f: Json, long: boolean) => {
    const max: number = f.validation?.maxLength ?? (long ? 2_000 : 200);
    const min: number = f.validation?.minLength ?? 0;
    let v = long ? rand.paragraph(1, 3) : rand.words(2, 6);
    while (v.length < min) v += ` ${rand.word()}`;
    return v.slice(0, max);
  };

  const value = (f: Json): unknown => {
    switch (f.type) {
      case 'text':
        return f.validation?.pattern ? undefined : text(f, false);
      case 'textarea':
        return text(f, true);
      case 'number': {
        const min = f.validation?.min ?? 0;
        const max = f.validation?.max ?? Math.max(min + 100, 100);
        return rand.int(Math.ceil(min), Math.floor(max));
      }
      case 'boolean':
        return rand.bool();
      case 'date':
        return rand.date(1, 60);
      case 'select':
        return f.options?.length ? rand.pick(f.options as Json[]).value : undefined;
      case 'multiselect': {
        const opts = (f.options ?? []) as Json[];
        const min = Math.max(1, f.validation?.min ?? 1);
        const max = Math.min(opts.length, f.validation?.max ?? opts.length);
        return rand.sample(opts, min, Math.max(min, max)).map((o) => o.value);
      }
      case 'email':
        return `sim.${rand.suffix()}@example.com`;
      case 'url':
        return `https://example.com/${rand.suffix()}`;
      default:
        return undefined; // user, record, rows: the flow knows what to pick
    }
  };

  return {
    async published(key, persona) {
      return ctx.expect.ok(
        await ctx.as(persona).get(`/forms/by-key/${key}`),
        `${persona} opens the form ${key}`,
      ).body;
    },
    answers(schema, overrides = {}, opts = {}) {
      const out: Record<string, unknown> = {};
      for (const el of schema.elements ?? []) {
        if (!el.key || DISPLAY.has(el.type)) continue;
        if (el.key in overrides) {
          if (overrides[el.key] !== undefined) out[el.key] = overrides[el.key];
          continue;
        }
        if (!el.required && (opts.requiredOnly || !rand.bool(opts.optionalRate ?? 0.6))) continue;
        const v = value(el);
        if (v === undefined) {
          if (el.required)
            throw new FlowError(`the flow must answer the required ${el.type} field "${el.key}" itself`);
          continue;
        }
        out[el.key] = v;
      }
      return out;
    },
  };
}
