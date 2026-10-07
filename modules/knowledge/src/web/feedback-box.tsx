'use client';

import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { useApiMutation } from '@isbp/ui/query';
import { Textarea } from '@isbp/ui/textarea';
import { CheckIcon, ThumbsDownIcon, ThumbsUpIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import type { Article, FeedbackResult } from '../contracts';

/** "Was this helpful?" — one vote per reader (changeable), optional comment on "no", announced politely. */
export function FeedbackBox({ article }: { article: Article }) {
  const t = useTranslations('knowledge.feedback');
  const commentId = useId();
  const [vote, setVote] = useState<boolean | null>(article.myFeedback?.helpful ?? null);
  const [askComment, setAskComment] = useState(false);
  const [comment, setComment] = useState(article.myFeedback?.comment ?? '');
  const [announcement, setAnnouncement] = useState('');
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
    }
  };

  return (
    <section aria-labelledby={`${commentId}-q`} className="grid gap-3 rounded-xl border bg-card p-4 sm:p-5">
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
      <AnimatePresence initial={false}>
        {askComment && vote === false && (
          <motion.form
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="grid gap-2 overflow-hidden"
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
          </motion.form>
        )}
      </AnimatePresence>
      <p role="status" aria-live="polite" className="min-h-0 text-sm text-muted-foreground empty:hidden">
        {announcement && (
          <span className="inline-flex items-center gap-1.5">
            <CheckIcon className="size-4 text-success" aria-hidden />
            {announcement}
          </span>
        )}
      </p>
    </section>
  );
}
