'use client';

import { htmlLang, type Locale, localeLabels, locales } from '@isbp/i18n';
import {
  defaultFieldValues,
  type FieldValue,
  type FormElement,
  type FormRule,
  type FormSchema,
  isField,
  type LocalizedText,
  localize,
} from '@isbp/sdk';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { Form } from '@isbp/ui/form';
import { FormErrorSummary, FormFields, useFormResolver } from '@isbp/ui/form-renderer';
import { CircleCheckIcon, LanguagesIcon, RotateCcwIcon, SendIcon, TriangleAlertIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  type AbstractIntlMessages,
  NextIntlClientProvider,
  useLocale,
  useMessages,
  useTranslations,
} from 'next-intl';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { FormIconTile } from './form-meta';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CodeBlock } from '@astryxdesign/core/CodeBlock';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Text } from '@astryxdesign/core/Text';

type Catalogs = { ui: AbstractIntlMessages; forms: AbstractIntlMessages };

/** The UI strings the preview needs in another language (field errors, pickers, the submit button). */
const CATALOGS: Record<Locale, () => Promise<Catalogs>> = {
  en: async () => ({
    ui: (await import('@isbp/i18n/messages/en/ui.json')).default,
    forms: (await import('@isbp/i18n/messages/en/forms.json')).default,
  }),
  'zh-TW': async () => ({
    ui: (await import('@isbp/i18n/messages/zh-TW/ui.json')).default,
    forms: (await import('@isbp/i18n/messages/zh-TW/forms.json')).default,
  }),
  'ja-JP': async () => ({
    ui: (await import('@isbp/i18n/messages/ja-JP/ui.json')).default,
    forms: (await import('@isbp/i18n/messages/ja-JP/forms.json')).default,
  }),
};

const SHORT: Record<Locale, string> = { en: 'EN', 'zh-TW': '繁中', 'ja-JP': '日本語' };

/** How many admin-written texts have no translation in `locale` (English is shown instead). */
function missingTexts(elements: readonly FormElement[], extra: LocalizedText[], locale: Locale): number {
  const texts: (LocalizedText | undefined)[] = [...extra];
  for (const el of elements) {
    if (isField(el)) {
      texts.push(el.label, el.help, el.placeholder, ...(el.options ?? []).map((o) => o.label));
    } else texts.push(el.text);
  }
  return texts.filter((x) => x && Object.values(x).some(Boolean) && !x[locale]?.trim()).length;
}

type Result = { ok: true; values: Record<string, FieldValue> } | { ok: false; count: number };

