'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { DateTimeInput, type ISODateTimeString } from '@astryxdesign/core/DateTimeInput';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid } from '@astryxdesign/core/Grid';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { VStack } from '@astryxdesign/core/Layout';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { ApiError, usePlatform } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import { PersonPicker, usePeople } from '@isbp/ui/person-picker';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import { RecordPicker } from '@isbp/ui/record-picker';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetForm,
  SheetHeader,
  SheetTitle,
} from '@isbp/ui/sheet';
import { XIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import {
  type CreateMeetingInput,
  type MeetingDetail,
  type UpdateMeetingInput,
  VISIBILITIES,
  type Visibility,
} from '../contracts';
import { fromLocalInput, INVALIDATE, meetingApi, toLocalInput } from './lib';

const DURATIONS = [15, 30, 45, 60, 90, 120, 180];

/** The people at a meeting: a list with "remove", and a picker to add someone. */
export function AttendeesField({
  value,
  onChange,
  locked = [],
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  /** People who always attend (the organiser): listed without "remove". */
  locked?: string[];
}) {
  const t = useTranslations('meetings.form');
  const id = useId();
  const people = usePeople(value);
  return (
    <Field label={t('attendees')} inputID={id} description={t('attendeesHint')}>
      <VStack gap={2}>
        {value.length > 0 && (
          <ul className="grid gap-1.5">
            {value.map((pid) => {
              const p = people.get(pid);
              return (
                <li key={pid} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
                  <UserAvatar
                    name={p?.displayName ?? '…'}
                    src={p?.avatarUrl}
                    className="size-6 text-[10px]"
                  />
                  <span className="min-w-0 truncate">
                    <Text>{p?.displayName ?? '…'}</Text>
                  </span>
                  {locked.includes(pid) ? (
                    <Text type="supporting">{t('organizer')}</Text>
                  ) : (
                    <IconButton
                      label={t('removeAttendee', { name: p?.displayName ?? '' })}
                      icon={<Icon icon={XIcon} />}
                      variant="ghost"
                      size="sm"
                      onClick={() => onChange(value.filter((x) => x !== pid))}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <PersonPicker
          id={id}
          value={null}
          excludeIds={value}
          placeholder={t('addAttendee')}
          onChange={(p) => p && onChange([...value, p.id])}
        />
      </VStack>
    </Field>
  );
}

/** New meeting (with the record it is about) or its details (organiser and attendees). */
export function MeetingSheet({
  open,
  onOpenChange,
  meeting,
  onSaved,
  defaultLink,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The meeting to edit; null for a new one. */
  meeting: MeetingDetail | null;
  onSaved: (m: MeetingDetail) => void;
  /** A record the new meeting is about (`projects.project:<id>`), e.g. from `?link=`. */
  defaultLink?: string | null;
}) {
  const t = useTranslations('meetings.form');
  const tc = useTranslations('common');
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl" closeLabel={tc('close')}>
        <SheetHeader>
          <SheetTitle>{meeting ? t('editTitle') : t('newTitle')}</SheetTitle>
          <SheetDescription>
            {meeting ? `${meeting.reference} · ${meeting.title}` : t('newHint')}
          </SheetDescription>
        </SheetHeader>
        {open && (
          <MeetingForm
            meeting={meeting}
            defaultLink={defaultLink ?? null}
            onSaved={onSaved}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function nextHalfHour() {
  const d = new Date();
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return toLocalInput(d);
}

function MeetingForm({
  meeting,
  defaultLink,
  onSaved,
  onCancel,
}: {
  meeting: MeetingDetail | null;
  defaultLink: string | null;
  onSaved: (m: MeetingDetail) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('meetings.form');
  const tv = useTranslations('meetings.visibility');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const list = useFieldList();
  const { user, enabledModules } = usePlatform();
  const linkId = useId();
  const organizerId = meeting?.organizer?.id ?? user.id;
  const [title, setTitle] = useState(meeting?.title ?? '');
  const [startsAt, setStartsAt] = useState(meeting ? toLocalInput(meeting.startsAt) : nextHalfHour());
  const [duration, setDuration] = useState(String(meeting?.durationMinutes ?? 60));
  const [location, setLocation] = useState(meeting?.location ?? '');
  const [visibility, setVisibility] = useState<Visibility>(meeting?.visibility ?? 'private');
  const [attendees, setAttendees] = useState<string[]>(meeting?.attendees.map((a) => a.id) ?? [user.id]);
  const [guests, setGuests] = useState(meeting?.guests ?? '');
  const [links, setLinks] = useState<string[]>(defaultLink ? [defaultLink] : []);
  const [errors, setErrors] = useState<{ title?: string; startsAt?: string; root?: string }>({});

  const save = useApiMutation(
    (api, body: CreateMeetingInput | UpdateMeetingInput) =>
      meeting
        ? api.patch<MeetingDetail>(meetingApi(meeting.reference), body)
        : api.post<MeetingDetail>('/meetings/meetings', body),
    {
      invalidate: INVALIDATE,
      success: meeting ? t('saved') : t('created'),
      onSuccess: onSaved,
      silent: true,
    },
  );

  const submit = async () => {
    const next: typeof errors = {};
    if (!title.trim()) next.title = t('titleRequired');
    if (!startsAt) next.startsAt = t('startsRequired');
    setErrors(next);
    if (Object.keys(next).length) return;
    const body = {
      title: title.trim(),
      startsAt: fromLocalInput(startsAt)!,
      durationMinutes: Number(duration),
      location: location.trim() || null,
      visibility,
      attendeeIds: attendees,
      guests: guests.trim() || null,
    };
    try {
      await save.mutateAsync(meeting ? body : { ...body, links });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') {
        const issue = (err.details as { issues?: { path: string; message: string }[] } | undefined)
          ?.issues?.[0];
        if (issue?.path === 'title') return setErrors({ title: issue.message });
      }
      setErrors({ root: errorText(err) });
    }
  };

  return (
    <SheetForm
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <SheetBody className="py-2">
        <FormLayout defaultOptionality="optional">
          <TextInput
            label={t('title')}
            isRequired
            hasAutoFocus={!meeting}
            value={title}
            status={errors.title ? { type: 'error', message: errors.title } : undefined}
            onChange={(v) => setTitle(v.slice(0, 200))}
          />
          <Grid columns={{ minWidth: 200 }} gap={3}>
            <DateTimeInput
              label={t('startsAt')}
              isRequired
              hourFormat="24h"
              value={(startsAt || undefined) as ISODateTimeString | undefined}
              status={errors.startsAt ? { type: 'error', message: errors.startsAt } : undefined}
              onChange={(v) => setStartsAt(v ?? '')}
            />
            <Selector
              label={t('duration')}
              value={duration}
              onChange={setDuration}
              options={DURATIONS.map((m) => ({ value: String(m), label: t('minutes', { minutes: m }) }))}
            />
          </Grid>
          <AttendeesField value={attendees} onChange={setAttendees} locked={[organizerId]} />
          {!meeting && enabledModules.includes('projects') && (
            <Field label={t('about')} inputID={linkId} description={t('aboutHint')}>
              <RecordPicker id={linkId} value={links} onChange={setLinks} types={['projects.project']} />
            </Field>
          )}
          <RadioList
            label={t('visibility')}
            value={visibility}
            onChange={(v) => setVisibility(v as Visibility)}
          >
            {VISIBILITIES.map((v) => (
              <RadioListItem key={v} value={v} label={tv(v)} description={tv(`${v}Hint`)} />
            ))}
          </RadioList>
          <OptionalFields hint={list([t('location'), t('guests')])} filled={countFilled(location, guests)}>
            <FormLayout defaultOptionality="optional">
              <TextInput
                label={t('location')}
                value={location}
                onChange={(v) => setLocation(v.slice(0, 300))}
              />
              <TextArea
                label={t('guests')}
                description={t('guestsHint')}
                rows={2}
                maxLength={500}
                value={guests}
                onChange={setGuests}
              />
            </FormLayout>
          </OptionalFields>
          {errors.root && <Banner status="error" title={errors.root} collapsible={false} />}
        </FormLayout>
      </SheetBody>
      <SheetFooter>
        <Button label={tc('cancel')} variant="secondary" type="button" onClick={onCancel} />
        <Button
          label={meeting ? tc('saveChanges') : tc('create')}
          variant="primary"
          isLoading={save.isPending}
          type="submit"
        />
      </SheetFooter>
    </SheetForm>
  );
}
