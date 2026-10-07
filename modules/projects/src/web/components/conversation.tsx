'use client';

import { UserAvatar } from '@isbp/ui/avatar';
import { Button } from '@isbp/ui/button';
import { Markdown } from '@isbp/ui/markdown';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  ArrowRightLeftIcon,
  CirclePlusIcon,
  GitBranchIcon,
  PencilIcon,
  Trash2Icon,
  UserRoundIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useFormatter, useTranslations } from 'next-intl';
import { type ReactNode, useId, useMemo, useState } from 'react';
import type { Activity, Comment, TaskDetail } from '../../contracts';
import { dateValue, INVALIDATE, taskApi } from '../lib';
import { ConfirmDialog, MarkdownEditor } from './inputs';

type Entry =
  { kind: 'comment'; at: string; comment: Comment } | { kind: 'activity'; at: string; activity: Activity };

const ICONS: Record<Activity['kind'], ReactNode> = {
  created: <CirclePlusIcon className="size-3.5" aria-hidden />,
  status: <ArrowRightLeftIcon className="size-3.5" aria-hidden />,
  assignee: <UserRoundIcon className="size-3.5" aria-hidden />,
  field: <PencilIcon className="size-3.5" aria-hidden />,
  comment: null,
  dependency: <GitBranchIcon className="size-3.5" aria-hidden />,
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
    const actor = a.actor?.displayName ?? t('system');
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
  const name = comment.author?.displayName ?? t('formerUser');
  return (
    <article className="flex gap-3" aria-label={t('by', { name })}>
      <UserAvatar name={name} src={comment.author?.avatarUrl} className="mt-0.5 size-7 text-[10px]" />
      <div className="min-w-0 flex-1 rounded-lg border bg-card">
        <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-1.5 text-sm">
          <span className="font-medium">{name}</span>
          <RelativeTime date={comment.createdAt} className="text-xs text-muted-foreground" />
          {comment.editedAt && <span className="text-xs text-muted-foreground">{t('edited')}</span>}
          <span className="ml-auto flex gap-1">
            {comment.canEdit && !editing && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-7"
                aria-label={t('edit')}
                onClick={() => {
                  setDraft(comment.body);
                  setEditing(true);
                }}
              >
                <PencilIcon className="size-3.5" />
              </Button>
            )}
            {comment.canDelete && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-7"
                aria-label={t('delete')}
                onClick={() => setConfirm(true)}
              >
                <Trash2Icon className="size-3.5" />
              </Button>
            )}
          </span>
        </header>
        <div className="px-3 py-2">
          {editing ? (
            <form
              className="grid gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (draft.trim()) save.mutate(draft.trim());
              }}
            >
              <MarkdownEditor value={draft} onChange={setDraft} label={t('edit')} rows={4} autoFocus />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>
                  {tc('cancel')}
                </Button>
                <Button type="submit" size="sm" loading={save.isPending} disabled={!draft.trim()}>
                  {tc('save')}
                </Button>
              </div>
            </form>
          ) : (
            <Markdown>{comment.body}</Markdown>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('deleteTitle')}
        description={t('deleteBody')}
        confirmLabel={tc('delete')}
        destructive
        loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined)}
      />
    </article>
  );
}

/** Comments and the activity timeline, merged in time order, with the comment composer. */
export function Conversation({ task }: { task: TaskDetail }) {
  const t = useTranslations('projects.comments');
  const composerId = useId();
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
    <section aria-labelledby={`${composerId}-heading`} className="grid gap-4">
      <h2 id={`${composerId}-heading`} className="text-base font-semibold">
        {t('title')}
      </h2>
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
                  <div className="flex items-center gap-2 pl-2 text-sm text-muted-foreground">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-foreground">
                      {ICONS[e.activity.kind]}
                    </span>
                    <span className="min-w-0 flex-1 wrap-anywhere">{text(e.activity)}</span>
                    <RelativeTime date={e.activity.createdAt} className="shrink-0 text-xs" />
                  </div>
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      )}
      {task.viewer.canComment ? (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) post.mutate(draft.trim());
          }}
        >
          <MarkdownEditor
            key={composerKey}
            id={composerId}
            value={draft}
            onChange={setDraft}
            label={t('add')}
            placeholder={t('placeholder')}
            rows={3}
          />
          <div className="flex justify-end">
            <Button type="submit" loading={post.isPending} disabled={!draft.trim()}>
              {t('submit')}
            </Button>
          </div>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">{t('readOnly')}</p>
      )}
    </section>
  );
}
