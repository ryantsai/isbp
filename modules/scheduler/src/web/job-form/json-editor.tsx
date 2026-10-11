'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Field } from '@astryxdesign/core/Field';
import { FieldStatus } from '@astryxdesign/core/FieldStatus';
import { VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { CodeEditor } from '@isbp/ui/code-editor';
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
    <VStack gap={3}>
      <Banner role="status" status="info" collapsible={false} title={t('hint')} />
      <Field
        label={t('label')}
        isGroupLabel
        labelID={`${id}-label`}
        inputID={`${id}-editor`}
        descriptionID={`${id}-problems`}
      >
        <VStack gap={2}>
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
          <div id={`${id}-problems`} aria-live="polite">
            <VStack gap={1}>
              {parseError && <FieldStatus type="error" message={t('invalidJson')} variant="detached" />}
              {!parseError &&
                problems.map((p) => (
                  <FieldStatus
                    key={`${p.path}-${p.problem}`}
                    type="error"
                    variant="detached"
                    message={t(`problems.${p.problem}`, { path: p.path || '—', expected: p.expected ?? '' })}
                  />
                ))}
              {serverErrors.map(([path, message]) => (
                <FieldStatus
                  key={path}
                  type="error"
                  variant="detached"
                  message={`${path ? `${path}: ` : ''}${message}`}
                />
              ))}
            </VStack>
          </div>
        </VStack>
      </Field>
      {props.length > 0 && (
        <VStack gap={1}>
          <Text type="label" color="secondary">
            {t('fields')}
          </Text>
          <ul className="grid gap-0.5">
            {props.map(([key, p]) => (
              <li key={key} className="min-w-0 wrap-anywhere">
                <Text type="code" weight="medium">
                  {key}
                </Text>
                <Text type="supporting">
                  {' '}
                  ({[p.type].flat().filter(Boolean).join(' | ') || t('any')}
                  {required.has(key) ? `, ${t('required')}` : ''}){p.description ? ` — ${p.description}` : ''}
                </Text>
              </li>
            ))}
          </ul>
        </VStack>
      )}
    </VStack>
  );
}
