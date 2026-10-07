'use client';

import { CodeEditor } from '@isbp/ui/code-editor';
import { InfoIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { jsonSchemaProblems } from '../../contracts';
import type { EditorProps } from './fields';

interface Schema {
  properties?: Record<string, { type?: string | string[]; description?: string }>;
  required?: string[];
}

/**
 * Config of a module task type that contributes no editor: JSON, checked as you type against the type's
 * JSON Schema (the server validates with the real schema on save).
 */
export function JsonConfigEditor({
  value,
  onChange,
  errors,
  disabled,
  schema,
}: EditorProps & { schema: unknown }) {
  const t = useTranslations('scheduler.json');
  const id = useId();
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [parseError, setParseError] = useState(false);
  const problems = useMemo(() => jsonSchemaProblems(value, schema), [value, schema]);
  const props = Object.entries((schema as Schema | null)?.properties ?? {});
  const required = new Set((schema as Schema | null)?.required ?? []);
  const serverErrors = Object.entries(errors);

  const change = (next: string) => {
    setText(next);
    try {
      const parsed: unknown = JSON.parse(next);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        setParseError(false);
        onChange(parsed as Record<string, unknown>);
        return;
      }
    } catch {
      /* not JSON (yet) */
    }
    setParseError(true);
  };

  return (
    <div className="grid min-w-0 gap-3">
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        {t('hint')}
      </p>
      <p id={`${id}-label`} className="text-sm font-medium">
        {t('label')}
      </p>
      <CodeEditor
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-problems`}
        aria-invalid={parseError || problems.length > 0 || serverErrors.length > 0}
        value={text}
        onChange={change}
        language="json"
        readOnly={disabled}
        minHeight="8rem"
      />
      <div id={`${id}-problems`} className="grid gap-1 text-xs" aria-live="polite">
        {parseError && <p className="font-medium text-destructive">{t('invalidJson')}</p>}
        {!parseError &&
          problems.map((p) => (
            <p key={`${p.path}-${p.problem}`} className="font-medium text-destructive">
              {t(`problems.${p.problem}`, { path: p.path || '—', expected: p.expected ?? '' })}
            </p>
          ))}
        {serverErrors.map(([path, message]) => (
          <p key={path} className="font-medium text-destructive">
            {path ? `${path}: ` : ''}
            {message}
          </p>
        ))}
      </div>
      {props.length > 0 && (
        <div className="min-w-0">
          <p className="mb-1 text-xs font-medium text-muted-foreground">{t('fields')}</p>
          <ul className="grid gap-0.5 text-xs">
            {props.map(([key, p]) => (
              <li key={key} className="min-w-0 wrap-anywhere">
                <code className="font-medium">{key}</code>
                <span className="text-muted-foreground">
                  {' '}
                  ({[p.type].flat().filter(Boolean).join(' | ') || t('any')}
                  {required.has(key) ? `, ${t('required')}` : ''}){p.description ? ` — ${p.description}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
