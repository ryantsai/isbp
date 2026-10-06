'use client';

import { toNestErrors } from '@hookform/resolvers';
import type { FieldError, FieldValues, Resolver } from 'react-hook-form';
import type { z } from 'zod';

/** A problem attached to a form field (dotted RHF path) with an already-localised message. */
export interface FieldProblem {
  path: string;
  message: string;
}

/** Translator for the shared `validation.*` messages (each feature namespace provides them). */
export type ValidationText = (
  key: 'required' | 'invalid' | 'tooShort' | 'tooLong' | 'url' | 'format',
  values?: Record<string, number>,
) => string;

/** Code-based message for a zod issue — never the schema's English text, so it localises. */
export function issueMessage(issue: z.core.$ZodIssue, vt: ValidationText): string {
  switch (issue.code) {
    case 'invalid_type':
      return vt('required');
    case 'too_small':
      return issue.origin === 'string' && Number(issue.minimum) <= 1
        ? vt('required')
        : vt('tooShort', { min: Number(issue.minimum) });
    case 'too_big':
      return vt('tooLong', { max: Number(issue.maximum) });
    case 'invalid_format':
      return issue.format === 'url' ? vt('url') : vt('format');
    default:
      return vt('invalid');
  }
}

/**
 * Converts zod issues into field problems. `mapPath` re-targets a payload path onto a form field
 * (return `null` to drop it); `message` can override the default code-based text per field.
 */
export function zodProblems(
  issues: readonly z.core.$ZodIssue[] | undefined,
  vt: ValidationText,
  opts: {
    mapPath?: (path: string) => string | null;
    message?: (issue: z.core.$ZodIssue, field: string) => string | undefined;
  } = {},
): FieldProblem[] {
  const out: FieldProblem[] = [];
  for (const issue of issues ?? []) {
    const raw = issue.path.map((p) => String(p)).join('.');
    const field = opts.mapPath ? opts.mapPath(raw) : raw;
    if (!field) continue;
    out.push({ path: field, message: opts.message?.(issue, field) ?? issueMessage(issue, vt) });
  }
  return out;
}

/**
 * React Hook Form resolver around a function that validates the form (typically by building the
 * API payload and parsing it with the `@isbp/contracts` schema) and returns localised problems.
 */
export function problemResolver<T extends FieldValues>(validate: (values: T) => FieldProblem[]): Resolver<T> {
  return async (values, _context, options) => {
    const problems = validate(values);
    if (!problems.length) return { values, errors: {} };
    const flat: Record<string, FieldError> = {};
    for (const p of problems) flat[p.path] ??= { type: 'validate', message: p.message };
    return { values: {}, errors: toNestErrors(flat, options) };
  };
}
