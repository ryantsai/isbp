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
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
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
import { useForm, useWatch } from 'react-hook-form';
import { Disclosure } from '@isbp/ui/motion';
import { Segmented } from '@/components/roles/segmented';
import { FormIconTile } from './form-meta';

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
  const watched = useWatch({ control: form.control });
  const answers = JSON.stringify(watched ?? {});
  useEffect(() => {
    onValues?.(JSON.parse(answers) as Record<string, unknown>);
  }, [answers, onValues]);
  const submit = form.handleSubmit(
    (values) => onResult({ ok: true, values: values as Record<string, FieldValue> }),
    (errors) => onResult({ ok: false, count: Object.keys(errors).length }),
  );
  const desc = localize(description, locale);
  return (
    <Card lang={htmlLang[locale as Locale]} className="mx-auto w-full max-w-2xl">
      <CardHeader className="flex items-start gap-3">
        <FormIconTile name={icon} className="size-10" />
        <div className="min-w-0 space-y-1">
          <CardTitle className="text-lg leading-tight">{localize(name, locale)}</CardTitle>
          {desc && <CardDescription>{desc}</CardDescription>}
        </div>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={submit} noValidate>
            <FormErrorSummary schema={schema} form={form} className="mb-4" />
            {elements.length ? (
              <FormFields elements={elements} form={form} />
            ) : (
              <p className="pb-4 text-sm text-muted-foreground">{t('empty')}</p>
            )}
            <div className="flex flex-wrap gap-2 border-t pt-4">
              <Button type="submit" disabled={!fields.length}>
                <SendIcon /> {t('submit')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  form.reset(defaultFieldValues(fields));
                  onResult(null);
                }}
              >
                <RotateCcwIcon /> {t('reset')}
              </Button>
            </div>
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <LanguagesIcon className="size-4" aria-hidden />
              <span id="preview-language">{t('language')}</span>
            </div>
            <Segmented
              label={t('language')}
              value={previewLocale}
              onChange={(l) => {
                setPreviewLocale(l);
                setResult(null);
              }}
              options={locales.map((l) => ({
                value: l,
                label: <span title={localeLabels[l]}>{SHORT[l]}</span>,
              }))}
            />
          </div>
          <AnimatePresence initial={false}>
            {missing > 0 && (
              <motion.p
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-start gap-2 overflow-hidden rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning-foreground"
              >
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                {t('missingTranslations', { count: missing, language: localeLabels[previewLocale] })}
              </motion.p>
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
            <CardContent className="pt-0">
              <Disclosure
                defaultOpen={!aside}
                summary={
                  <span className="grid gap-0.5">
                    <span className="text-sm font-semibold">{t('resultTitle')}</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {t('resultDescription')}
                    </span>
                  </span>
                }
              >
                <div aria-live="polite" className="pb-2">
                  {result === null ? (
                    <p className="text-sm text-muted-foreground">{t('resultEmpty')}</p>
                  ) : result.ok ? (
                    <motion.div
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="grid gap-3"
                    >
                      <Badge variant="success" className="text-sm">
                        <CircleCheckIcon aria-hidden /> {t('resultValid')}
                      </Badge>
                      <pre className="max-h-96 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed">
                        {JSON.stringify(result.values, null, 2)}
                      </pre>
                      <p className="text-xs text-muted-foreground">{t('resultNote')}</p>
                    </motion.div>
                  ) : (
                    <Badge variant="destructive" className="text-sm">
                      <TriangleAlertIcon aria-hidden /> {t('resultInvalid', { count: result.count })}
                    </Badge>
                  )}
                </div>
              </Disclosure>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
