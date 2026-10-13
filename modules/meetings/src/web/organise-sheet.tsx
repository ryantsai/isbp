'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { DateInput } from '@astryxdesign/core/DateInput';
import { Divider } from '@astryxdesign/core/Divider';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid } from '@astryxdesign/core/Grid';
import { VStack } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { ISODateString } from '@astryxdesign/core/Calendar';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
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
import { useTranslations } from 'next-intl';
import { Fragment, useState } from 'react';
import type { ApplyMinutesInput, MeetingDetail, OrganiseResult, ProposedItem } from '../contracts';
import { INVALIDATE, meetingApi } from './lib';

const NONE = '__none__';
const lines = (v: string) =>
  v
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-*•・]\s*/, '').trim())
    .filter(Boolean);

type Row = ProposedItem & { include: boolean; key: number };

/**
 * The organised minutes, for a person to check before anything is saved: summary, decisions and questions as text,
 * and each action item with its owner, due date and where it goes (tracked here, or a task of a linked project).
 */
export function OrganiseSheet({
  meeting,
  result,
  onOpenChange,
  onSaved,
}: {
  meeting: MeetingDetail;
  /** The proposal ("Organise"); null closes the sheet. */
  result: OrganiseResult | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (m: MeetingDetail) => void;
}) {
  const t = useTranslations('meetings.organise');
  const tc = useTranslations('common');
  return (
    <Sheet open={result !== null} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl" closeLabel={tc('close')}>
        <SheetHeader>
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>{t('description')}</SheetDescription>
        </SheetHeader>
        {result && (
          <OrganiseForm
            meeting={meeting}
            result={result}
            onSaved={onSaved}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function OrganiseForm({
  meeting,
  result,
  onSaved,
  onCancel,
}: {
  meeting: MeetingDetail;
  result: OrganiseResult;
  onSaved: (m: MeetingDetail) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('meetings.organise');
  const ti = useTranslations('meetings.items');
  const errorText = useErrorText();
  const [summary, setSummary] = useState(result.summary ?? '');
  const [decisions, setDecisions] = useState(result.decisions.join('\n'));
  const [questions, setQuestions] = useState(result.questions.join('\n'));
  const [rows, setRows] = useState<Row[]>(() =>
    result.actionItems.map((i, key) => ({ ...i, include: true, key })),
  );
  const [error, setError] = useState<string | null>(null);
  const update = (key: number, patch: Partial<Row>) =>
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const canTask = meeting.projects.length > 0;

  const save = useApiMutation(
    (api, body: ApplyMinutesInput) =>
      api.post<MeetingDetail>(`${meetingApi(meeting.reference)}/minutes`, body),
    { invalidate: INVALIDATE, success: t('saved'), onSuccess: onSaved, silent: true },
  );

  const submit = () => {
    const chosen = rows.filter((r) => r.include);
    if (chosen.some((r) => !r.title.trim())) return setError(t('titleRequired'));
    if (chosen.some((r) => r.destination === 'task' && !r.projectId)) return setError(t('projectRequired'));
    setError(null);
    save.mutate(
      {
        summary: summary.trim() || null,
        decisions: lines(decisions),
        questions: lines(questions),
        mode: result.mode,
        actionItems: chosen.map((r) => ({
          title: r.title.trim(),
          ownerId: r.ownerId,
          dueDate: r.dueDate,
          destination: r.destination,
          projectId: r.destination === 'task' ? r.projectId : null,
        })),
      },
      { onError: (err) => setError(errorText(err)) },
    );
  };

  const people = [
    { value: NONE, label: ti('noOwner') },
    ...meeting.attendees.map((a) => ({ value: a.id, label: a.displayName })),
  ];

  return (
    <SheetForm
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <SheetBody className="py-2">
        <VStack gap={4}>
          <Banner
            status="info"
            collapsible={false}
            title={result.fallback ? t('fallback') : result.mode === 'llm' ? t('llm') : t('builtin')}
            description={result.mode === 'builtin' ? t('builtinHint') : undefined}
          />
          <FormLayout defaultOptionality="optional">
            <TextArea
              label={t('summary')}
              rows={4}
              maxLength={10_000}
              value={summary}
              onChange={setSummary}
            />
            <TextArea
              label={t('decisions')}
              description={t('onePerLine')}
              rows={3}
              value={decisions}
              onChange={setDecisions}
            />
            <TextArea
              label={t('questions')}
              description={t('onePerLine')}
              rows={2}
              value={questions}
              onChange={setQuestions}
            />
          </FormLayout>
          <VStack gap={3}>
            <Text type="label">{t('items', { count: rows.filter((r) => r.include).length })}</Text>
            {!rows.length && <Text type="supporting">{t('noItems')}</Text>}
            {rows.map((r, i) => (
              <Fragment key={r.key}>
                {i > 0 && <Divider />}
                <VStack gap={2}>
                  <CheckboxInput
                    label={t('include', { n: i + 1 })}
                    value={r.include}
                    onChange={(v) => update(r.key, { include: v })}
                  />
                  {r.include && (
                    <>
                      <TextInput
                        label={ti('title')}
                        value={r.title}
                        onChange={(v) => update(r.key, { title: v.slice(0, 300) })}
                      />
                      <Grid columns={{ minWidth: 180 }} gap={3}>
                        <Selector
                          label={ti('owner')}
                          description={
                            r.ownerHint && !r.ownerId ? ti('ownerHint', { name: r.ownerHint }) : undefined
                          }
                          value={r.ownerId ?? NONE}
                          onChange={(v) => update(r.key, { ownerId: v === NONE ? null : v })}
                          options={people}
                        />
                        <DateInput
                          label={ti('dueDate')}
                          hasClear
                          value={(r.dueDate || undefined) as ISODateString | undefined}
                          onChange={(v) => update(r.key, { dueDate: v ?? null })}
                        />
                        <Selector
                          label={ti('destination')}
                          value={r.destination === 'task' && r.projectId ? `task:${r.projectId}` : 'meeting'}
                          onChange={(v) =>
                            update(
                              r.key,
                              v.startsWith('task:')
                                ? { destination: 'task', projectId: v.slice(5) }
                                : { destination: 'meeting', projectId: null },
                            )
                          }
                          options={[
                            { value: 'meeting', label: ti('trackedHere') },
                            ...(canTask
                              ? meeting.projects.map((p) => ({
                                  value: `task:${p.id}`,
                                  label: ti('taskIn', { project: p.key }),
                                }))
                              : []),
                          ]}
                        />
                      </Grid>
                    </>
                  )}
                </VStack>
              </Fragment>
            ))}
            {!canTask && rows.length > 0 && <Text type="supporting">{t('linkProjectHint')}</Text>}
          </VStack>
          {error && <Banner status="error" title={error} collapsible={false} />}
        </VStack>
      </SheetBody>
      <SheetFooter>
        <Button label={t('cancel')} variant="secondary" type="button" onClick={onCancel} />
        <Button label={t('save')} variant="primary" isLoading={save.isPending} type="submit" />
      </SheetFooter>
    </SheetForm>
  );
}
