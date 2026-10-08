'use client';

import type { RecordPanelSlotProps } from '@isbp/contracts';
import { Slot, usePlatform, type WebPageProps } from '@isbp/sdk/web';
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
import { EmptyState } from '@isbp/ui/empty-state';
import { Markdown } from '@isbp/ui/markdown';
import { FadeIn } from '@isbp/ui/motion';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { DateTime, RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowLeftIcon,
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
  SparklesIcon,
  Trash2Icon,
  UndoIcon,
  UploadIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
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
  ArticleHit,
  ArticleStats,
  CategoryIcon,
  InternalBadge,
  LOCALE_LABEL,
  LOCALE_LANG,
  StatusBadge,
  useCategoryName,
} from '../parts';
import { VersionHistory } from '../version-history';

const ACTION_ICON: Record<ArticleAction, typeof SendIcon> = {
  submit: SendIcon,
  withdraw: UndoIcon,
  publish: UploadIcon,
  retire: ArchiveIcon,
  restore: ArchiveRestoreIcon,
};

function Related({ article }: { article: Article }) {
  const t = useTranslations('knowledge.article');
  const { data, isLoading } = useApiQuery<{ items: ArticleCard[] }>(
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
            className="rounded-full border px-2.5 py-0.5 text-xs font-medium text-muted-foreground outline-none transition-colors hover:border-ring/50 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {LOCALE_LABEL[x.locale]}
            {x.status !== 'published' && <span className="sr-only"> ({ts(x.status)})</span>}
          </Link>
        ),
      )}
    </nav>
  );
}

/** Banner for anything that isn't simply published. */
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

export default function ArticlePage({ params }: WebPageProps) {
  const t = useTranslations('knowledge');
  const tc = useTranslations('common');
  const router = useRouter();
  const categoryName = useCategoryName();
  const { permissions } = usePlatform();
  const [history, setHistory] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const path = `/knowledge/articles/${encodeURIComponent(params.ref ?? '')}`;
  const { data: article, isLoading, error } = useApiQuery<Article>(path);

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
      <div className="mx-auto grid max-w-6xl gap-4">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }
  if (error || !article)
    return (
      <EmptyState
        icon={<FileQuestionIcon />}
        title={t('article.notFound')}
        action={
          <Button variant="outline" asChild>
            <Link href="/knowledge">{t('article.backHome')}</Link>
          </Button>
        }
      />
    );

  const source = article.source;
  const sourceLink = source ? sourceHref(source) : null;
  const editorTools = article.canEdit || article.actions.length > 0 || article.canDelete;
  // Like the agent view of a ticket: people who work with articles get the record panels ("Linked records",
  // and "Synced with" for articles synced with an outside system, e.g. ServiceDesk Plus solutions).
  const recordPanels = editorTools || permissions.hasAny('knowledge.articles.read-internal');
  const canTranslate =
    permissions.hasAny('knowledge.articles.write') &&
    article.translations.length + 1 < ARTICLE_LOCALES.length;

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2 w-fit text-muted-foreground">
        <Link
          href={
            article.category
              ? `/knowledge?category=${encodeURIComponent(article.category.key)}`
              : '/knowledge'
          }
        >
          <ArrowLeftIcon /> {article.category ? categoryName(article.category) : t('meta.name')}
        </Link>
      </Button>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
        <article className="grid min-w-0 content-start gap-6" lang={LOCALE_LANG[article.locale]}>
          <FadeIn y={4} className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {article.status !== 'published' && <StatusBadge status={article.status} />}
              {article.audience === 'agents' && <InternalBadge />}
              <span className="font-mono text-xs text-muted-foreground">{article.reference}</span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
              {article.title}
            </h1>
            {article.summary && <p className="text-base text-muted-foreground">{article.summary}</p>}
            <dl className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
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
              <div className="flex items-center gap-1.5">
                <dt className="sr-only">{t('article.language')}</dt>
                <dd lang={LOCALE_LANG[article.locale]}>{LOCALE_LABEL[article.locale]}</dd>
              </div>
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
            <Translations article={article} />
          </FadeIn>

          {source?.type === 'guide' ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <LifeBuoyIcon className="size-4 shrink-0 text-primary" aria-hidden />
              <span>{t('article.fromGuide')}</span>
            </p>
          ) : source?.type === 'integration' ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <ArrowLeftRightIcon className="size-4 text-primary" aria-hidden />
              <span>{t('article.syncedFrom', { reference: source.reference ?? source.id })}</span>
            </p>
          ) : source ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <SparklesIcon className="size-4 text-primary" aria-hidden />
              {sourceLink ? (
                <Link
                  href={sourceLink}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  {t('article.generatedFrom', { reference: source.reference ?? source.id })}
                </Link>
              ) : (
                <span>{t('article.generatedFrom', { reference: source.reference ?? source.id })}</span>
              )}
            </p>
          ) : null}

          <StateBanner article={article} />

          {editorTools && (
            <div className="flex flex-wrap gap-2" role="toolbar" aria-label={t('article.tools')}>
              {article.actions.map((action) => {
                const Icon = ACTION_ICON[action];
                return (
                  <Button
                    key={action}
                    variant={action === 'submit' || action === 'publish' ? 'default' : 'outline'}
                    onClick={() => act.mutate(action)}
                    loading={act.isPending && act.variables === action}
                    disabled={act.isPending}
                  >
                    <Icon aria-hidden /> {t(`actions.${action}`)}
                  </Button>
                );
              })}
              {article.canEdit && (
                <Button variant="outline" asChild>
                  <Link href={`/knowledge/${article.reference}/edit`}>
                    <PencilIcon aria-hidden /> {tc('edit')}
                  </Link>
                </Button>
              )}
              {canTranslate && (
                <Button variant="outline" asChild>
                  <Link href={`/knowledge/new?translationOf=${article.id}`}>
                    <GitBranchIcon aria-hidden /> {t('article.translate')}
                  </Link>
                </Button>
              )}
              {article.publishedVersion > 0 && (
                <Button variant="ghost" onClick={() => setHistory(true)}>
                  <HistoryIcon aria-hidden /> {t('article.history', { count: article.publishedVersion })}
                </Button>
              )}
              {article.canDelete && (
                <Button
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2Icon aria-hidden /> {tc('delete')}
                </Button>
              )}
            </div>
          )}

          <Card>
            <CardContent>
              {article.body.trim() ? (
                <Markdown className="text-[15px]" anchors>
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
              {t('article.deleteDescription', { reference: article.reference })}
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
