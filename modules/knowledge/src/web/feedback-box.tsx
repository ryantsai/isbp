'use client';

import { useCan, usePlatform } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { Collapse } from '@isbp/ui/motion';
import { useApiMutation } from '@isbp/ui/query';
import { Textarea } from '@isbp/ui/textarea';
import {
  CheckIcon,
  LifeBuoyIcon,
  MessageCircleQuestionIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import type { Article, FeedbackResult } from '../contracts';

/** The ways on after a "No" that the reader can use: Helpdesk AI's chat and the service desk's report form. */
function useWaysOn() {
  const { enabledModules } = usePlatform();
  const askIt = useCan('helpdesk-ai.chat.use') && enabledModules.includes('helpdesk-ai');
  const report = useCan('itsm.tickets.create') && enabledModules.includes('itsm');
  return { askIt, report, any: askIt || report };
}

/** "Still stuck? Ask IT · Report an issue": plain navigation to the other modules' pages. */
function StillStuck({ id, askIt, report }: { id: string; askIt: boolean; report: boolean }) {
  const t = useTranslations('knowledge.feedback');
  const link =
    'inline-flex items-center gap-1.5 rounded-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50';
  return (
    <nav aria-labelledby={id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span id={id} className="text-muted-foreground">
        {t('stillStuck')}
      </span>
      {askIt && (
        <Link href="/helpdesk-ai/chat" className={link}>
          <MessageCircleQuestionIcon className="size-4" aria-hidden />
          {t('askIt')}
        </Link>
      )}
      {askIt && report && (
        <span aria-hidden className="text-muted-foreground">
          ·
        </span>
      )}
      {report && (
        <Link href="/itsm/report" className={link}>
          <LifeBuoyIcon className="size-4" aria-hidden />
          {t('reportIssue')}
        </Link>
      )}
    </nav>
  );
}

/**
 * "Was this helpful?" — one vote per reader (changeable), optional comment on "no", announced politely. After "no"
 * the reader also gets the ways on (Ask IT, Report an issue).
 */
export function FeedbackBox({ article }: { article: Article }) {
  const t = useTranslations('knowledge.feedback');
  const commentId = useId();
  const [vote, setVote] = useState<boolean | null>(article.myFeedback?.helpful ?? null);
  const [askComment, setAskComment] = useState(false);
  const [comment, setComment] = useState(article.myFeedback?.comment ?? '');
  const [announcement, setAnnouncement] = useState('');
  const waysOn = useWaysOn();
  const send = useApiMutation(
    (api, body: { helpful: boolean; comment?: string | null }) =>
      api.post<FeedbackResult>(`/knowledge/articles/${article.id}/feedback`, body),
    {
      invalidate: [`/knowledge/articles/${article.id}`, `/knowledge/articles/${article.reference}`],
      onSuccess: (r) => {
        setVote(r.helpful);
        setAnnouncement(r.helpful ? t('thanksYes') : r.comment ? t('thanksComment') : t('thanksNo'));
      },
    },
  );

  const choose = (helpful: boolean) => {
    if (helpful) {
      setAskComment(false);
      send.mutate({ helpful: true });
    } else {
      // Ask for a comment first; the vote is sent with it (or without, on "Skip").
      setAskComment(true);
      setVote(false);
      setAnnouncement('');
    }
  };

  return (
    // No grid gap here: collapsed sections (height 0) would still add gaps; each block brings its own top space.
    <section aria-labelledby={`${commentId}-q`} className="grid rounded-xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={`${commentId}-q`} className="font-medium">
          {t('question')}
        </h2>
        <div className="flex gap-2" role="group" aria-labelledby={`${commentId}-q`}>
          <Button
            variant="outline"
            size="sm"
            aria-pressed={vote === true}
            onClick={() => choose(true)}
            disabled={send.isPending}
            className={cn(
              vote === true && 'border-success/50 bg-success/10 text-success hover:bg-success/15',
            )}
          >
            <ThumbsUpIcon aria-hidden /> {t('yes')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-pressed={vote === false}
            onClick={() => choose(false)}
            disabled={send.isPending}
            className={cn(
              vote === false &&
                'border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15',
            )}
          >
            <ThumbsDownIcon aria-hidden /> {t('no')}
          </Button>
        </div>
      </div>
      <Collapse open={askComment && vote === false} id={`${commentId}-form`}>
        <form
          className="grid gap-2 pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            send.mutate(
              { helpful: false, comment: comment.trim() || null },
              { onSuccess: () => setAskComment(false) },
            );
          }}
        >
          <label htmlFor={commentId} className="text-sm text-muted-foreground">
            {t('commentLabel')}
          </label>
          <Textarea
            id={commentId}
            rows={3}
            maxLength={1000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t('commentPlaceholder')}
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={send.isPending}
              onClick={() => send.mutate({ helpful: false }, { onSuccess: () => setAskComment(false) })}
            >
              {t('skip')}
            </Button>
            <Button type="submit" size="sm" loading={send.isPending} disabled={!comment.trim()}>
              {t('send')}
            </Button>
          </div>
        </form>
      </Collapse>
      <p role="status" aria-live="polite" className="mt-3 text-sm text-muted-foreground empty:hidden">
        {announcement && (
          <span className="inline-flex items-center gap-1.5">
            <CheckIcon className="size-4 text-success" aria-hidden />
            {announcement}
          </span>
        )}
      </p>
      {waysOn.any && (
        <Collapse open={vote === false}>
          <div className="pt-3">
            <StillStuck id={`${commentId}-stuck`} askIt={waysOn.askIt} report={waysOn.report} />
          </div>
        </Collapse>
      )}
    </section>
  );
}
