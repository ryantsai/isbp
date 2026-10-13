'use client';

import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import type { ISODateString } from '@astryxdesign/core/Calendar';
import { DateInput } from '@astryxdesign/core/DateInput';
import { Divider } from '@astryxdesign/core/Divider';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { MoreMenu } from '@astryxdesign/core/MoreMenu';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { UserAvatar } from '@isbp/ui/avatar';
import { FormDialog } from '@isbp/ui/form-dialog';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import { StatusBadge, type StatusTone } from '@isbp/ui/status';
import { toast } from '@isbp/ui/toast';
import {
  CircleAlertIcon,
  CircleCheckIcon,
  FolderKanbanIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { ActionItem, CreateActionItemInput, MeetingDetail, PublishResult } from '../contracts';
import { dateValue, INVALIDATE, ItemStatusBadge, meetingApi, meetingHref } from './lib';

const NONE = '__none__';
type Routed = PublishResult['routed'][number];

/** "Created NET-42" / "Stays here: you can't add tasks to that project" toasts after routing. */
export function useRoutedToast() {
  const t = useTranslations('meetings.items');
  return (routed: readonly (Routed | null)[]) => {
    const ok = routed.filter((r) => r?.ok);
    const failed = routed.filter((r) => r && !r.ok && r.error);
    if (ok.length)
      toast.success(t('routed', { count: ok.length, references: ok.map((r) => r!.reference).join(', ') }));
    if (failed.length)
      toast.warning(t('notRouted', { count: failed.length }), {
        description: failed.map((r) => `${r!.title}: ${t(`routeErrors.${r!.error!}`)}`).join('\n'),
      });
  };
}

const TONE: Record<string, StatusTone> = {
  neutral: 'muted',
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'destructive',
};

function Destination({ item }: { item: ActionItem }) {
  const t = useTranslations('meetings.items');
  const root = useTranslations();
  if (item.task)
    return (
      <HStack as="span" gap={1.5} vAlign="center" wrap="wrap">
        <Icon icon={FolderKanbanIcon} size="xsm" color="secondary" />
        <Link href={item.task.href}>{item.task.reference}</Link>
        {item.task.status && (
          <StatusBadge
            tone={TONE[item.task.status.tone] ?? 'muted'}
            label={
              root.has(item.task.status.key)
                ? root(item.task.status.key)
                : item.task.status.key.split('.').pop()!
            }
            quiet
          />
        )}
      </HStack>
    );
  if (item.destination === 'task' && item.project)
    return <Text type="supporting">{t('willBeTask', { project: item.project.key })}</Text>;
  return null;
}

/** One action item: done toggle, title, owner, due date, where it is worked on, and its menu. */
function ItemRow({
  item,
  showMeeting,
  onEdit,
  today,
}: {
  item: ActionItem;
  showMeeting?: boolean;
  onEdit?: (item: ActionItem) => void;
  today: string;
}) {
  const t = useTranslations('meetings.items');
  const tc = useTranslations('common');
  const format = useFormatter();
  const [removing, setRemoving] = useState(false);
  const setStatus = useApiMutation(
    (api, status: 'open' | 'done') => api.patch(`/meetings/action-items/${item.id}`, { status }),
    {
      invalidate: INVALIDATE,
      onSuccess: (_r, status) => toast.success(status === 'done' ? t('markedDone') : t('reopened')),
    },
  );
  const remove = useApiMutation((api) => api.delete(`/meetings/action-items/${item.id}`), {
    invalidate: INVALIDATE,
    success: t('removed'),
    onSuccess: () => setRemoving(false),
  });
  const overdue = item.status === 'open' && item.dueDate !== null && item.dueDate < today;
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
      <VStack gap={1} className="min-w-0">
        <HStack gap={2} vAlign="center" wrap="wrap">
          <span className="min-w-0 wrap-anywhere">
            <Text weight="medium">{item.title}</Text>
          </span>
          {item.status !== 'open' && <ItemStatusBadge status={item.status} />}
        </HStack>
        <HStack gap={3} vAlign="center" wrap="wrap">
          {item.owner ? (
            <HStack as="span" gap={1.5} vAlign="center">
              <UserAvatar
                name={item.owner.displayName}
                src={item.owner.avatarUrl}
                className="size-5 text-[9px]"
              />
              <Text type="supporting">{item.owner.displayName}</Text>
            </HStack>
          ) : (
            <Text type="supporting">{t('noOwner')}</Text>
          )}
          {item.dueDate &&
            (overdue ? (
              <Badge
                variant="error"
                icon={<Icon icon={CircleAlertIcon} size="xsm" />}
                label={t('overdueOn', {
                  date: format.dateTime(dateValue(item.dueDate), { month: 'short', day: 'numeric' }),
                })}
              />
            ) : (
              <Text type="supporting">
                {t('dueOn', {
                  date: format.dateTime(dateValue(item.dueDate), { month: 'short', day: 'numeric' }),
                })}
              </Text>
            ))}
          <Destination item={item} />
          {showMeeting && (
            <Link
              href={meetingHref(item.meeting.reference)}
            >{`${item.meeting.reference} ${item.meeting.title}`}</Link>
          )}
        </HStack>
        {item.routeError && (
          <HStack as="span" gap={1} vAlign="center">
            <Icon icon={TriangleAlertIcon} size="xsm" color="warning" />
            <Text type="supporting">{t('stayedHere', { reason: t(`routeErrors.${item.routeError}`) })}</Text>
          </HStack>
        )}
        {item.note && <Text type="supporting">{item.note}</Text>}
      </VStack>
      <HStack gap={1} vAlign="center">
        {/* Items start when the minutes are sent; until then they are only edited. */}
        {item.canComplete &&
          item.live &&
          (item.status === 'open' ? (
            <Button
              label={t('markDone')}
              aria-label={t('markDoneNamed', { title: item.title })}
              size="sm"
              variant="secondary"
              icon={<Icon icon={CircleCheckIcon} />}
              isLoading={setStatus.isPending}
              onClick={() => setStatus.mutate('done')}
            />
          ) : (
            <Button
              label={t('reopen')}
              aria-label={t('reopenNamed', { title: item.title })}
              size="sm"
              variant="ghost"
              icon={<Icon icon={RotateCcwIcon} />}
              isLoading={setStatus.isPending}
              onClick={() => setStatus.mutate('open')}
            />
          ))}
        {item.canEdit && onEdit && (
          <MoreMenu
            label={t('moreFor', { title: item.title })}
            items={[
              { label: tc('edit'), onClick: () => onEdit(item) },
              { label: t('remove'), variant: 'destructive', onClick: () => setRemoving(true) },
            ]}
          />
        )}
      </HStack>
      <AlertDialog
        isOpen={removing}
        onOpenChange={setRemoving}
        title={t('removeTitle')}
        description={t('removeBody', { title: item.title })}
        actionLabel={t('remove')}
        cancelLabel={tc('cancel')}
        isActionLoading={remove.isPending}
        onAction={() => remove.mutate(undefined)}
      />
    </div>
  );
}

