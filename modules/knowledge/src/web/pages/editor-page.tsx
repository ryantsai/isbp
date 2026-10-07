'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { localize } from '@isbp/sdk';
import { ApiError, type WebPageProps } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { Card, CardContent } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@isbp/ui/form';
import { Input } from '@isbp/ui/input';
import { Markdown } from '@isbp/ui/markdown';
import { PageHeader } from '@isbp/ui/page-header';
import { applyServerErrors, useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Skeleton } from '@isbp/ui/skeleton';
import { toast } from '@isbp/ui/sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import { Textarea } from '@isbp/ui/textarea';
import {
  ArrowLeftIcon,
  EyeIcon,
  LockIcon,
  PencilLineIcon,
  SaveIcon,
  SendIcon,
  UploadIcon,
  UsersIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import {
  ARTICLE_LOCALES,
  type Article,
  type ArticleAudience,
  type ArticleLocale,
  type Category,
  type CreateArticleInput,
  type UpdateArticleInput,
} from '../../contracts';
import { ArticlePicker, TagsInput } from '../inputs';
import { LOCALE_LABEL, LOCALE_LANG } from '../parts';

const NONE = '__none';
const AUDIENCES: { value: ArticleAudience; icon: typeof UsersIcon }[] = [
  { value: 'everyone', icon: UsersIcon },
  { value: 'agents', icon: LockIcon },
];

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

const EMPTY: Values = {
  title: '',
  summary: '',
  body: '',
  categoryId: NONE,
  tags: [],
  audience: 'everyone',
  locale: 'en',
  translationOf: null,
  reviewAt: '',
};

function toValues(a: Article): Values {
  return {
    title: a.title,
    summary: a.summary,
    body: a.body,
    categoryId: a.category?.id ?? NONE,
    tags: a.tags,
    audience: a.audience,
    locale: a.locale,
    translationOf: a.translations[0]?.id ?? null,
    reviewAt: a.reviewAt ?? '',
  };
}

/** Writes and edits articles: Markdown with a live preview, metadata on the side. */
export default function EditorPage({ params }: WebPageProps) {
  const t = useTranslations('knowledge.editor');
  const tk = useTranslations('knowledge');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const sp = useSearchParams();
  const errorText = useErrorText();
  const ref = params.ref;
  const editing = Boolean(ref);
  const translationOfParam = editing ? null : sp.get('translationOf');

  const existing = useApiQuery<Article>(ref ? `/knowledge/articles/${encodeURIComponent(ref)}` : null);
  const original = useApiQuery<Article>(
    translationOfParam ? `/knowledge/articles/${translationOfParam}` : null,
  );
  const categories = useApiQuery<{ items: Category[] }>('/knowledge/categories');
  const schema = useFormSchema();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: EMPTY });
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [translationLabel, setTranslationLabel] = useState<{ reference: string; title: string } | null>(null);

  // Load the article being edited, or prefill a translation from its original.
  useEffect(() => {
    if (existing.data) {
      form.reset(toValues(existing.data));
      const first = existing.data.translations[0];
      setTranslationLabel(first ? { reference: first.reference, title: first.title } : null);
    }
  }, [existing.data, form]);
  useEffect(() => {
    const o = original.data;
    if (!o) return;
    const taken = new Set([o.locale, ...o.translations.map((x) => x.locale)]);
    form.reset({
      ...EMPTY,
      categoryId: o.category?.id ?? NONE,
      tags: o.tags,
      audience: o.audience,
      locale: ARTICLE_LOCALES.find((l) => !taken.has(l)) ?? 'en',
      translationOf: o.id,
    });
    setTranslationLabel({ reference: o.reference, title: o.title });
  }, [original.data, form]);

  const body = useWatch({ control: form.control, name: 'body' });
  const audience = useWatch({ control: form.control, name: 'audience' });
  const translationOf = useWatch({ control: form.control, name: 'translationOf' });
  const language = useWatch({ control: form.control, name: 'locale' });

  const save = useApiMutation(
    async (api, { values, submit }: { values: Values; submit: boolean }) => {
      const payload = {
        title: values.title,
        summary: values.summary,
        body: values.body,
        categoryId: values.categoryId === NONE ? null : values.categoryId,
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

  const run = (submit: boolean) =>
    form.handleSubmit((values) =>
      save.mutate(
        { values, submit },
        {
          onError: (err) => {
            if (applyServerErrors(err, form.setError)) return;
            if (err instanceof ApiError && err.code === 'CONFLICT') {
              const reference = (err.details as { reference?: string } | undefined)?.reference ?? '';
              form.setError('locale', { message: t('errors.localeTaken', { reference }) });
              return;
            }
            toast.error(errorText(err));
          },
        },
      ),
    );

  if (editing && existing.isLoading) return <Skeleton className="mx-auto h-[32rem] max-w-6xl rounded-xl" />;
  if (editing && (existing.error || (existing.data && !existing.data.canEdit)))
    return <EmptyState icon={<LockIcon />} title={t('cannotEdit')} />;

  const status = existing.data?.status ?? 'draft';
  const backHref = existing.data?.href ?? (original.data?.href || '/knowledge/manage');

  return (
    <div className="mx-auto max-w-6xl">
      <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2 text-muted-foreground">
        <Link href={backHref}>
          <ArrowLeftIcon /> {existing.data?.reference ?? original.data?.reference ?? tk('nav.manage')}
        </Link>
      </Button>
      <PageHeader
        title={editing ? t('editTitle') : translationOfParam ? t('translateTitle') : t('newTitle')}
        description={status === 'published' ? t('publishedHint') : t('hint')}
      />
      <Form {...form}>
        <form
          onSubmit={run(false)}
          noValidate
          className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]"
        >
          <Card className="min-w-0">
            <CardContent className="grid gap-5">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('title')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        autoFocus={!editing}
                        maxLength={300}
                        className="text-base font-medium"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="summary"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('summary')}</FormLabel>
                    <FormControl>
                      <Textarea {...field} rows={2} maxLength={500} />
                    </FormControl>
                    <FormDescription>{t('summaryHint')}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="body"
                render={({ field }) => (
                  <FormItem>
                    <Tabs
                      value={tab}
                      onValueChange={(v) => setTab(v as 'write' | 'preview')}
                      className="gap-3"
                    >
                      <div className="flex flex-wrap items-end justify-between gap-2">
                        <FormLabel>{t('body')}</FormLabel>
                        <TabsList aria-label={t('body')}>
                          <TabsTrigger value="write">
                            <PencilLineIcon aria-hidden /> {t('write')}
                          </TabsTrigger>
                          <TabsTrigger value="preview">
                            <EyeIcon aria-hidden /> {t('preview')}
                          </TabsTrigger>
                        </TabsList>
                      </div>
                      <TabsContent value="write" className="grid gap-2">
                        <FormControl>
                          <Textarea
                            {...field}
                            rows={22}
                            className="min-h-80 font-mono text-[13px] leading-relaxed"
                            spellCheck
                          />
                        </FormControl>
                        <FormDescription>{t('markdownHint')}</FormDescription>
                      </TabsContent>
                      <TabsContent value="preview">
                        <div
                          className="min-h-80 rounded-lg border bg-background p-4"
                          lang={LOCALE_LANG[language]}
                        >
                          {body.trim() ? (
                            <Markdown>{body}</Markdown>
                          ) : (
                            <p className="text-sm text-muted-foreground">{t('previewEmpty')}</p>
                          )}
                        </div>
                      </TabsContent>
                    </Tabs>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <div className="grid min-w-0 content-start gap-4">
            <Card>
              <CardContent className="grid gap-5">
                <FormField
                  control={form.control}
                  name="categoryId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('category')}</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={NONE}>{t('noCategory')}</SelectItem>
                          {(categories.data?.items ?? []).map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {localize(c.name, locale) || c.key}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="tags"
                  render={({ field, fieldState }) => (
                    <FormItem>
                      <FormLabel>{t('tags')}</FormLabel>
                      <FormControl>
                        <TagsInput
                          value={field.value}
                          onChange={field.onChange}
                          invalid={Boolean(fieldState.error)}
                        />
                      </FormControl>
                      <FormDescription>{t('tagsHint')}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="audience"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel id="kb-audience-label">{t('audience')}</FormLabel>
                      <div role="radiogroup" aria-labelledby="kb-audience-label" className="grid gap-2">
                        {AUDIENCES.map(({ value, icon: Icon }) => (
                          <button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={audience === value}
                            onClick={() => field.onChange(value)}
                            className="flex items-start gap-2.5 rounded-lg border p-2.5 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-checked:border-primary aria-checked:bg-primary/5"
                          >
                            <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                            <span className="grid gap-0.5">
                              <span className="text-sm font-medium">{tk(`audience.${value}`)}</span>
                              <span className="text-xs text-muted-foreground">
                                {tk(`audienceHint.${value}`)}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="locale"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('language')}</FormLabel>
                      <Select value={field.value} onValueChange={(v) => field.onChange(v as ArticleLocale)}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {ARTICLE_LOCALES.map((l) => (
                            <SelectItem key={l} value={l} lang={LOCALE_LANG[l]}>
                              {LOCALE_LABEL[l]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="translationOf"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('translationOf')}</FormLabel>
                      <FormControl>
                        <ArticlePicker
                          value={field.value}
                          selected={translationLabel}
                          excludeId={existing.data?.id}
                          onChange={(a) => {
                            field.onChange(a?.id ?? null);
                            setTranslationLabel(a ? { reference: a.reference, title: a.title } : null);
                          }}
                        />
                      </FormControl>
                      <FormDescription>
                        {translationOf ? t('translationOfSet') : t('translationOfHint')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="reviewAt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('reviewAt')}</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormDescription>{t('reviewAtHint')}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <div className="grid gap-2 lg:sticky lg:top-6">
              {status === 'draft' && (
                <Button type="button" onClick={run(true)} loading={save.isPending && save.variables?.submit}>
                  <SendIcon aria-hidden /> {t('saveAndSubmit')}
                </Button>
              )}
              <Button
                type="submit"
                variant={status === 'draft' ? 'outline' : 'default'}
                loading={save.isPending && !save.variables?.submit}
              >
                {status === 'published' ? <UploadIcon aria-hidden /> : <SaveIcon aria-hidden />}
                {status === 'published'
                  ? t('publishUpdate')
                  : status === 'draft'
                    ? t('saveDraft')
                    : tc('saveChanges')}
              </Button>
              <Button type="button" variant="ghost" asChild>
                <Link href={backHref}>{tc('cancel')}</Link>
              </Button>
              {status === 'draft' && <p className="text-xs text-muted-foreground">{t('submitHint')}</p>}
            </div>
          </div>
        </form>
      </Form>
    </div>
  );
}
