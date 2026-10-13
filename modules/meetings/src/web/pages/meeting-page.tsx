'use client';

import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import type { RecordPanelSlotProps } from '@isbp/contracts';
import { ApiError, Slot, type WebPageProps } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { EmptyState, ErrorState } from '@isbp/ui/empty-state';
import { FormDialog } from '@isbp/ui/form-dialog';
import { Markdown } from '@isbp/ui/markdown';
import { DetailHeader } from '@isbp/ui/page-header';
import { useApiMutation } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { toast } from '@isbp/ui/toast';
import {
  CalendarPlusIcon,
  NotebookTextIcon,
  PencilIcon,
  PlusIcon,
  SendIcon,
  SparklesIcon,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import type {
  ActionItem,
  MeetingDetail,
  OrganiseResult,
  PublishResult,
  UpdateMeetingInput,
} from '../../contracts';
import { ItemDialog, ItemList, useRoutedToast } from '../items';
import { INVALIDATE, MeetingStatusBadge, meetingApi, meetingHref, useMeeting, VisibilityBadge } from '../lib';
import { MeetingSheet } from '../meeting-sheet';
import { OrganiseSheet } from '../organise-sheet';

const todayLocal = () =>
  new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const lines = (v: string) =>
  v
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-*•・]\s*/, '').trim())
    .filter(Boolean);

function PageSkeleton() {
  return (
    <div className="grid gap-4" aria-busy>
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-80 max-w-full" />
      <Skeleton className="h-96 w-full rounded-xl" />
    </div>
  );
}