function PreviewForm({
  elements,
  rules,
  name,
  description,
  icon,
  onResult,
  onValues,
}: {
  elements: readonly FormElement[];
  rules?: readonly FormRule[];
  name: LocalizedText;
  description: LocalizedText;
  icon: string;
  onResult: (r: Result | null) => void;
  onValues?: (values: Record<string, unknown>) => void;
}) {
  const locale = useLocale();
  const t = useTranslations('forms.preview');
  const fields = useMemo(() => elements.filter(isField), [elements]);
  const schema = useMemo<FormSchema>(
    () => ({ elements: [...elements], rules: rules?.length ? [...rules] : undefined }),
    [elements, rules],
  );
  const resolver = useFormResolver(schema);
  const form = useForm({ resolver, defaultValues: defaultFieldValues(fields) });
  // The answers go out through a subscription, once typing pauses: watching them here re-rendered the whole preview, and
  // `onValues` the whole builder, on every keystroke.
  useEffect(() => {
    if (!onValues) return;
    let last = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const emit = () => {
      const answers = JSON.stringify(form.getValues() ?? {});
      if (answers === last) return;
      last = answers;
      onValues(JSON.parse(answers) as Record<string, unknown>);
    };
    emit();
    const unsubscribe = form.subscribe({
      formState: { values: true },
      callback: () => {
        clearTimeout(timer);
        timer = setTimeout(emit, 250);
      },
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [form, onValues]);
  const submit = form.handleSubmit(
    (values) => onResult({ ok: true, values: values as Record<string, FieldValue> }),
    (errors) => onResult({ ok: false, count: Object.keys(errors).length }),
  );
  const desc = localize(description, locale);
  return (
    <Card lang={htmlLang[locale as Locale]} className="mx-auto w-full max-w-2xl">
      <CardHeader>
        <HStack gap={3} vAlign="start">
          <FormIconTile name={icon} size="default" />
          <StackItem size="fill">
            <VStack gap={1}>
              <CardTitle>{localize(name, locale)}</CardTitle>
              {desc && <CardDescription>{desc}</CardDescription>}
            </VStack>
          </StackItem>
        </HStack>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={submit} noValidate>
            <FormErrorSummary schema={schema} form={form} className="mb-4" />
            {elements.length ? (
              <FormFields elements={elements} form={form} />
            ) : (
              <Text as="p" color="secondary">
                {t('empty')}
              </Text>
            )}
            <HStack gap={2} wrap="wrap" paddingBlockStart={4}>
              <Button
                label={t('submit')}
                variant="primary"
                icon={<Icon icon={SendIcon} />}
                isDisabled={!fields.length}
                type="submit"
              />
              <Button
                label={t('reset')}
                variant="ghost"
                icon={<Icon icon={RotateCcwIcon} />}
                onClick={() => {
                  form.reset(defaultFieldValues(fields));
                  onResult(null);
                }}
              />
            </HStack>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

/**
 * The form exactly as people will see it, in any language, with a dry-run submit (fields and rules). `aside` shows
 * next to it (the builder: who would approve the sample answers, what happens next), `onValues` gets the answers.
 */
export function FormPreview({
  elements,
  rules,
  name,
  description,
  icon,
  aside,
  onValues,
}: {
  elements: readonly FormElement[];
  rules?: readonly FormRule[];
  name: LocalizedText;
  description: LocalizedText;
  icon: string;
  aside?: ReactNode;
  onValues?: (values: Record<string, unknown>) => void;
}) {
  const t = useTranslations('forms.preview');
  const current = useLocale() as Locale;
  const messages = useMessages();
  const [previewLocale, setPreviewLocale] = useState<Locale>(current);
  const [loaded, setLoaded] = useState<Partial<Record<Locale, Catalogs>>>({});
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    if (previewLocale === current || loaded[previewLocale]) return;
    let cancelled = false;
    void CATALOGS[previewLocale]().then((c) => {
      if (!cancelled) setLoaded((prev) => ({ ...prev, [previewLocale]: c }));
    });
    return () => {
      cancelled = true;
    };
  }, [previewLocale, current, loaded]);

  const catalogs = loaded[previewLocale];
  const merged = useMemo(
    () => (previewLocale !== current && catalogs ? { ...messages, ...catalogs } : messages),
    [previewLocale, current, catalogs, messages],
  );
  const ready = previewLocale === current || Boolean(catalogs);
  const missing = missingTexts(
    elements,
    [name, description, ...(rules ?? []).map((r) => r.message)],
    previewLocale,
  );

  // Laid out by the space it gets: the builder's preview tab, or a narrow card on a change set's page.
  return (
    <div className="@container min-w-0">
      <div className="grid min-w-0 items-start gap-4 @3xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid min-w-0 gap-4">
          <HStack gap={3} wrap="wrap" hAlign="between" vAlign="center">
            <HStack gap={2} vAlign="center">
              <Icon icon={LanguagesIcon} color="secondary" />
              <Text color="secondary" id="preview-language">
                {t('language')}
              </Text>
            </HStack>
            <SegmentedControl
              label={t('language')}
              value={previewLocale}
              onChange={(l) => {
                setPreviewLocale(l as Locale);
                setResult(null);
              }}
            >
              {locales.map((l) => (
                <SegmentedControlItem key={l} value={l} label={SHORT[l]} />
              ))}
            </SegmentedControl>
          </HStack>
          <AnimatePresence initial={false}>
            {missing > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <Banner
                  status="warning"
                  collapsible={false}
                  title={t('missingTranslations', { count: missing, language: localeLabels[previewLocale] })}
                />
              </motion.div>
            )}
          </AnimatePresence>
          {ready && (
            <NextIntlClientProvider locale={previewLocale} messages={merged}>
              <PreviewForm
                key={previewLocale}
                elements={elements}
                rules={rules}
                name={name}
                description={description}
                icon={icon}
                onResult={setResult}
                onValues={onValues}
              />
            </NextIntlClientProvider>
          )}
        </div>
        <div className="grid min-w-0 gap-4 @3xl:sticky @3xl:top-20">
          {aside}
          <Card>
            <CardContent>
              <Collapsible
                defaultIsOpen={!aside}
                trigger={
                  <VStack gap={0.5}>
                    <Text weight="semibold">{t('resultTitle')}</Text>
                    <Text type="supporting">{t('resultDescription')}</Text>
                  </VStack>
                }
              >
                <div aria-live="polite" className="pb-2">
                  {result === null ? (
                    <Text color="secondary">{t('resultEmpty')}</Text>
                  ) : result.ok ? (
                    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
                      <VStack gap={3} hAlign="start">
                        <Badge
                          variant="success"
                          label={t('resultValid')}
                          icon={<Icon icon={CircleCheckIcon} size="xsm" />}
                        />
                        <CodeBlock
                          code={JSON.stringify(result.values, null, 2)}
                          language="json"
                          hasLanguageLabel={false}
                          maxHeight={384}
                          width="100%"
                        />
                        <Text type="supporting">{t('resultNote')}</Text>
                      </VStack>
                    </motion.div>
                  ) : (
                    <Badge
                      variant="error"
                      label={t('resultInvalid', { count: result.count })}
                      icon={<Icon icon={TriangleAlertIcon} size="xsm" />}
                    />
                  )}
                </div>
              </Collapsible>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
