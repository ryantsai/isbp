'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack } from '@astryxdesign/core/Layout';
import { TextArea } from '@astryxdesign/core/TextArea';
import { useCan, usePlatform } from '@isbp/sdk/web';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { Markdown } from '@isbp/ui/markdown';
import { useApiMutation } from '@isbp/ui/query';
import { BookOpenIcon, BugIcon, FilePenLineIcon, PencilIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import type { z } from 'zod';
import type { TicketDetail, updateProblemSchema } from '../../contracts';
import { PriorityBadge, TicketStatusBadge, TypeIcon } from '../components/badges';
import { ArticlePicker } from '../components/pickers';
import { INVALIDATE, ticketApi, ticketHref } from '../lib';

type ProblemPatch = z.input<typeof updateProblemSchema>;

function ArticleLink({ article, label }: { article: { reference: string }; label: string }) {
  return (
    <Link
      href={`/knowledge/${article.reference}`}
      className="inline-flex min-w-0 items-center gap-2 text-sm font-medium text-primary hover:underline"
    >
      <BookOpenIcon className="size-4 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
    </Link>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid min-w-0 grid-cols-1 gap-1.5">
      <h3 className="text-xs font-semibold text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

/** Root cause, workaround and known-error state (problem managers edit), plus the incidents it causes. */
export function ProblemCard({ ticket }: { ticket: TicketDetail }) {
  const t = useTranslations('itsm.problem');
  const tc = useTranslations('common');
  const canManage = useCan('itsm.problems.manage') && ticket.viewer.canEdit;
  const canWriteKb = useCan('knowledge.articles.write');
  const router = useRouter();
  const locale = useLocale();
  const { enabledModules } = usePlatform();
  // The article is checked on the server as the caller (knowledge.get_article), like the picker's search.
  const chooseArticle = canManage && enabledModules.includes('knowledge');
  const problem = ticket.problem;
  const [editing, setEditing] = useState(false);
  const [rootCause, setRootCause] = useState('');
  const [workaround, setWorkaround] = useState('');
  const save = useApiMutation(
    (api, body: ProblemPatch) => api.patch<TicketDetail>(`${ticketApi(ticket.reference)}/problem`, body),
    { invalidate: INVALIDATE, success: tc('saved') },
  );
  // "Write the known-error article": a draft for agents, prefilled in the author's language, linked to the problem.
  const canWrite = chooseArticle && canWriteKb;
  const write = useApiMutation(
    (api, body: { title: string; summary?: string; body: string; locale: 'en' | 'zh-TW' | 'ja-JP' }) =>
      api.post<{ article: { reference: string; href: string } }>(
        `${ticketApi(ticket.reference)}/problem/article`,
        body,
      ),
    {
      invalidate: INVALIDATE,
      success: (r) => t('articleDrafted', { reference: r.article.reference }),
      onSuccess: (r) => router.push(`/knowledge/${encodeURIComponent(r.article.reference)}/edit`),
    },
  );
  const writeArticle = () => {
    if (!problem) return;
    const sections = [
      [t('article.symptoms'), ticket.description],
      [t('rootCause'), problem.rootCause],
      [t('workaround'), problem.workaround],
    ].filter(([, text]) => text?.trim());
    write.mutate({
      title: t('article.title', { title: ticket.title }),
      summary: problem.workaround.trim().split('\n')[0]?.slice(0, 400) || undefined,
      body: sections.length
        ? sections.map(([h, text]) => `## ${h}\n\n${text!.trim()}`).join('\n\n')
        : t('article.empty'),
      locale: (['en', 'zh-TW', 'ja-JP'] as const).find((l) => l === locale) ?? 'en',
    });
  };
  const incidents = ticket.links.filter(
    (l) => (l.type === 'caused_by' && l.direction === 'incoming') || l.ticket.type === 'incident',
  );
  if (!problem) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <HStack gap={2} vAlign="center">
            <Icon icon={BugIcon} color="accent" />
            {t('title')}
            {problem.knownError && <Badge variant="warning" label={t('knownError')} />}
          </HStack>
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
        {canManage && !editing && (
          <CardAction>
            <Button
              label={tc('edit')}
              variant="ghost"
              size="sm"
              icon={<Icon icon={PencilIcon} />}
              onClick={() => {
                setRootCause(problem.rootCause);
                setWorkaround(problem.workaround);
                setEditing(true);
              }}
            />
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="grid min-w-0 grid-cols-1 gap-5">
        {editing ? (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(
                { rootCause: rootCause.trim(), workaround: workaround.trim() },
                { onSuccess: () => setEditing(false) },
              );
            }}
          >
            <FormLayout defaultOptionality="optional">
              <TextArea label={t('rootCause')} rows={5} value={rootCause} onChange={setRootCause} />
              <TextArea label={t('workaround')} rows={4} value={workaround} onChange={setWorkaround} />
            </FormLayout>
            <HStack gap={2} hAlign="end">
              <Button label={tc('cancel')} variant="secondary" onClick={() => setEditing(false)} />
              <Button label={tc('saveChanges')} variant="primary" isLoading={save.isPending} type="submit" />
            </HStack>
          </form>
        ) : (
          <>
            <Section title={t('rootCause')}>
              {problem.rootCause ? (
                <Markdown>{problem.rootCause}</Markdown>
              ) : (
                <p className="text-sm text-muted-foreground">{t('rootCauseEmpty')}</p>
              )}
            </Section>
            <Section title={t('workaround')}>
              {problem.workaround ? (
                <Markdown>{problem.workaround}</Markdown>
              ) : (
                <p className="text-sm text-muted-foreground">{t('workaroundEmpty')}</p>
              )}
            </Section>
          </>
        )}
        {problem.knownError && !problem.kbArticle && canWrite && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm">
            <p className="min-w-0 flex-1">{t('writeArticleHint')}</p>
            <Button
              label={t('writeArticle')}
              variant="primary"
              size="sm"
              icon={<Icon icon={FilePenLineIcon} />}
              isLoading={write.isPending}
              onClick={writeArticle}
            />
          </div>
        )}
        {chooseArticle ? (
          <div className="grid min-w-0 gap-2">
            <ArticlePicker
              label={t('kbArticle')}
              description={t('kbArticleHint')}
              value={problem.kbArticle}
              isDisabled={save.isPending}
              onChange={(a) => {
                if ((a?.id ?? null) !== (problem.kbArticle?.id ?? null))
                  save.mutate({ kbArticleId: a?.id ?? null });
              }}
            />
            {problem.kbArticle && <ArticleLink article={problem.kbArticle} label={t('openArticle')} />}
          </div>
        ) : (
          problem.kbArticle && (
            <ArticleLink
              article={problem.kbArticle}
              label={`${problem.kbArticle.reference} · ${problem.kbArticle.title}`}
            />
          )
        )}
        <Section title={t('incidents', { count: incidents.length })}>
          {incidents.length ? (
            <ul
              className="min-w-0 divide-y rounded-lg border"
              aria-label={t('incidents', { count: incidents.length })}
            >
              {incidents.map((l) => (
                <li key={l.id} className="flex min-w-0 items-center gap-2 px-3 py-2 text-sm">
                  <TypeIcon type={l.ticket.type} label className="text-muted-foreground" />
                  <Link
                    href={ticketHref(l.ticket.reference)}
                    className="shrink-0 font-mono text-xs font-medium hover:underline"
                  >
                    {l.ticket.reference}
                  </Link>
                  <span className="min-w-0 flex-1 truncate">{l.ticket.title}</span>
                  <PriorityBadge priority={l.ticket.priority} className="hidden sm:inline-flex" />
                  <TicketStatusBadge status={l.ticket.status} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t('noIncidents')}</p>
          )}
        </Section>
      </CardContent>
    </Card>
  );
}
