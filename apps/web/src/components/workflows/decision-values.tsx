'use client';

import type { FieldDef } from '@isbp/sdk';
import { FormAnswers } from '@isbp/ui/form-renderer';
import { usePeople } from '@isbp/ui/person-picker';
import { cn } from '@isbp/ui';
import { useMemo } from 'react';

/**
 * What an approver filled in with a decision (`ApprovalStep.fields`), read-only: labels and choices in the reader's
 * language, records as links, people by name (from `people`, or looked up).
 */
export function DecisionValues({
  fields,
  data,
  people,
  className,
}: {
  fields: readonly FieldDef[];
  data: Record<string, unknown>;
  /** Names of the people named in `data`, when the caller has them. */
  people?: Record<string, string>;
  className?: string;
}) {
  const shown = useMemo(
    () =>
      fields
        .filter((f) => data[f.key] !== undefined && data[f.key] !== null && data[f.key] !== '')
        .map((f) => ({ ...f, id: `decision-${f.key}`, visibleWhen: undefined })),
    [fields, data],
  );
  const missing = useMemo(
    () =>
      people
        ? []
        : shown
            .filter((f) => f.type === 'user' && typeof data[f.key] === 'string')
            .map((f) => String(data[f.key])),
    [people, shown, data],
  );
  const found = usePeople(missing);
  const names = useMemo(
    () => people ?? Object.fromEntries([...found].map(([id, p]) => [id, p.displayName])),
    [people, found],
  );
  if (!shown.length) return null;
  return (
    <FormAnswers
      elements={shown}
      data={data}
      people={names}
      className={cn('rounded-lg border bg-muted/30 px-3 py-2.5', className)}
    />
  );
}
