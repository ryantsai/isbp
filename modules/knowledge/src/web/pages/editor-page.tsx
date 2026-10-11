'use client';

import { Button } from '@astryxdesign/core/Button';
import type { ISODateString } from '@astryxdesign/core/Calendar';
import { DateInput } from '@astryxdesign/core/DateInput';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import { Selector } from '@astryxdesign/core/Selector';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { zodResolver } from '@hookform/resolvers/zod';
import type { RecordPanelSlotProps } from '@isbp/contracts';
import { localize } from '@isbp/sdk';
import { ApiError, Slot, useCan, type WebPageProps } from '@isbp/sdk/web';
import { Card, CardContent } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { fieldStatus, Form, FormField } from '@isbp/ui/form';
import { Markdown } from '@isbp/ui/markdown';
import { countFilled, OptionalFields } from '@isbp/ui/optional-fields';
import { PageHeader } from '@isbp/ui/page-header';
import { applyServerErrors, useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { toast } from '@isbp/ui/toast';
import {
  EyeIcon,
  LockIcon,
  PaperclipIcon,
  PencilLineIcon,
  SaveIcon,
  SendIcon,
  UploadIcon,
  UsersIcon,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { type FieldErrors, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import {
  ARTICLE_LOCALES,
  type Article,
  type ArticleAudience,
  type ArticleLocale,
  type Category,
  type CreateArticleInput,
  type SubmitOutcome,
  type UpdateArticleInput,
} from '../../contracts';
import { ArticlePicker, TagsInput } from '../inputs';
import { markdownShortcut, MarkdownToolbar, useMarkdownFormat } from '../markdown-toolbar';
import { ARTICLE_PROSE, LOCALE_LABEL, LOCALE_LANG, useClassifications } from '../parts';

const NONE = '__none';
const AUDIENCES: { value: ArticleAudience; icon: typeof UsersIcon }[] = [
  { value: 'everyone', icon: UsersIcon },
  { value: 'agents', icon: LockIcon },
];
/** Fields under "More settings": most articles never need them. */
const MORE_FIELDS = ['classification', 'tags', 'locale', 'translationOf', 'reviewAt'] as const;

function useFormSchema() {
  const t = useTranslations('knowledge.editor.errors');
  return useMemo(
    () =>
      z.object({
        title: z
          .string()
          .trim()
          .min(1, t('titleRequired'))
          .max(300, t('tooLong', { max: 300 })),
        summary: z
          .string()
          .trim()
          .max(500, t('tooLong', { max: 500 })),
        body: z.string().max(50_000, t('tooLong', { max: 50_000 })),
        categoryId: z.string(),
        classification: z.string(),
        tags: z.array(z.string()).max(10),
        audience: z.enum(['everyone', 'agents']),
        locale: z.enum(ARTICLE_LOCALES),
        translationOf: z.string().nullable(),
        reviewAt: z.string().refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), t('date')),
      }),
    [t],
  );
}
type Values = z.infer<ReturnType<typeof useFormSchema>>;

/** The author's UI language when articles can be written in it (they write in the language they work in). */
function useAuthorLocale(): ArticleLocale {
  const ui = useLocale();
  return (ARTICLE_LOCALES as readonly string[]).includes(ui) ? (ui as ArticleLocale) : 'en';
}

function emptyValues(locale: ArticleLocale): Values {
  return {
    title: '',
    summary: '',
    body: '',
    categoryId: NONE,
    classification: NONE,
    tags: [],
    audience: 'everyone',
    locale,
    translationOf: null,
    reviewAt: '',
  };
}

function toValues(a: Article): Values {
  return {
    title: a.title,
    summary: a.summary,
    body: a.body,
    categoryId: a.category?.id ?? NONE,
    classification: a.classification ?? NONE,
    tags: a.tags,
    audience: a.audience,
    locale: a.locale,
    translationOf: a.translations[0]?.id ?? null,
    reviewAt: a.reviewAt ?? '',
  };
}

/**
 * Writes and edits articles: title, summary, Markdown body with a formatting toolbar and a preview, then category
 * and audience; the rarely needed settings sit under "More settings". The main button says what happens: "Publish"
 * for people whose submission goes live, "Submit for review" when an editor or an approval decides.
 */
export default function EditorPage({ params }: WebPageProps) {
  const t = useTranslations('knowledge.editor');
  const tk = useTranslations('knowledge');
  const tc = useTranslations('common');
  const locale = useLocale();
  const authorLocale = useAuthorLocale();
  const canPublish = useCan('knowledge.articles.publish');
  const router = useRouter();
  const sp = useSearchParams();
  const errorText = useErrorText();
  const panelId = useId();
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const ref = params.ref;
  const editing = Boolean(ref);
  const translationOfParam = editing ? null : sp.get('translationOf');

  const existing = useApiQuery<Article>(ref ? `/knowledge/articles/${encodeURIComponent(ref)}` : null);
  const original = useApiQuery<Article>(
    translationOfParam ? `/knowledge/articles/${translationOfParam}` : null,
  );
  const categories = useApiQuery<{ items: Category[] }>('/knowledge/categories');
  const classifications = useClassifications();
  const schema = useFormSchema();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: emptyValues(authorLocale) });
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [moreOpen, setMoreOpen] = useState(false);
  const [translationLabel, setTranslationLabel] = useState<{ reference: string; title: string } | null>(null);

  // Load the article being edited, or prefill a translation from its original.
  useEffect(() => {
    if (existing.data) {
      const values = toValues(existing.data);
      form.reset(values);
      const first = existing.data.translations[0];
      setTranslationLabel(first ? { reference: first.reference, title: first.title } : null);
    }
  }, [existing.data, form]);
  useEffect(() => {
    const o = original.data;
    if (!o) return;
    const taken = new Set([o.locale, ...o.translations.map((x) => x.locale)]);
    // The author's own language when the group doesn't have it yet, else the first one missing.
    const language = !taken.has(authorLocale)
      ? authorLocale
      : (ARTICLE_LOCALES.find((l) => !taken.has(l)) ?? authorLocale);
    form.reset({
      ...emptyValues(authorLocale),
      categoryId: o.category?.id ?? NONE,
      classification: o.classification ?? NONE,
      tags: o.tags,
      audience: o.audience,
      locale: language,
      translationOf: o.id,
    });
    // A translation: show its language and source, so the author sees what they're writing.
    setMoreOpen(true);
    setTranslationLabel({ reference: o.reference, title: o.title });
  }, [original.data, form, authorLocale]);

  const body = useWatch({ control: form.control, name: 'body' });
  const audience = useWatch({ control: form.control, name: 'audience' });
  const categoryId = useWatch({ control: form.control, name: 'categoryId' });
  const translationOf = useWatch({ control: form.control, name: 'translationOf' });
  const language = useWatch({ control: form.control, name: 'locale' });
  const tags = useWatch({ control: form.control, name: 'tags' });
  const classification = useWatch({ control: form.control, name: 'classification' });
  const reviewAt = useWatch({ control: form.control, name: 'reviewAt' });
  const moreFilled = countFilled(
    classification === NONE ? '' : classification,
    reviewAt,
    translationOf,
    tags,
    language === authorLocale ? '' : language,
  );

  const status = existing.data?.status ?? 'draft';
  // What "submit" will do with the values as they are now: an approval workflow's conditions read the audience,
  // language and category. Until the answer arrives, the article's own answer or the permission is the best guess.
  const outcomeQuery = useApiQuery<{ outcome: SubmitOutcome }>(
    status === 'draft' ? '/knowledge/articles/submit-outcome' : null,
    { audience, locale: language, categoryId: categoryId === NONE ? undefined : categoryId },
  );
  const outcome: SubmitOutcome =
    outcomeQuery.data?.outcome ?? existing.data?.submitOutcome ?? (canPublish ? 'publish' : 'review');

  const format = useMarkdownFormat(bodyRef, (value) =>
    form.setValue('body', value, { shouldDirty: true, shouldValidate: form.formState.isSubmitted }),
  );

  const save = useApiMutation(
    async (api, { values, submit }: { values: Values; submit: boolean }) => {
      const payload = {
        title: values.title,
        summary: values.summary,
        body: values.body,
        categoryId: values.categoryId === NONE ? null : values.categoryId,
        classification: values.classification === NONE ? null : values.classification,
        tags: values.tags,
        audience: values.audience,
        locale: values.locale,
        reviewAt: values.reviewAt || null,
      };
      let article: Article;
      if (existing.data) {
        const patch: UpdateArticleInput = { ...payload };
        // Only re-link translations when the field changed (the group is otherwise left alone).
        if (values.translationOf !== (existing.data.translations[0]?.id ?? null))
          patch.translationOf = values.translationOf;
        article = await api.patch<Article>(`/knowledge/articles/${existing.data.id}`, patch);
      } else {
        const create: CreateArticleInput = { ...payload, translationOf: values.translationOf };
        article = await api.post<Article>('/knowledge/articles', create);
      }
      return submit && article.actions.includes('submit')
        ? api.post<Article>(`/knowledge/articles/${article.id}/submit`)
        : article;
    },
    {
      invalidate: ['/knowledge/'],
      silent: true,
      // Say what happened, not what was clicked: live, waiting for an editor, or in an approval.
      success: (a) =>
        a.status === 'published'
          ? existing.data?.status === 'published'
            ? t('toast.updatedLive')
            : tk('toast.published')
          : a.status === 'in_review' && existing.data?.status !== 'in_review'
            ? a.awaitingApproval
              ? tk('toast.sentForApproval')
              : tk('toast.submitted')
            : t('toast.saved'),
      onSuccess: (a) => router.push(a.href),
    },
  );

  const openMoreFor = (errors: FieldErrors<Values>) => {
    if (MORE_FIELDS.some((k) => errors[k])) setMoreOpen(true);
  };
  const run = (submit: boolean) =>
    form.handleSubmit(
      (values) =>
        save.mutate(
          { values, submit },
          {
            onError: (err) => {
              if (applyServerErrors(err, form.setError)) {
                openMoreFor(form.formState.errors);
                return;
              }
              if (err instanceof ApiError && err.code === 'CONFLICT') {
                const reference = (err.details as { reference?: string } | undefined)?.reference ?? '';
                form.setError('locale', { message: t('errors.localeTaken', { reference }) });
                setMoreOpen(true);
                return;
              }
              toast.error(errorText(err));
            },
          },
        ),
      openMoreFor,
    );

  if (editing && existing.isLoading) return <Skeleton className="h-[32rem] max-w-6xl rounded-xl" />;
  if (editing && (existing.error || (existing.data && !existing.data.canEdit)))
    return <EmptyState icon={<LockIcon />} title={t('cannotEdit')} />;

  const backHref = existing.data?.href ?? (original.data?.href || '/knowledge/manage');
  const backLabel = existing.data?.reference ?? original.data?.reference ?? tk('nav.manage');
  const submitLabel = outcome === 'publish' ? tk('actions.publish') : tk('actions.submit');

  return (
    <div className="max-w-6xl">
      <PageHeader
        back={{ href: backHref, label: backLabel }}
        title={editing ? t('editTitle') : translationOfParam ? t('translateTitle') : t('newTitle')}
        description={status === 'published' ? t('publishedHint') : t('hint')}
      />
      <Form {...form}>
        <form
          onSubmit={run(false)}
          noValidate
          className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]"
        >
          <Card className="min-w-0">
            <CardContent>
              <FormLayout defaultOptionality="optional">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field, fieldState }) => (
                    <TextInput
                      label={t('title')}
                      isRequired
                      size="lg"
                      hasAutoFocus={!editing}
                      value={field.value}
                      onChange={(v) => field.onChange(v.slice(0, 300))}
                      onBlur={field.onBlur}
                      ref={field.ref}
                      status={fieldStatus(fieldState)}
                    />
                  )}
                />
                <FormField
                  control={form.control}
                  name="summary"
                  render={({ field, fieldState }) => (
                    <TextArea
                      label={t('summary')}
                      description={t('summaryHint')}
                      rows={2}
                      maxLength={500}
                      value={field.value}
                      onChange={(v) => field.onChange(v.slice(0, 500))}
                      onBlur={field.onBlur}
                      ref={field.ref}
                      status={fieldStatus(fieldState)}
                    />
                  )}
                />
                <FormField
                  control={form.control}
                  name="body"
                  render={({ field, fieldState }) => (
                    <VStack gap={3}>
                      <HStack gap={2} hAlign="between" vAlign="end" wrap="wrap">
                        <Text type="label">{t('body')}</Text>
                        <TabList
                          role="tablist"
                          aria-label={t('body')}
                          value={tab}
                          onChange={(v) => setTab(v as 'write' | 'preview')}
                        >
                          <Tab
                            value="write"
                            label={t('write')}
                            icon={<Icon icon={PencilLineIcon} />}
                            panelId={panelId}
                          />
                          <Tab
                            value="preview"
                            label={t('preview')}
                            icon={<Icon icon={EyeIcon} />}
                            panelId={panelId}
                          />
                        </TabList>
                      </HStack>
                      <div role="tabpanel" id={panelId} aria-label={t(tab)} className="min-w-0">
                        {tab === 'write' ? (
                          <VStack gap={2}>
                            <MarkdownToolbar run={format} />
                            <div lang={LOCALE_LANG[language]}>
                              <TextArea
                                label={t('body')}
                                isLabelHidden
                                description={t('markdownHint')}
                                value={field.value}
                                onChange={field.onChange}
                                onBlur={field.onBlur}
                                ref={(el) => {
                                  field.ref(el);
                                  bodyRef.current = el;
                                }}
                                onKeyDown={(e) => markdownShortcut(e, format)}
                                rows={22}
                                hasSpellCheck
                                status={fieldStatus(fieldState)}
                              />
                            </div>
                          </VStack>
                        ) : (
                          <div
                            className="min-h-80 rounded-lg border bg-background p-4"
                            lang={LOCALE_LANG[language]}
                          >
                            {body.trim() ? (
                              <Markdown className={ARTICLE_PROSE}>{body}</Markdown>
                            ) : (
                              <Text color="secondary">{t('previewEmpty')}</Text>
                            )}
                          </div>
                        )}
                      </div>
                    </VStack>
                  )}
                />
              </FormLayout>
            </CardContent>
          </Card>

          <div className="grid min-w-0 content-start gap-4">
            <Card>
              <CardContent>
                <FormLayout defaultOptionality="optional">
                  <FormField
                    control={form.control}
                    name="categoryId"
                    render={({ field, fieldState }) => (
                      <Selector
                        label={t('category')}
                        hasSearch={(categories.data?.items.length ?? 0) > 8}
                        value={field.value}
                        onChange={field.onChange}
                        status={fieldStatus(fieldState)}
                        options={[
                          { value: NONE, label: t('noCategory') },
                          ...(categories.data?.items ?? []).map((c) => ({
                            value: c.id,
                            label: localize(c.name, locale) || c.key,
                          })),
                        ]}
                      />
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="audience"
                    render={({ field }) => (
                      <RadioList label={t('audience')} value={field.value} onChange={field.onChange}>
                        {AUDIENCES.map(({ value, icon }) => (
                          <RadioListItem
                            key={value}
                            value={value}
                            label={tk(`audience.${value}`)}
                            description={tk(`audienceHint.${value}`)}
                            startContent={<Icon icon={icon} color="secondary" />}
                          />
                        ))}
                      </RadioList>
                    )}
                  />

                  <OptionalFields
                    open={moreOpen}
                    onOpenChange={setMoreOpen}
                    label={t('moreSettings')}
                    hint={t('moreSettingsSummary', { language: LOCALE_LABEL[language], tags: tags.length })}
                    filled={moreFilled}
                    contentClassName="grid gap-5 pt-3"
                  >
                    <FormLayout defaultOptionality="optional">
                      <FormField
                        control={form.control}
                        name="locale"
                        render={({ field, fieldState }) => (
                          <Selector
                            label={t('language')}
                            description={t('languageHint')}
                            value={field.value}
                            onChange={(v) => field.onChange(v as ArticleLocale)}
                            status={fieldStatus(fieldState)}
                            options={ARTICLE_LOCALES.map((l) => ({ value: l, label: LOCALE_LABEL[l] }))}
                          />
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="translationOf"
                        render={({ field, fieldState }) => (
                          <ArticlePicker
                            label={t('translationOf')}
                            description={translationOf ? t('translationOfSet') : t('translationOfHint')}
                            value={field.value}
                            selected={translationLabel}
                            excludeId={existing.data?.id}
                            status={fieldStatus(fieldState)}
                            onChange={(a) => {
                              field.onChange(a?.id ?? null);
                              setTranslationLabel(a ? { reference: a.reference, title: a.title } : null);
                            }}
                          />
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="tags"
                        render={({ field, fieldState }) => (
                          <TagsInput
                            label={t('tags')}
                            description={t('tagsHint')}
                            value={field.value}
                            onChange={field.onChange}
                            status={fieldStatus(fieldState)}
                          />
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="classification"
                        render={({ field, fieldState }) => (
                          <Selector
                            label={t('classification')}
                            description={t('classificationHint')}
                            value={field.value}
                            onChange={field.onChange}
                            status={fieldStatus(fieldState)}
                            options={[
                              { value: NONE, label: t('noClassification') },
                              ...classifications.levels.map((l) => ({
                                value: l.key,
                                label: classifications.label(l.key),
                              })),
                              ...(field.value !== NONE &&
                              !classifications.levels.some((l) => l.key === field.value)
                                ? [{ value: field.value, label: classifications.label(field.value) }]
                                : []),
                            ]}
                          />
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="reviewAt"
                        render={({ field, fieldState }) => (
                          <DateInput
                            label={t('reviewAt')}
                            description={t('reviewAtHint')}
                            hasClear
                            value={field.value ? (field.value as ISODateString) : undefined}
                            onChange={(d) => field.onChange(d ?? '')}
                            status={fieldStatus(fieldState)}
                          />
                        )}
                      />
                    </FormLayout>
                  </OptionalFields>
                </FormLayout>
              </CardContent>
            </Card>

            {/* Attachments belong to a saved article (the platform's attachments panel); a new one says so. */}
            {existing.data ? (
              <div className="min-w-0">
                <Slot<RecordPanelSlotProps>
                  name="core.record.files"
                  props={{ record: { type: 'knowledge.article', id: existing.data.id } }}
                />
              </div>
            ) : (
              <p className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
                <PaperclipIcon className="size-4 shrink-0" aria-hidden />
                {t('attachmentsLater')}
              </p>
            )}

            {/* The decision first on a wide screen (it stays in view); after the settings on a phone. */}
            <div className="order-last grid gap-2 lg:order-first">
              {status === 'draft' && (
                <Button
                  label={submitLabel}
                  variant="primary"
                  icon={<Icon icon={outcome === 'publish' ? UploadIcon : SendIcon} />}
                  type="button"
                  onClick={run(true)}
                  isLoading={save.isPending && save.variables?.submit}
                />
              )}
              <Button
                label={
                  status === 'published'
                    ? t('publishUpdate')
                    : status === 'draft'
                      ? t('saveDraft')
                      : tc('saveChanges')
                }
                variant={status === 'draft' ? 'secondary' : 'primary'}
                icon={<Icon icon={status === 'published' ? UploadIcon : SaveIcon} />}
                type="submit"
                isLoading={save.isPending && !save.variables?.submit}
              />
              <Button label={tc('cancel')} variant="ghost" href={backHref} />
              {status === 'draft' && (
                <div aria-live="polite">
                  <Text type="supporting">{t(`outcome.${outcome}`)}</Text>
                </div>
              )}
            </div>
          </div>
        </form>
      </Form>
    </div>
  );
}
