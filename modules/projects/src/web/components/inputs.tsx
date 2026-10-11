'use client';

import type { ISODateString } from '@astryxdesign/core/Calendar';
import { Card } from '@astryxdesign/core/Card';
import { VStack } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { Tokenizer } from '@astryxdesign/core/Tokenizer';
import { createStaticSource, type SearchableItem } from '@astryxdesign/core/Typeahead';
import { UserAvatar } from '@isbp/ui/avatar';
import { Markdown } from '@isbp/ui/markdown';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import type { Member, Milestone } from '../../contracts';

export const NONE = '__none__';

/** A `YYYY-MM-DD` string (or empty) as the value an Astryx date input takes. */
export const toIsoDate = (day: string | null | undefined): ISODateString | undefined =>
  day ? (day as ISODateString) : undefined;

const MAX_LABELS = 20;

/** Free-text labels (Enter adds one, with the project's existing labels as suggestions). */
export function LabelInput({
  value,
  onChange,
  label,
  isLabelHidden,
  placeholder,
  suggestions = [],
}: {
  value: string[];
  onChange: (labels: string[]) => void;
  /** Accessible name (and visible label unless `isLabelHidden`). */
  label: string;
  isLabelHidden?: boolean;
  placeholder?: string;
  suggestions?: readonly string[];
}) {
  const items = useMemo<SearchableItem[]>(() => value.map((l) => ({ id: l, label: l })), [value]);
  const source = useMemo(
    () => createStaticSource<SearchableItem>(suggestions.map((s) => ({ id: s, label: s }))),
    [suggestions],
  );
  return (
    <Tokenizer
      label={label}
      isLabelHidden={isLabelHidden}
      placeholder={placeholder}
      searchSource={source}
      value={items}
      hasCreate
      hasEntriesOnFocus
      maxEntries={MAX_LABELS}
      onChange={(next) => {
        const labels: string[] = [];
        for (const item of next) {
          const clean = item.label.trim().replace(/[,<>]/g, '').slice(0, 40);
          if (clean && !labels.includes(clean)) labels.push(clean);
        }
        onChange(labels);
      }}
    />
  );
}

/** Markdown with a Write / Preview switch (preview renders through the safe `Markdown`). */
export function MarkdownEditor({
  value,
  onChange,
  label,
  isLabelHidden = true,
  rows = 6,
  placeholder,
  hasAutoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Name of the text area; shown above the switch unless `isLabelHidden`. */
  label: string;
  isLabelHidden?: boolean;
  rows?: number;
  placeholder?: string;
  hasAutoFocus?: boolean;
}) {
  const t = useTranslations('projects.markdown');
  const uid = useId();
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  return (
    <VStack gap={2}>
      {!isLabelHidden && (
        <Text type="label" aria-hidden>
          {label}
        </Text>
      )}
      <TabList
        role="tablist"
        size="sm"
        aria-label={label}
        value={tab}
        onChange={(v) => setTab(v as 'write' | 'preview')}
      >
        <Tab value="write" label={t('write')} panelId={`${uid}-write`} />
        <Tab value="preview" label={t('preview')} panelId={`${uid}-preview`} />
      </TabList>
      <div role="tabpanel" id={`${uid}-write`} aria-label={t('write')} hidden={tab !== 'write'}>
        {tab === 'write' && (
          <VStack gap={1}>
            <TextArea
              label={label}
              isLabelHidden
              rows={rows}
              value={value}
              placeholder={placeholder}
              hasAutoFocus={hasAutoFocus}
              onChange={onChange}
            />
            <Text type="supporting">{t('hint')}</Text>
          </VStack>
        )}
      </div>
      <div role="tabpanel" id={`${uid}-preview`} aria-label={t('preview')} hidden={tab !== 'preview'}>
        {tab === 'preview' && (
          <Card padding={3} minHeight={96}>
            {value.trim() ? <Markdown>{value}</Markdown> : <Text type="supporting">{t('nothing')}</Text>}
          </Card>
        )}
      </div>
    </VStack>
  );
}

/** Assignee picker: the project's active managers and members. */
export function MemberSelect({
  members,
  value,
  onChange,
  label,
  isLabelHidden,
  isDisabled,
  allowNone = true,
  width,
}: {
  members: readonly Member[];
  value: string | null;
  onChange: (userId: string | null) => void;
  label?: string;
  isLabelHidden?: boolean;
  isDisabled?: boolean;
  allowNone?: boolean;
  width?: number | string;
}) {
  const t = useTranslations('projects.fields');
  const options = members.filter((m) => m.active && m.role !== 'viewer');
  const current = members.find((m) => m.userId === value);
  return (
    <Selector
      label={label ?? t('assignee')}
      isLabelHidden={isLabelHidden}
      isDisabled={isDisabled}
      width={width}
      value={value ?? NONE}
      onChange={(v) => onChange(v === NONE ? null : v)}
      options={[
        ...(allowNone ? [{ value: NONE, label: t('unassigned') }] : []),
        ...(current && !options.includes(current)
          ? [{ value: current.userId, label: current.displayName, disabled: true }]
          : []),
        ...options.map((m) => ({
          value: m.userId,
          label: m.displayName,
          icon: <UserAvatar name={m.displayName} src={m.avatarUrl} className="size-5 text-[9px]" />,
        })),
      ]}
    />
  );
}

export function MilestoneSelect({
  milestones,
  value,
  onChange,
  label,
  isLabelHidden,
  isDisabled,
  width,
}: {
  milestones: readonly Pick<Milestone, 'id' | 'name'>[];
  value: string | null;
  onChange: (id: string | null) => void;
  label?: string;
  isLabelHidden?: boolean;
  isDisabled?: boolean;
  width?: number | string;
}) {
  const t = useTranslations('projects.fields');
  return (
    <Selector
      label={label ?? t('milestone')}
      isLabelHidden={isLabelHidden}
      isDisabled={isDisabled}
      width={width}
      value={value ?? NONE}
      onChange={(v) => onChange(v === NONE ? null : v)}
      options={[
        { value: NONE, label: t('noMilestone') },
        ...milestones.map((m) => ({ value: m.id, label: m.name })),
      ]}
    />
  );
}
