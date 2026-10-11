'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { Heading, Text } from '@astryxdesign/core/Text';
import { UserAvatar } from '@isbp/ui/avatar';
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
              <Button
                label={t('back')}
                variant="ghost"
                size="sm"
                icon={<Icon icon={ArrowLeftIcon} />}
                className="-ml-2 w-fit"
                onClick={() => setSelected(null)}
              />
              {version.isLoading || !version.data ? (
                <Skeleton className="h-64 rounded-xl" />
              ) : (
                <article className="grid gap-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <Badge variant="neutral" label={t('version', { version: version.data.version })} />
                    {version.data.current && <Badge variant="success" label={t('current')} />}
                    <DateTime date={version.data.publishedAt} />
                    {version.data.publishedBy && (
                      <span>{t('by', { name: version.data.publishedBy.displayName })}</span>
                    )}
                  </div>
                  <Heading level={3}>{version.data.title}</Heading>
                  {version.data.summary && <Text color="secondary">{version.data.summary}</Text>}
                  <div className="rounded-xl border p-4">
                    <Markdown>{version.data.body}</Markdown>
                  </div>
                </article>
              )}
            </>
          ) : list.isLoading ? (
            [0, 1, 2].map((i) => <Skeleton key={i} className="h-14 rounded-lg" />)
          ) : list.data?.items.length ? (
            <List hasDividers aria-label={t('title')}>
              {list.data.items.map((v) => (
                <ListItem
                  key={v.version}
                  label={v.title}
                  description={<DateTime date={v.publishedAt} />}
                  startContent={<Badge variant="neutral" label={`v${v.version}`} />}
                  endContent={
                    <HStack gap={2} vAlign="center">
                      {v.current && <Badge variant="success" label={t('current')} />}
                      {v.publishedBy && (
                        <UserAvatar
                          name={v.publishedBy.displayName}
                          src={v.publishedBy.avatarUrl}
                          className="size-6 text-[10px]"
                        />
                      )}
                    </HStack>
                  }
                  onClick={() => setSelected(v.version)}
                />
              ))}
            </List>
          ) : (
            <div className="py-6 text-center">
              <Text color="secondary">{t('empty')}</Text>
            </div>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
