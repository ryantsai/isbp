'use client';

import type { AssistantPreviewProps } from '@isbp/module-assistant/contracts';
import { formSchemaSchema, type LocalizedText, localizedTextSchema } from '@isbp/sdk';
import { CircleAlertIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { FormPreview } from './form-preview';

/** The parts of a `core.form` value the preview needs (`{ key, name, description, icon, category, schema, … }`). */
function formOf(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const v = value as { name?: unknown; description?: unknown; icon?: unknown; schema?: unknown };
  const schema = formSchemaSchema.safeParse(v.schema);
  const name = localizedTextSchema.safeParse(v.name);
  if (!schema.success || !name.success) return null;
  const description = localizedTextSchema.safeParse(v.description);
  return {
    elements: schema.data.elements,
    rules: schema.data.rules,
    name: name.data,
    description: (description.success ? description.data : {}) as LocalizedText,
    icon: typeof v.icon === 'string' && v.icon ? v.icon : 'file-text',
  };
}

/**
 * Preview of a proposed request form on the change set page (`assistant.preview.core.form`): the form exactly as
 * people will see it in the portal, in any language, with a dry-run submit. Nothing is sent.
 */
export default function FormChangePreview({ value }: AssistantPreviewProps) {
  const t = useTranslations('forms.changePreview');
  const form = useMemo(() => formOf(value), [value]);
  if (!form)
    return (
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        {t('invalid')}
      </p>
    );
  return (
    <FormPreview
      elements={form.elements}
      rules={form.rules}
      name={form.name}
      description={form.description}
      icon={form.icon}
    />
  );
}
