'use client';

import { UserAvatar } from '@isbp/ui/avatar';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Markdown } from '@isbp/ui/markdown';
import { useApiQuery } from '@isbp/ui/query';
import { DateTime } from '@isbp/ui/relative-time';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@isbp/ui/sheet';
import { Skeleton } from '@isbp/ui/skeleton';
import { ArrowLeftIcon, HistoryIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { Article, ArticleVersion, ArticleVersionSummary } from '../contracts';

/** Every published version of an article, newest first; pick one to read it as it was. */
export function VersionHistory({
  article,
  open,
  onOpenChange,
}: {
  article: Article;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('knowledge.versions');
  const tc = useTranslations('common');
  const [selected, setSelected] = useState<number | null>(null);
  const base = `/knowledge/articles/${article.id}/versions`;
  const list = useApiQuery<{ items: ArticleVersionSummary[] }>(open ? base : null);
  const version = useApiQuery<ArticleVersion>(open && selected ? `${base}/${selected}` : null);

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setSelected(null);
      }}
    >
      <SheetContent className="sm:max-w-2xl" closeLabel={tc('close')}>
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <HistoryIcon className="size-4" aria-hidden /> {t('title')}
          </SheetTitle>
          <SheetDescription>{t('description', { reference: article.reference })}</SheetDescription>
        </SheetHeader>
        <SheetBody className="grid content-start gap-3 overflow-y-auto">
          {selected ? (
            <>
              <Button variant="ghost" size="sm" className="-ml-2 w-fit" onClick={() => setSelected(null)}>
                <ArrowLeftIcon /> {t('back')}
              </Button>
              {version.isLoading || !version.data ? (
                <Skeleton className="h-64 rounded-xl" />
              ) : (
                <article className="grid gap-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <Badge variant="outline">{t('version', { version: version.data.version })}</Badge>
                    {version.data.current && <Badge variant="success">{t('current')}</Badge>}
                    <DateTime date={version.data.publishedAt} />
                    {version.data.publishedBy && (
                      <span>{t('by', { name: version.data.publishedBy.displayName })}</span>
                    )}
                  </div>
                  <h3 className="text-lg font-semibold">{version.data.title}</h3>
                  {version.data.summary && (
                    <p className="text-sm text-muted-foreground">{version.data.summary}</p>
                  )}
                  <div className="rounded-xl border p-4">
                    <Markdown>{version.data.body}</Markdown>
                  </div>
                </article>
              )}
            </>
          ) : list.isLoading ? (
            [0, 1, 2].map((i) => <Skeleton key={i} className="h-14 rounded-lg" />)
          ) : list.data?.items.length ? (
            <ol className="grid gap-2" aria-label={t('title')}>
              {list.data.items.map((v) => (
                <li key={v.version}>
                  <button
                    type="button"
                    onClick={() => setSelected(v.version)}
                    className="flex w-full min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-xs font-semibold tabular-nums">
                      v{v.version}
                    </span>
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="truncate text-sm font-medium">{v.title}</span>
                      <span className="text-xs text-muted-foreground">
                        <DateTime date={v.publishedAt} />
                      </span>
                    </span>
                    {v.current && <Badge variant="success">{t('current')}</Badge>}
                    {v.publishedBy && (
                      <UserAvatar
                        name={v.publishedBy.displayName}
                        src={v.publishedBy.avatarUrl}
                        className="size-6 text-[10px]"
                      />
                    )}
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
