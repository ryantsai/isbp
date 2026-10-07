'use client';

import { useCan } from '@isbp/sdk/web';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { Label } from '@isbp/ui/label';
import { Markdown } from '@isbp/ui/markdown';
import { useApiMutation } from '@isbp/ui/query';
import { Switch } from '@isbp/ui/switch';
import { Textarea } from '@isbp/ui/textarea';
import { BookOpenIcon, BugIcon, PencilIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId, useState } from 'react';
import type { z } from 'zod';
import type { TicketDetail, updateProblemSchema } from '../../contracts';
import { PriorityBadge, TicketStatusBadge, TypeIcon } from '../components/badges';
import { INVALIDATE, ticketApi, ticketHref } from '../lib';

type ProblemPatch = z.input<typeof updateProblemSchema>;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-1.5">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  );
}

/** Root cause, workaround and known-error state (problem managers edit), plus the incidents it causes. */
export function ProblemCard({ ticket }: { ticket: TicketDetail }) {
  const t = useTranslations('itsm.problem');
  const tc = useTranslations('common');
  const id = useId();
  const canManage = useCan('itsm.problems.manage') && ticket.viewer.canEdit;
  const problem = ticket.problem;
  const [editing, setEditing] = useState(false);
  const [rootCause, setRootCause] = useState('');
  const [workaround, setWorkaround] = useState('');
  const save = useApiMutation(
    (api, body: ProblemPatch) => api.patch<TicketDetail>(`${ticketApi(ticket.reference)}/problem`, body),
    { invalidate: INVALIDATE, success: tc('saved') },
  );
  const incidents = ticket.links.filter(
    (l) => (l.type === 'caused_by' && l.direction === 'incoming') || l.ticket.type === 'incident',
  );
  if (!problem) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BugIcon className="size-4 text-primary" aria-hidden />
          {t('title')}
          {problem.knownError && <Badge variant="warning">{t('knownError')}</Badge>}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
        {canManage && !editing && (
          <CardAction>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setRootCause(problem.rootCause);
                setWorkaround(problem.workaround);
                setEditing(true);
              }}
            >
              <PencilIcon />
              {tc('edit')}
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="grid gap-5">
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
            <div className="grid gap-2">
              <Label htmlFor={`${id}-cause`}>{t('rootCause')}</Label>
              <Textarea
                id={`${id}-cause`}
                rows={5}
                value={rootCause}
                onChange={(e) => setRootCause(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-workaround`}>{t('workaround')}</Label>
              <Textarea
                id={`${id}-workaround`}
                rows={4}
                value={workaround}
                onChange={(e) => setWorkaround(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditing(false)}>
                {tc('cancel')}
              </Button>
              <Button type="submit" loading={save.isPending}>
                {tc('saveChanges')}
              </Button>
            </div>
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
        <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
          <Label htmlFor={`${id}-known`} className="flex-col items-start gap-0.5">
            <span>{t('knownErrorSwitch')}</span>
            <span className="text-xs font-normal text-muted-foreground">{t('knownErrorHint')}</span>
          </Label>
          <Switch
            id={`${id}-known`}
            checked={problem.knownError}
            disabled={!canManage || save.isPending}
            onCheckedChange={(knownError) => save.mutate({ knownError })}
          />
        </div>
        {problem.kbArticle && (
          <Link
            href={`/knowledge/${problem.kbArticle.reference}`}
            className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
          >
            <BookOpenIcon className="size-4" aria-hidden />
            {problem.kbArticle.reference} · {problem.kbArticle.title}
          </Link>
        )}
        <Section title={t('incidents', { count: incidents.length })}>
          {incidents.length ? (
            <ul className="divide-y rounded-lg border">
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