export function ItemList({
  items,
  showMeeting,
  onEdit,
  today,
}: {
  items: readonly ActionItem[];
  showMeeting?: boolean;
  onEdit?: (item: ActionItem) => void;
  today: string;
}) {
  return (
    <ul className="grid min-w-0 gap-3">
      {items.map((item, i) => (
        // The divider is inside the item: a list holds only list items.
        <li key={item.id} id={`item-${item.id}`} className="grid min-w-0 gap-3">
          {i > 0 && <Divider />}
          <ItemRow item={item} showMeeting={showMeeting} onEdit={onEdit} today={today} />
        </li>
      ))}
    </ul>
  );
}

/** Add an action item, or change one (title, owner, due date, where it goes). */
export function ItemDialog({
  meeting,
  item,
  open,
  onOpenChange,
}: {
  meeting: MeetingDetail;
  /** The item to change; null to add one. */
  item: ActionItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('meetings.items');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const routedToast = useRoutedToast();
  const [title, setTitle] = useState(item?.title ?? '');
  const [ownerId, setOwnerId] = useState<string | null>(item?.owner?.id ?? null);
  const [dueDate, setDueDate] = useState(item?.dueDate ?? '');
  const defaultProject = meeting.projects.length === 1 ? meeting.projects[0]!.id : null;
  const [target, setTarget] = useState<string>(
    item
      ? item.destination === 'task' && item.project
        ? `task:${item.project.id}`
        : 'meeting'
      : defaultProject
        ? `task:${defaultProject}`
        : 'meeting',
  );
  const [error, setError] = useState<string | null>(null);
  const save = useApiMutation(
    (api, body: CreateActionItemInput) =>
      item
        ? api.patch<{ id: string; routed: Routed | null }>(`/meetings/action-items/${item.id}`, body)
        : api.post<{ id: string; routed: Routed | null }>(
            `${meetingApi(meeting.reference)}/action-items`,
            body,
          ),
    {
      invalidate: INVALIDATE,
      silent: true,
      onSuccess: (r) => {
        toast.success(item ? t('saved') : t('added'));
        if (r.routed) routedToast([r.routed]);
        onOpenChange(false);
      },
    },
  );
  const people = [
    { value: NONE, label: t('noOwner') },
    ...meeting.attendees.map((a) => ({ value: a.id, label: a.displayName })),
    ...(item?.owner && !meeting.attendees.some((a) => a.id === item.owner!.id)
      ? [{ value: item.owner.id, label: item.owner.displayName }]
      : []),
  ];
  return (
    <FormDialog
      isOpen={open}
      onOpenChange={onOpenChange}
      title={item ? t('editTitle') : t('addTitle')}
      size="md"
      submitLabel={item ? tc('saveChanges') : t('add')}
      cancelLabel={tc('cancel')}
      isSubmitting={save.isPending}
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return setError(t('titleRequired'));
        setError(null);
        save.mutate(
          {
            title: title.trim(),
            ownerId,
            dueDate: dueDate || null,
            destination: target.startsWith('task:') ? 'task' : 'meeting',
            projectId: target.startsWith('task:') ? target.slice(5) : null,
          },
          { onError: (err) => setError(errorText(err)) },
        );
      }}
    >
      <TextInput
        label={t('title')}
        isRequired
        hasAutoFocus
        value={title}
        onChange={(v) => setTitle(v.slice(0, 300))}
      />
      <Selector
        label={t('owner')}
        value={ownerId ?? NONE}
        onChange={(v) => setOwnerId(v === NONE ? null : v)}
        options={people}
      />
      <DateInput
        label={t('dueDate')}
        hasClear
        value={(dueDate || undefined) as ISODateString | undefined}
        onChange={(v) => setDueDate(v ?? '')}
      />
      <Selector
        label={t('destination')}
        description={meeting.projects.length ? t('destinationHint') : t('linkProjectHint')}
        value={target}
        onChange={setTarget}
        options={[
          { value: 'meeting', label: t('trackedHere') },
          ...meeting.projects.map((p) => ({ value: `task:${p.id}`, label: t('taskIn', { project: p.key }) })),
        ]}
      />
      {error && <Banner status="error" title={error} collapsible={false} />}
    </FormDialog>
  );
}
