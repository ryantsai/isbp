'use client';

import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Divider } from '@astryxdesign/core/Divider';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Heading, Text } from '@astryxdesign/core/Text';
import { UserAvatar } from '@isbp/ui/avatar';
import { IconTile } from '@isbp/ui/icon-tile';
import { Markdown } from '@isbp/ui/markdown';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  ArrowRightLeftIcon,
  CirclePlusIcon,
  GitBranchIcon,
  type LucideIcon,
  PencilIcon,
  Trash2Icon,
  UserRoundIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useFormatter, useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import type { Activity, Comment, TaskDetail } from '../../contracts';
import { dateValue, INVALIDATE, taskApi } from '../lib';
import { MarkdownEditor } from './inputs';
import { Via } from './via';

type Entry =
  { kind: 'comment'; at: string; comment: Comment } | { kind: 'activity'; at: string; activity: Activity };

const ICONS: Record<Activity['kind'], LucideIcon | null> = {
  created: CirclePlusIcon,
  status: ArrowRightLeftIcon,
  assignee: UserRoundIcon,
  field: PencilIcon,
  comment: null,
  dependency: GitBranchIcon,
};

/** One activity line, e.g. "Alice moved it from To do to In progress". */
function useActivityText() {
  const t = useTranslations('projects.activity');
  const tf = useTranslations('projects.fields');
  const ts = useTranslations('projects.taskStatus');
  const tp = useTranslations('projects.priority');
  const tt = useTranslations('projects.taskType');
  const format = useFormatter();
  return (a: Activity) => {
    const actor = a.actor?.displayName ?? a.actorName ?? t('system');
    const value = (v: string | null, label: string | null) => {
      if (label) return label;
      if (v === null || v === '') return t('empty');
      switch (a.field) {
        case 'type':
          return tt.has(v) ? tt(v as never) : v;
        case 'priority':
          return tp.has(v) ? tp(v as never) : v;
        case 'startDate':
        case 'dueDate':
          return /^\d{4}-\d{2}-\d{2}$/.test(v) ? format.dateTime(dateValue(v), { dateStyle: 'medium' }) : v;
        case 'estimateHours':
        case 'remainingHours':
          return t('hours', { hours: Number(v) });
        default:
          return v;
      }
    };
    switch (a.kind) {
      case 'created':
        return t('created', { actor });
      case 'status':
        return t('status', {
          actor,
          from: a.from && ts.has(a.from) ? ts(a.from as never) : (a.from ?? ''),
          to: a.to && ts.has(a.to) ? ts(a.to as never) : (a.to ?? ''),
        });
      case 'assignee':
        return a.to
          ? t('assigned', { actor, to: a.toLabel ?? t('someone') })
          : t('unassigned', { actor, from: a.fromLabel ?? t('someone') });
      case 'dependency':
        return a.field === 'removed'
          ? t('dependencyRemoved', { actor, task: a.fromLabel ?? t('deletedTask') })
          : t('dependencyAdded', { actor, task: a.toLabel ?? t('deletedTask') });
      default: {
        const key = a.field ?? 'other';
        const field = tf.has(`activity.${key}`) ? tf(`activity.${key}` as never) : key;
        return ['description', 'attributes'].includes(key) || (a.from === null && a.to === null)
          ? t('fieldUpdated', { actor, field })
          : t('fieldChanged', { actor, field, from: value(a.from, a.fromLabel), to: value(a.to, a.toLabel) });
      }
    }
  };
}

function ActivityIcon({ kind }: { kind: Activity['kind'] }) {
  const Glyph = ICONS[kind];
  return (
    <IconTile size="xs" variant="outline" className="text-muted-foreground" aria-hidden>
      {Glyph ? <Glyph /> : null}
    </IconTile>
  );
}