/** The notes as typed, saved on demand, and "Organise" (AI or builtin) into a proposal to check. */
function NotesCard({
  meeting,
  onOrganised,
}: {
  meeting: MeetingDetail;
  onOrganised: (r: OrganiseResult) => void;
}) {
  const t = useTranslations('meetings.meeting');
  const [notes, setNotes] = useState(meeting.notes ?? '');
  const dirty = notes !== (meeting.notes ?? '');
  const save = useApiMutation(
    (api, body: UpdateMeetingInput) => api.patch<MeetingDetail>(meetingApi(meeting.reference), body),
    { invalidate: INVALIDATE, success: t('notesSaved') },
  );
  const organise = useApiMutation(
    async (api, body: { notes: string }) => {
      // The notes the minutes come from are kept with them.
      if (dirty) await api.patch(meetingApi(meeting.reference), { notes: body.notes || null });
      return api.post<OrganiseResult>(`${meetingApi(meeting.reference)}/organise`, body);
    },
    { invalidate: INVALIDATE, onSuccess: onOrganised },
  );
  if (!meeting.viewer.canEdit)
    return (
      <Card className="min-w-0 gap-4">
        <CardHeader>
          <CardTitle>{t('notes')}</CardTitle>
        </CardHeader>
        <CardContent>
          {meeting.notes ? (
            <Markdown>{meeting.notes}</Markdown>
          ) : (
            <Text type="supporting">{t('noNotes')}</Text>
          )}
        </CardContent>
      </Card>
    );
  return (
    <Card className="min-w-0 gap-4">
      <CardHeader>
        <CardTitle>{t('notes')}</CardTitle>
        <CardDescription>{t('notesHint')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <TextArea
          label={t('notes')}
          isLabelHidden
          rows={12}
          maxLength={100_000}
          value={notes}
          placeholder={t('notesPlaceholder')}
          onChange={setNotes}
        />
        <HStack gap={2} wrap="wrap">
          <Button
            label={t('organise')}
            variant={meeting.status === 'draft' && !meeting.actionItems.length ? 'primary' : 'secondary'}
            icon={<Icon icon={SparklesIcon} />}
            isDisabled={!notes.trim()}
            isLoading={organise.isPending}
            onClick={() => organise.mutate({ notes })}
          />
          <Button
            label={t('saveNotes')}
            variant="secondary"
            isDisabled={!dirty}
            isLoading={save.isPending}
            onClick={() => save.mutate({ notes: notes || null })}
          />
        </HStack>
      </CardContent>
    </Card>
  );
}

/** Summary, decisions and open questions; editable by the organiser and attendees. */
function MinutesCard({ meeting }: { meeting: MeetingDetail }) {
  const t = useTranslations('meetings.meeting');
  const tc = useTranslations('common');
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState('');
  const [decisions, setDecisions] = useState('');
  const [questions, setQuestions] = useState('');
  const save = useApiMutation(
    (api, body: UpdateMeetingInput) => api.patch<MeetingDetail>(meetingApi(meeting.reference), body),
    { invalidate: INVALIDATE, success: t('minutesSaved'), onSuccess: () => setEditing(false) },
  );
  const empty = !meeting.summary && !meeting.decisions.length && !meeting.questions.length;
  return (
    <Card className="min-w-0 gap-4">
      <CardHeader>
        <CardTitle>{t('minutes')}</CardTitle>
        {meeting.organisedMode && (
          <CardDescription>
            {meeting.organisedMode === 'llm' ? t('organisedAi') : t('organisedBuiltin')}
          </CardDescription>
        )}
        {meeting.viewer.canEdit && (
          <CardAction>
            <Button
              label={t('editMinutes')}
              variant="ghost"
              size="sm"
              icon={<Icon icon={PencilIcon} />}
              onClick={() => {
                setSummary(meeting.summary ?? '');
                setDecisions(meeting.decisions.join('\n'));
                setQuestions(meeting.questions.join('\n'));
                setEditing(true);
              }}
            />
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="grid gap-4">
        {empty && (
          <Text type="supporting">{meeting.viewer.canEdit ? t('noMinutesEditor') : t('noMinutes')}</Text>
        )}
        {meeting.summary && <Markdown>{meeting.summary}</Markdown>}
        {meeting.decisions.length > 0 && (
          <section className="grid gap-1.5" aria-labelledby="decisions">
            <Text type="label" id="decisions">
              {t('decisions')}
            </Text>
            <ul className="grid gap-1">
              {meeting.decisions.map((d, i) => (
                <li key={`${i}-${d}`} className="wrap-anywhere">
                  <Text>{d}</Text>
                </li>
              ))}
            </ul>
          </section>
        )}
        {meeting.questions.length > 0 && (
          <section className="grid gap-1.5" aria-labelledby="questions">
            <Text type="label" id="questions">
              {t('questions')}
            </Text>
            <ul className="grid gap-1">
              {meeting.questions.map((q, i) => (
                <li key={`${i}-${q}`} className="wrap-anywhere">
                  <Text>{q}</Text>
                </li>
              ))}
            </ul>
          </section>
        )}
      </CardContent>
      <FormDialog
        isOpen={editing}
        onOpenChange={setEditing}
        title={t('editMinutes')}
        size="lg"
        submitLabel={tc('save')}
        cancelLabel={tc('cancel')}
        isSubmitting={save.isPending}
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({
            summary: summary.trim() || null,
            decisions: lines(decisions),
            questions: lines(questions),
          });
        }}
      >
        <TextArea label={t('summary')} rows={4} maxLength={10_000} value={summary} onChange={setSummary} />
        <TextArea
          label={t('decisions')}
          description={t('onePerLine')}
          rows={4}
          value={decisions}
          onChange={setDecisions}
        />
        <TextArea
          label={t('questions')}
          description={t('onePerLine')}
          rows={3}
          value={questions}
          onChange={setQuestions}
        />
      </FormDialog>
    </Card>
  );
}

function DetailsCard({ meeting }: { meeting: MeetingDetail }) {
  const t = useTranslations('meetings.meeting');
  const tv = useTranslations('meetings.visibility');
  const format = useFormatter();
  const end = new Date(new Date(meeting.startsAt).getTime() + meeting.durationMinutes * 60_000);
  return (
    <Card className="min-w-0 gap-3">
      <CardHeader>
        <CardTitle>{t('details')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <MetadataList>
          <MetadataListItem label={t('when')}>
            {format.dateTimeRange(new Date(meeting.startsAt), end, {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </MetadataListItem>
          {meeting.location && <MetadataListItem label={t('where')}>{meeting.location}</MetadataListItem>}
          <MetadataListItem label={t('organizer')}>{meeting.organizer?.displayName ?? '—'}</MetadataListItem>
          <MetadataListItem label={t('visibility')}>{tv(meeting.visibility)}</MetadataListItem>
        </MetadataList>
        <VStack gap={2}>
          <Text type="label">{t('attendees', { count: meeting.attendees.length })}</Text>
          <ul className="grid gap-1.5">
            {meeting.attendees.map((a) => (
              <li key={a.id} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
                <UserAvatar name={a.displayName} src={a.avatarUrl} className="size-6 text-[10px]" />
                <span className="min-w-0 truncate">
                  <Text>{a.displayName}</Text>
                </span>
              </li>
            ))}
          </ul>
          {meeting.guests && <Text type="supporting">{t('guestsValue', { guests: meeting.guests })}</Text>}
        </VStack>
      </CardContent>
    </Card>
  );
}

/** One meeting: details, notes, minutes, action items (and the open ones from before), links and files. */
export default function MeetingPage({ params }: WebPageProps) {
  const t = useTranslations('meetings.meeting');
  const ti = useTranslations('meetings.items');
  const tc = useTranslations('common');
  const format = useFormatter();
  const router = useRouter();
  const search = useSearchParams();
  const routedToast = useRoutedToast();
  const ref = (params.ref ?? '').toUpperCase();
  const { data: meeting, isLoading, error, refetch } = useMeeting(ref);
  const [editing, setEditing] = useState(false);
  const [organised, setOrganised] = useState<OrganiseResult | null>(null);
  const [itemDialog, setItemDialog] = useState<{ item: ActionItem | null } | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const focusItem = search.get('item');

  useEffect(() => {
    if (!meeting || !focusItem) return;
    document.getElementById(`item-${focusItem}`)?.scrollIntoView({ block: 'center' });
  }, [meeting, focusItem]);

  const publish = useApiMutation((api) => api.post<PublishResult>(`${meetingApi(ref)}/publish`, {}), {
    invalidate: INVALIDATE,
    silent: true,
    onSuccess: (r) => {
      setConfirmSend(false);
      toast.success(t('sent'));
      routedToast(r.routed);
    },
  });
  const followUp = useApiMutation((api) => api.post<MeetingDetail>(`${meetingApi(ref)}/follow-up`, {}), {
    invalidate: INVALIDATE,
    success: t('followUpCreated'),
    onSuccess: (m) => router.push(meetingHref(m.reference)),
  });
  const remove = useApiMutation((api) => api.delete(meetingApi(ref)), {
    invalidate: INVALIDATE,
    success: t('deleted'),
    onSuccess: () => router.push('/meetings'),
  });

  if (isLoading) return <PageSkeleton />;
  if (error || !meeting) {
    const missing = error instanceof ApiError && error.status === 404;
    return missing ? (
      <EmptyState icon={<NotebookTextIcon />} title={t('notFound')} description={ref} />
    ) : (
      <ErrorState error={error} onRetry={() => void refetch()} kind="page" />
    );
  }

  const v = meeting.viewer;
  const draft = meeting.status === 'draft';
  const taskItems = meeting.actionItems.filter((i) => i.destination === 'task' && !i.task).length;
  const today = todayLocal();
  const record = { type: 'meetings.meeting', id: meeting.id };
  const end = new Date(new Date(meeting.startsAt).getTime() + meeting.durationMinutes * 60_000);

  return (
    <div className="grid min-w-0 gap-4">
      <DetailHeader
        back={{ href: '/meetings', label: t('back'), highlight: meeting.reference }}
        icon={<NotebookTextIcon />}
        reference={meeting.reference}
        title={meeting.title}
        status={
          <>
            <MeetingStatusBadge status={meeting.status} />
            <VisibilityBadge visibility={meeting.visibility} />
          </>
        }
        meta={format.dateTimeRange(new Date(meeting.startsAt), end, {
          dateStyle: 'medium',
          timeStyle: 'short',
        })}
        primaryAction={
          v.canEdit && draft ? (
            <Button
              label={t('send')}
              variant="primary"
              icon={<Icon icon={SendIcon} />}
              onClick={() => setConfirmSend(true)}
            />
          ) : !draft ? (
            <Button
              label={t('followUp')}
              variant="secondary"
              icon={<Icon icon={CalendarPlusIcon} />}
              isLoading={followUp.isPending}
              onClick={() => followUp.mutate(undefined)}
            />
          ) : undefined
        }
        actions={
          v.canEdit
            ? [{ label: t('editDetails'), icon: <PencilIcon />, onSelect: () => setEditing(true) }]
            : []
        }
        menu={[
          ...(draft ? [{ label: t('followUp'), onSelect: () => followUp.mutate(undefined) }] : []),
          ...(v.canDelete
            ? [{ label: tc('delete'), destructive: true, onSelect: () => setConfirmDelete(true) }]
            : []),
        ]}
      />
      {draft && v.canEdit && (
        <Banner
          status="info"
          collapsible={false}
          title={t('draftBanner')}
          description={t('draftBannerHint')}
        />
      )}
      <div className="grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 gap-4">
          <NotesCard key={meeting.updatedAt} meeting={meeting} onOrganised={setOrganised} />
          <MinutesCard meeting={meeting} />
          <Card className="min-w-0 gap-4">
            <CardHeader>
              <CardTitle>{t('actionItems', { count: meeting.actionItems.length })}</CardTitle>
              <CardDescription>{draft ? t('itemsDraftHint') : t('itemsLiveHint')}</CardDescription>
              {v.canEdit && (
                <CardAction>
                  <Button
                    label={ti('add')}
                    variant="ghost"
                    size="sm"
                    icon={<Icon icon={PlusIcon} />}
                    onClick={() => setItemDialog({ item: null })}
                  />
                </CardAction>
              )}
            </CardHeader>
            <CardContent>
              {meeting.actionItems.length ? (
                <ItemList
                  items={meeting.actionItems}
                  onEdit={(item) => setItemDialog({ item })}
                  today={today}
                />
              ) : (
                <Text type="supporting">{v.canEdit ? t('noItemsEditor') : t('noItems')}</Text>
              )}
            </CardContent>
          </Card>
          {meeting.earlierItems.length > 0 && (
            <Card className="min-w-0 gap-4">
              <CardHeader>
                <CardTitle>{t('earlierItems', { count: meeting.earlierItems.length })}</CardTitle>
                {meeting.previous && (
                  <CardDescription>
                    {t('followsUp', { reference: meeting.previous.reference, title: meeting.previous.title })}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <ItemList items={meeting.earlierItems} showMeeting today={today} />
              </CardContent>
            </Card>
          )}
        </div>
        <div className="grid min-w-0 gap-4">
          <DetailsCard meeting={meeting} />
          <Slot name="core.record.links" props={{ record } satisfies RecordPanelSlotProps} />
          <Slot name="core.record.files" props={{ record } satisfies RecordPanelSlotProps} />
        </div>
      </div>
      {v.canEdit && (
        <>
          <MeetingSheet
            open={editing}
            onOpenChange={setEditing}
            meeting={meeting}
            onSaved={() => setEditing(false)}
          />
          <OrganiseSheet
            meeting={meeting}
            result={organised}
            onOpenChange={(o) => !o && setOrganised(null)}
            onSaved={() => setOrganised(null)}
          />
          {itemDialog && (
            <ItemDialog
              key={itemDialog.item?.id ?? 'new'}
              meeting={meeting}
              item={itemDialog.item}
              open
              onOpenChange={(o) => !o && setItemDialog(null)}
            />
          )}
          <AlertDialog
            isOpen={confirmSend}
            onOpenChange={setConfirmSend}
            title={t('sendTitle')}
            description={t('sendBody', {
              attendees: Math.max(0, meeting.attendees.length - 1),
              items: meeting.actionItems.length,
              tasks: taskItems,
            })}
            actionLabel={t('send')}
            actionVariant="primary"
            cancelLabel={tc('cancel')}
            isActionLoading={publish.isPending}
            onAction={() => publish.mutate(undefined)}
          />
        </>
      )}
      {v.canDelete && (
        <AlertDialog
          isOpen={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={t('deleteTitle', { reference: meeting.reference })}
          description={t('deleteBody')}
          actionLabel={tc('delete')}
          cancelLabel={tc('cancel')}
          isActionLoading={remove.isPending}
          onAction={() => remove.mutate(undefined)}
        />
      )}
    </div>
  );
}
