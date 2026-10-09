'use client';

import type { RecordPanelSlotProps } from '@isbp/contracts';
import { ApiError, Slot, usePlatform, type WebPageProps } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@isbp/ui/alert-dialog';
import { UserAvatar } from '@isbp/ui/avatar';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Card, CardContent } from '@isbp/ui/card';
import { EmptyState, ErrorState } from '@isbp/ui/empty-state';
import { Markdown } from '@isbp/ui/markdown';
import { type DetailAction, DetailHeader } from '@isbp/ui/page-header';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { DateTime, RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowLeftRightIcon,
  CalendarClockIcon,
  ClockIcon,
  FileQuestionIcon,
  GitBranchIcon,
  HistoryIcon,
  LanguagesIcon,
  LifeBuoyIcon,
  PencilIcon,
  SendIcon,
  ShieldAlertIcon,
  SparklesIcon,
  Trash2Icon,
  UndoIcon,
  UploadIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import {
  type Article,
  type ArticleAction,
  type ArticleCard,
  ARTICLE_LOCALES,
  sourceHref,
} from '../../contracts';
import { FeedbackBox } from '../feedback-box';
import {
  ARTICLE_PROSE,
  ArticleHit,
  ArticleStats,
  CategoryIcon,
  ClassificationBadge,
  InternalBadge,
  LOCALE_LABEL,
  LOCALE_LANG,
  StatusBadge,
  useCategoryName,
  useClassifications,
} from '../parts';
import { VersionHistory } from '../version-history';

function Related({ article }: { article: Article }) {
  const t = useTranslations('knowledge.article');
  const { data, isLoading, error, refetch } = useApiQuery<{ items: ArticleCard[] }>(
    article.status === 'published' ? `/knowledge/articles/${article.id}/related` : null,
  );
  if (article.status !== 'published') return null;
  return (
    <section aria-labelledby="kb-related" className="grid content-start gap-2">
      <h2 id="kb-related" className="text-sm font-semibold">
        {t('related')}
      </h2>
      {isLoading ? (
        [0, 1, 2].map((i) => <Skeleton key={i} className="h-14 rounded-lg" />)
      ) : error && !data ? (
        <ErrorState error={error} onRetry={() => refetch()} compact />
      ) : data?.items.length ? (
        <ul className="-mx-3 grid gap-0.5">
          {data.items.map((item) => (
            <li key={item.id}>
              <ArticleHit item={item} compact />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t('noRelated')}</p>
      )}
    </section>
  );
}

function Translations({ article }: { article: Article }) {
  const t = useTranslations('knowledge.article');
  const ts = useTranslations('knowledge.status');
  if (!article.translations.length) return null;
  const all = [
    { id: article.id, locale: article.locale, href: article.href, status: article.status, current: true },
    ...article.translations.map((x) => ({ ...x, current: false })),
  ].sort((a, b) => ARTICLE_LOCALES.indexOf(a.locale) - ARTICLE_LOCALES.indexOf(b.locale));
  return (
    <nav aria-label={t('translations')} className="flex flex-wrap items-center gap-1.5">
      <LanguagesIcon className="size-4 text-muted-foreground" aria-hidden />
      {all.map((x) =>
        x.current ? (
          <span
            key={x.id}
            aria-current="page"
            lang={LOCALE_LANG[x.locale]}
            className="rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
          >
            {LOCALE_LABEL[x.locale]}
          </span>
        ) : (
          <Link
            key={x.id}
            href={x.href}
            lang={LOCALE_LANG[x.locale]}
            hrefLang={LOCALE_LANG[x.locale]}
            className="rounded-full border px-2.5 py-0.5 text-xs font-medium text-muted-foreground outline-none transition-colors hover:border-ring/50 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none"
          >
            {LOCALE_LABEL[x.locale]}
            {x.status !== 'published' && <span className="sr-only"> ({ts(x.status)})</span>}
          </Link>
        ),
      )}
    </nav>
  );
}

/** Banner for anything that isn't simply published: what's happening and what's next. */
function StateBanner({ article }: { article: Article }) {
  const t = useTranslations('knowledge.article');
  const key =
    article.status === 'in_review'
      ? article.awaitingApproval
        ? 'bannerApproval'
        : 'bannerReview'
      : article.status === 'draft'
        ? 'bannerDraft'
        : article.status === 'retired'
          ? 'bannerRetired'
          : article.reviewDue && article.canEdit
            ? 'bannerReviewDue'
            : null;
  if (!key) return null;
  const tone =
    article.status === 'in_review' || key === 'bannerReviewDue'
      ? 'border-warning/40 bg-warning/10'
      : 'border-border bg-muted/50';
  return (
    <div className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${tone}`} role="note">
      {article.status === 'in_review' ? (
        <ClockIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      ) : key === 'bannerReviewDue' ? (
        <CalendarClockIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      ) : (
        <FileQuestionIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      )}
      <p>{t(key, { date: article.reviewAt ?? '' })}</p>
    </div>
  );
}

/** "Classified: …" above the article, so readers know how to handle it and its attachments. */
function ClassificationBanner({ value }: { value: string }) {
  const t = useTranslations('knowledge.classification');
  const { label, tone } = useClassifications();
  const strong = tone(value) === 'destructive' || tone(value) === 'warning';
  return (
    <div
      role="note"
      className={cn(
        'flex items-start gap-2 rounded-xl border px-4 py-3 text-sm',
        strong ? 'border-destructive/30 bg-destructive/5' : 'border-border bg-muted/50',
      )}
    >
      <ShieldAlertIcon className={cn('mt-0.5 size-4 shrink-0', strong && 'text-destructive')} aria-hidden />
      <p>{t('banner', { label: label(value) })}</p>
    </div>
  );
}

/** Where the article came from: the user guide, a synced system, or the ticket/problem it was written from. */
function SourceLine({ article }: { article: Article }) {
  const t = useTranslations('knowledge.article');
  const source = article.source;
  if (!source) return null;
  if (source.type === 'guide')
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <LifeBuoyIcon className="size-4 shrink-0 text-primary" aria-hidden />
        <span>{t('fromGuide')}</span>
      </p>
    );
  if (source.type === 'integration')
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <ArrowLeftRightIcon className="size-4 text-primary" aria-hidden />
        <span>{t('syncedFrom', { reference: source.reference ?? source.id })}</span>
      </p>
    );
  const link = sourceHref(source);
  const text = t('generatedFrom', { reference: source.reference ?? source.id });
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <SparklesIcon className="size-4 text-primary" aria-hidden />
      {link ? (
        <Link href={link} className="font-medium text-primary underline-offset-4 hover:underline">
          {text}
        </Link>
      ) : (
        <span>{text}</span>
      )}
    </p>
  );
}

export default function ArticlePage({ params }: WebPageProps) {
  const t = useTranslations('knowledge');
  const tc = useTranslations('common');
  const uiLocale = useLocale();
  const router = useRouter();
  const categoryName = useCategoryName();
  const { permissions } = usePlatform();
  const [history, setHistory] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const path = `/knowledge/articles/${encodeURIComponent(params.ref ?? '')}`;
  const { data: article, isLoading, error, refetch } = useApiQuery<Article>(path);

  const act = useApiMutation(
    (api, action: ArticleAction) => api.post<Article>(`/knowledge/articles/${article!.id}/${action}`),
    {
      invalidate: ['/knowledge/'],
      success: (a) =>
        a.status === 'published'
          ? t('toast.published')
          : a.status === 'in_review'
            ? a.awaitingApproval
              ? t('toast.sentForApproval')
              : t('toast.submitted')
            : a.status === 'retired'
              ? t('toast.retired')
              : t('toast.draft'),
    },
  );
  // A link to a section (`#raise-a-ticket`, e.g. from the in-app help) can only scroll once the body is rendered.
  const loadedId = article?.id;
  useEffect(() => {
    const id = loadedId && decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView();
  }, [loadedId]);
  const remove = useApiMutation((api) => api.delete(`/knowledge/articles/${article!.id}`), {
    invalidate: ['/knowledge/'],
    success: t('toast.deleted'),
    onSuccess: () => router.push(article?.status === 'published' ? '/knowledge' : '/knowledge/manage'),
  });

  if (isLoading) {
    return (
      <div className="grid max-w-6xl gap-4" aria-busy="true">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }
  if (!article)
    return error instanceof ApiError && error.status === 404 ? (
      <EmptyState
        icon={<FileQuestionIcon />}
        title={t('article.notFound')}
        action={
          <Button variant="outline" asChild>
            <Link href="/knowledge">{t('article.backHome')}</Link>
          </Button>
        }
      />
    ) : (
      <ErrorState error={error} kind="page" onRetry={() => refetch()} />
    );

  const editorTools = article.canEdit || article.actions.length > 0 || article.canDelete;
  // Like the agent view of a ticket: people who work with articles get the record panels ("Linked records",
  // and "Synced with" for articles synced with an outside system, e.g. ServiceDesk Plus solutions).
  const recordPanels = editorTools || permissions.hasAny('knowledge.articles.read-internal');
  const canTranslate =
    permissions.hasAny('knowledge.articles.write') &&
    article.translations.length + 1 < ARTICLE_LOCALES.length;
  // The language switcher already names the language; a lone article names it only when it isn't the reader's.
  const showLanguage = !article.translations.length && article.locale !== uiLocale;
  const pending = act.isPending;

  /* ── actions: the next step is the primary button, then Edit, Translate and History; Retire and Delete in "More" ── */
  const runButton = (action: ArticleAction, label: string, Icon: typeof SendIcon) => (
    <Button
      onClick={() => act.mutate(action)}
      loading={pending && act.variables === action}
      disabled={pending}
    >
      <Icon aria-hidden /> {label}
    </Button>
  );
  const editHref = `/knowledge/${article.reference}/edit`;
  let primary: React.ReactNode = null;
  let primaryIsEdit = false;
  if (article.actions.includes('submit'))
    primary =
      article.submitOutcome === 'publish'
        ? runButton('submit', t('actions.publish'), UploadIcon)
        : runButton('submit', t('actions.submit'), SendIcon);
  else if (article.actions.includes('publish'))
    primary = runButton('publish', t('actions.publish'), UploadIcon);
  else if (article.actions.includes('restore'))
    primary = runButton('restore', t('actions.restore'), ArchiveRestoreIcon);
  else if (article.canEdit) {
    primaryIsEdit = true;
    primary = (
      <Button asChild>
        <Link href={editHref}>
          <PencilIcon aria-hidden /> {tc('edit')}
        </Link>
      </Button>
    );
  }
  const secondary: DetailAction[] = [];
  if (article.canEdit && !primaryIsEdit)
    secondary.push({ id: 'edit', label: tc('edit'), icon: <PencilIcon aria-hidden />, href: editHref });
  if (article.actions.includes('withdraw'))
    secondary.push({
      id: 'withdraw',
      label: t('actions.withdraw'),
      icon: <UndoIcon aria-hidden />,
      onSelect: () => act.mutate('withdraw'),
      disabled: pending,
    });
  if (canTranslate)
    secondary.push({
      id: 'translate',
      label: t('article.translate'),
      icon: <GitBranchIcon aria-hidden />,
      href: `/knowledge/new?translationOf=${article.id}`,
    });
  if (editorTools && article.publishedVersion > 0)
    secondary.push({
      id: 'history',
      label: t('article.history', { count: article.publishedVersion }),
      icon: <HistoryIcon aria-hidden />,
      onSelect: () => setHistory(true),
    });
  const menu: DetailAction[] = [];
  if (article.actions.includes('retire'))
    menu.push({
      id: 'retire',
      label: t('actions.retire'),
      icon: <ArchiveIcon aria-hidden />,
      onSelect: () => act.mutate('retire'),
      disabled: pending,
    });
  if (article.canDelete)
    menu.push({
      id: 'delete',
      label: tc('delete'),
      icon: <Trash2Icon aria-hidden />,
      destructive: true,
      onSelect: () => setConfirmDelete(true),
    });

  return (
    <div className="grid max-w-6xl gap-6">
      <DetailHeader
        className="pb-0"
        back={{
          href: article.category
            ? `/knowledge?category=${encodeURIComponent(article.category.key)}`
            : '/knowledge',
          label: article.category ? categoryName(article.category) : t('meta.name'),
        }}
        reference={<span className="font-mono text-xs">{article.reference}</span>}
        title={<span lang={LOCALE_LANG[article.locale]}>{article.title}</span>}
        status={
          // Readers only need to hear about what isn't simply live; editors see every state change.
          editorTools || article.status !== 'published' ? (
            <StatusBadge status={article.status} animate />
          ) : undefined
        }
        badges={
          (article.audience === 'agents' || article.classification) && (
            <>
              {article.audience === 'agents' && <InternalBadge />}
              {article.classification && <ClassificationBadge value={article.classification} />}
            </>
          )
        }
        meta={
          <dl className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {article.category && (
              <div className="flex items-center gap-1.5">
                <dt className="sr-only">{t('article.category')}</dt>
                <dd className="flex items-center gap-1.5">
                  <CategoryIcon name={article.category.icon} className="size-4" />
                  {categoryName(article.category)}
                </dd>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <dt>{t('article.updated')}</dt>
              <dd>
                <RelativeTime date={article.updatedAt} />
              </dd>
            </div>
            {article.owner && (
              <div className="flex items-center gap-1.5">
                <dt className="sr-only">{t('article.owner')}</dt>
                <dd className="flex items-center gap-1.5">
                  <UserAvatar
                    name={article.owner.displayName}
                    src={article.owner.avatarUrl}
                    className="size-5 text-[9px]"
                  />
                  {article.owner.displayName}
                </dd>
              </div>
            )}
            {showLanguage && (
              <div className="flex items-center gap-1.5">
                <dt className="sr-only">{t('article.language')}</dt>
                <dd lang={LOCALE_LANG[article.locale]}>{LOCALE_LABEL[article.locale]}</dd>
              </div>
            )}
            {article.status === 'published' && (
              <div>
                <dt className="sr-only">{t('article.stats')}</dt>
                <dd>
                  <ArticleStats
                    views={article.views}
                    helpful={article.helpfulCount}
                    notHelpful={article.notHelpfulCount}
                    className="text-sm"
                  />
                </dd>
              </div>
            )}
          </dl>
        }
        primaryAction={primary}
        actions={secondary}
        menu={menu}
      />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
        <article className="grid min-w-0 content-start gap-6" lang={LOCALE_LANG[article.locale]}>
          {(article.summary || article.translations.length > 0) && (
            <div className="grid gap-3">
              {article.summary && <p className="text-base text-muted-foreground">{article.summary}</p>}
              <Translations article={article} />
            </div>
          )}
          <SourceLine article={article} />
          {article.classification && <ClassificationBanner value={article.classification} />}
          <StateBanner article={article} />

          <Card>
            <CardContent>
              {article.body.trim() ? (
                <Markdown className={ARTICLE_PROSE} anchors>
                  {article.body}
                </Markdown>
              ) : (
                <p className="text-sm text-muted-foreground">{t('article.emptyBody')}</p>
              )}
            </CardContent>
          </Card>

          {article.status === 'published' && <FeedbackBox key={article.id} article={article} />}
        </article>

        {/* Not sticky with the record panels: a taller aside would hide its end below the fold. */}
        <aside
          className={cn(
            'grid min-w-0 content-start gap-6',
            !recordPanels && 'lg:sticky lg:top-6 lg:self-start',
          )}
        >
          <Related article={article} />
          {/* Attachments (diagrams, controlled documents): editors change them, readers download them. */}
          {(article.canEdit || article.attachments > 0) && (
            <div className="min-w-0">
              <Slot<RecordPanelSlotProps>
                name="core.record.files"
                props={{ record: { type: 'knowledge.article', id: article.id } }}
              />
            </div>
          )}
          {recordPanels && (
            <div className="min-w-0">
              <Slot<RecordPanelSlotProps>
                name="core.record.links"
                props={{ record: { type: 'knowledge.article', id: article.id } }}
              />
            </div>
          )}
          <div className="grid gap-1.5 rounded-xl border p-4 text-sm">
            {article.publishedAt && (
              <p className="text-muted-foreground">
                {t('article.publishedOn')} <DateTime date={article.publishedAt} />
              </p>
            )}
            {article.publishedVersion > 0 && (
              <p className="text-muted-foreground">
                {t('article.version', { version: article.publishedVersion })}
              </p>
            )}
            {article.reviewAt && article.canEdit && (
              <p className="flex items-center gap-1.5 text-muted-foreground">
                {t('article.reviewOn', { date: article.reviewAt })}
                {article.reviewDue && <Badge variant="warning">{t('manage.due')}</Badge>}
              </p>
            )}
            {article.tags.length > 0 && (
              <ul className="mt-1 flex flex-wrap gap-1.5" aria-label={t('article.tags')}>
                {article.tags.map((tag) => (
                  <li key={tag}>
                    <Badge variant="muted">#{tag}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>

      <VersionHistory article={article} open={history} onOpenChange={setHistory} />
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('article.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('article.deleteDescription', { title: article.title, reference: article.reference })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => remove.mutate(undefined)}
            >
              {tc('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