function CommentItem({ comment, taskRef }: { comment: Comment; taskRef: string }) {
  const t = useTranslations('projects.comments');
  const tc = useTranslations('common');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [confirm, setConfirm] = useState(false);
  const save = useApiMutation(
    (api, body: string) => api.patch(`/projects/comments/${comment.id}`, { body }),
    {
      invalidate: [taskApi(taskRef)],
      onSuccess: () => setEditing(false),
    },
  );
  const remove = useApiMutation((api) => api.delete(`/projects/comments/${comment.id}`), {
    invalidate: INVALIDATE,
    success: t('deleted'),
    onSuccess: () => setConfirm(false),
  });
  const name = comment.author?.displayName ?? comment.authorName ?? t('formerUser');
  return (
    <article className="flex gap-3" aria-label={t('by', { name })}>
      <UserAvatar name={name} src={comment.author?.avatarUrl} className="mt-0.5 size-7 text-[10px]" />
      <Card padding={0} className="min-w-0 flex-1">
        <HStack gap={2} vAlign="center" wrap="wrap" paddingInline={3} paddingBlock={1.5}>
          <Text weight="medium">{name}</Text>
          <Text type="supporting">
            <RelativeTime date={comment.createdAt} />
          </Text>
          {comment.via && (
            <Text type="supporting">
              <Via via={comment.via} />
            </Text>
          )}
          {comment.editedAt && <Text type="supporting">{t('edited')}</Text>}
          <HStack gap={1} className="ml-auto">
            {comment.canEdit && !editing && (
              <IconButton
                label={t('edit')}
                variant="ghost"
                size="sm"
                icon={<Icon icon={PencilIcon} />}
                onClick={() => {
                  setDraft(comment.body);
                  setEditing(true);
                }}
              />
            )}
            {comment.canDelete && (
              <IconButton
                label={t('delete')}
                variant="ghost"
                size="sm"
                icon={<Icon icon={Trash2Icon} />}
                onClick={() => setConfirm(true)}
              />
            )}
          </HStack>
        </HStack>
        <Divider />
        <VStack paddingInline={3} paddingBlock={2}>
          {editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (draft.trim()) save.mutate(draft.trim());
              }}
            >
              <VStack gap={2}>
                <MarkdownEditor value={draft} onChange={setDraft} label={t('edit')} rows={4} hasAutoFocus />
                <HStack gap={2} hAlign="end">
                  <Button
                    label={tc('cancel')}
                    variant="secondary"
                    size="sm"
                    onClick={() => setEditing(false)}
                  />
                  <Button
                    label={tc('save')}
                    variant="primary"
                    size="sm"
                    isLoading={save.isPending}
                    isDisabled={!draft.trim()}
                    type="submit"
                  />
                </HStack>
              </VStack>
            </form>
          ) : (
            <Markdown>{comment.body}</Markdown>
          )}
        </VStack>
      </Card>
      <AlertDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={t('deleteTitle')}
        description={t('deleteBody')}
        actionLabel={tc('delete')}
        cancelLabel={tc('cancel')}
        isActionLoading={remove.isPending}
        onAction={() => remove.mutate(undefined)}
      />
    </article>
  );
}

/** Comments and the activity timeline, merged in time order, with the comment composer. */
export function Conversation({ task }: { task: TaskDetail }) {
  const t = useTranslations('projects.comments');
  const headingId = useId();
  const comments = useApiQuery<{ items: Comment[] }>(`${taskApi(task.reference)}/comments`);
  const activity = useApiQuery<{ items: Activity[] }>(`${taskApi(task.reference)}/activity`);
  const text = useActivityText();
  const [draft, setDraft] = useState('');
  const [composerKey, setComposerKey] = useState(0);
  const post = useApiMutation(
    (api, body: string) => api.post<Comment>(`${taskApi(task.reference)}/comments`, { body }),
    {
      invalidate: INVALIDATE,
      success: t('posted'),
      onSuccess: () => {
        setDraft('');
        setComposerKey((k) => k + 1);
      },
    },
  );
  const entries = useMemo<Entry[]>(() => {
    const list: Entry[] = [
      ...(comments.data?.items ?? []).map((c) => ({
        kind: 'comment' as const,
        at: String(c.createdAt),
        comment: c,
      })),
      ...(activity.data?.items ?? [])
        .filter((a) => a.kind !== 'comment')
        .map((a) => ({ kind: 'activity' as const, at: String(a.createdAt), activity: a })),
    ];
    return list.sort((a, b) => a.at.localeCompare(b.at));
  }, [comments.data, activity.data]);

  return (
    <section aria-labelledby={headingId} className="grid gap-4">
      <Heading level={3} accessibilityLevel={2} id={headingId}>
        {t('title')}
      </Heading>
      {comments.isLoading || activity.isLoading ? (
        <Skeleton className="h-32 w-full rounded-lg" />
      ) : (
        <ol className="grid gap-3">
          <AnimatePresence initial={false}>
            {entries.map((e) => (
              <motion.li
                key={e.kind === 'comment' ? e.comment.id : e.activity.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                {e.kind === 'comment' ? (
                  <CommentItem comment={e.comment} taskRef={task.reference} />
                ) : (
                  <HStack gap={2} vAlign="center" paddingInlineStart={2}>
                    <ActivityIcon kind={e.activity.kind} />
                    <span className="min-w-0 flex-1 wrap-anywhere">
                      <Text type="supporting">
                        {text(e.activity)}
                        {e.activity.via && (
                          <>
                            {' '}
                            <Via via={e.activity.via} />
                          </>
                        )}
                      </Text>
                    </span>
                    <span className="shrink-0">
                      <Text type="supporting">
                        <RelativeTime date={e.activity.createdAt} />
                      </Text>
                    </span>
                  </HStack>
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      )}
      {task.viewer.canComment ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) post.mutate(draft.trim());
          }}
        >
          <VStack gap={2}>
            <MarkdownEditor
              key={composerKey}
              value={draft}
              onChange={setDraft}
              label={t('add')}
              placeholder={t('placeholder')}
              rows={3}
            />
            <HStack hAlign="end">
              <Button
                label={t('submit')}
                variant="primary"
                isLoading={post.isPending}
                isDisabled={!draft.trim()}
                type="submit"
              />
            </HStack>
          </VStack>
        </form>
      ) : (
        <Text type="supporting">{t('readOnly')}</Text>
      )}
    </section>
  );
}
