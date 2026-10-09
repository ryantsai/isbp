'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

/** The parts of a Zod 4 issue the message map reads (structural, so `@isbp/ui` needs no zod dependency). */
export interface ZodIssueLike {
  code: string;
  input?: unknown;
  expected?: unknown;
  origin?: unknown;
  minimum?: unknown;
  maximum?: unknown;
  inclusive?: boolean;
  format?: unknown;
  divisor?: unknown;
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

const num = (v: unknown) => (typeof v === 'bigint' ? Number(v) : typeof v === 'number' ? v : NaN);

/**
 * Plain-language text for a validation issue ("Required", "Enter at least 2 characters", "Enter an email address,
 * like name@example.com"), or `undefined` to fall back to Zod's own text. Issues with their own message (custom
 * refinements) keep it.
 */
export function zodIssueText(issue: ZodIssueLike, t: Translate): string | undefined {
  const empty = issue.input === undefined || issue.input === null || issue.input === '';
  switch (issue.code) {
    case 'invalid_type':
      if (empty) return t('required');
      if (issue.expected === 'number' || issue.expected === 'int') return t('number');
      if (issue.expected === 'date') return t('date');
      return t('invalid');
    case 'too_small': {
      const min = num(issue.minimum);
      if (issue.origin === 'string') return min <= 1 ? t('required') : t('tooShort', { min });
      if (issue.origin === 'array' || issue.origin === 'set')
        return min <= 1 ? t('chooseOne') : t('chooseAtLeast', { min });
      if (issue.origin === 'number' || issue.origin === 'bigint')
        return issue.inclusive === false ? t('above', { min }) : t('atLeast', { min });
      return t('invalid');
    }
    case 'too_big': {
      const max = num(issue.maximum);
      if (issue.origin === 'string') return t('tooLong', { max });
      if (issue.origin === 'array' || issue.origin === 'set') return t('chooseAtMost', { max });
      if (issue.origin === 'number' || issue.origin === 'bigint')
        return issue.inclusive === false ? t('below', { max }) : t('atMost', { max });
      return t('invalid');
    }
    case 'invalid_format':
      if (issue.format === 'email') return t('email');
      if (issue.format === 'url') return t('url');
      if (issue.format === 'datetime' || issue.format === 'date' || issue.format === 'time') return t('date');
      return t('format');
    case 'invalid_value':
      return t('option');
    case 'not_multiple_of':
      return t('multipleOf', { divisor: num(issue.divisor) });
    default:
      return undefined;
  }
}

/**
 * The validation message map for the UI language. Install it once (the web app's root providers do):
 * `z.config({ ...z.locales.en(), customError: errorMap })`.
 */
export function useZodErrorMap() {
  const t = useTranslations('ui.validation');
  return useCallback((issue: ZodIssueLike) => zodIssueText(issue, t as Translate), [t]);
}
