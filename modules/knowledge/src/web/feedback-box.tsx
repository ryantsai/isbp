'use client';

import { Button } from '@astryxdesign/core/Button';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { TextArea } from '@astryxdesign/core/TextArea';
import { ToggleButton } from '@astryxdesign/core/ToggleButton';
import { useCan, usePlatform } from '@isbp/sdk/web';
import { Collapse } from '@isbp/ui/motion';
import { useApiMutation } from '@isbp/ui/query';
import {
  CheckIcon,
  LifeBuoyIcon,
  MessageCircleQuestionIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from 'lucide-react';
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

/** "Still stuck? Ask IS · Report an issue": plain navigation to the other modules' pages. */
function StillStuck({ id, askIt, report }: { id: string; askIt: boolean; report: boolean }) {
  const t = useTranslations('knowledge.feedback');
  return (
    <nav aria-labelledby={id}>
      <HStack gap={2} wrap="wrap" vAlign="center">
        <Text id={id} color="secondary">
          {t('stillStuck')}
        </Text>
        {askIt && (
          <Button
            label={t('askIt')}
            variant="ghost"
            size="sm"
            icon={<Icon icon={MessageCircleQuestionIcon} />}
            href="/helpdesk-ai/chat"
          />
        )}
        {askIt && report && (
          <Text color="secondary" aria-hidden>
            ·
          </Text>
        )}
        {report && (
          <Button
            label={t('reportIssue')}
            variant="ghost"
            size="sm"
            icon={<Icon icon={LifeBuoyIcon} />}
            href="/itsm/report"
          />
        )}
      </HStack>
    </nav>
  );
}

/**
 * "Was this helpful?" — one vote per reader (changeable), optional comment on "no", announced politely. After "no"
 * the reader also gets the ways on (Ask IS, Report an issue).
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
        <Heading id={`${commentId}-q`} level={2}>
          {t('question')}
        </Heading>
        <HStack gap={2} role="group" aria-labelledby={`${commentId}-q`}>
          <ToggleButton
            label={t('yes')}
            size="sm"
            icon={<Icon icon={ThumbsUpIcon} />}
            isDisabled={send.isPending}
            isPressed={vote === true}
            onPressedChange={() => choose(true)}
          />
          <ToggleButton
            label={t('no')}
            size="sm"
            icon={<Icon icon={ThumbsDownIcon} />}
            isDisabled={send.isPending}
            isPressed={vote === false}
            onPressedChange={() => choose(false)}
          />
        </HStack>
      </div>
      <Collapse open={askComment && vote === false} id={`${commentId}-form`}>
        <form
          className="pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            send.mutate(
              { helpful: false, comment: comment.trim() || null },
              { onSuccess: () => setAskComment(false) },
            );
          }}
        >
          <VStack gap={2}>
            <TextArea
              label={t('commentLabel')}
              rows={3}
              maxLength={1000}
              value={comment}
              onChange={(v) => setComment(v.slice(0, 1000))}
              placeholder={t('commentPlaceholder')}
            />
            <HStack gap={2} hAlign="end">
              <Button
                label={t('skip')}
                variant="ghost"
                size="sm"
                isDisabled={send.isPending}
                type="button"
                onClick={() => send.mutate({ helpful: false }, { onSuccess: () => setAskComment(false) })}
              />
              <Button
                label={t('send')}
                variant="primary"
                size="sm"
                isLoading={send.isPending}
                isDisabled={!comment.trim()}
                type="submit"
              />
            </HStack>
          </VStack>
        </form>
      </Collapse>
      <div role="status" aria-live="polite" className="mt-3 empty:hidden">
        {announcement && (
          <HStack gap={1.5} vAlign="center">
            <Icon icon={CheckIcon} color="success" />
            <Text color="secondary">{announcement}</Text>
          </HStack>
        )}
      </div>
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
