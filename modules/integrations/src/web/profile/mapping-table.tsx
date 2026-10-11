'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Divider } from '@astryxdesign/core/Divider';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, Layout, LayoutContent, LayoutFooter, VStack } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import {
  CircleAlertIcon,
  ListPlusIcon,
  PlusIcon,
  Rows3Icon,
  Trash2Icon,
  WandSparklesIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import {
  type Direction,
  type FieldMapping,
  isCompatible,
  type LocalField,
  MAPPING_DIRECTIONS,
  type MappingDirection,
  type RemoteField,
} from '../../contracts';
import type { MappingIssue } from '../../mapping';
import { DIRECTION_ICON } from '../badges';
import { useLabel } from '../lib';

/** An issue's translated text (the API's English message when the code is unknown). */
export function useIssueText() {
  const t = useTranslations('integrations.issues');
  const tf = useTranslations('integrations.fieldType');
  return (i: { code?: string; message: string; params?: Record<string, string> }) => {
    if (!i.code || !t.has(i.code)) return i.message;
    const params = { ...(i.params ?? {}) };
    if (i.code === 'incompatible')
      for (const k of ['local', 'remote'] as const)
        if (params[k] && tf.has(params[k])) params[k] = tf(params[k]);
    return t(i.code, params);
  };
}

/** The problems of one field or row, each with an icon and its text (never colour alone). */
export function IssueList({
  issues,
  id,
}: {
  issues: { code?: string; message: string; params?: Record<string, string> }[];
  id?: string;
}) {
  const text = useIssueText();
  if (!issues.length) return null;
  return (
    <VStack as="ul" id={id} gap={0.5}>
      {issues.map((i, k) => (
        <HStack as="li" key={k} gap={1.5} vAlign="start">
          <Icon icon={CircleAlertIcon} color="error" />
          <Text type="supporting">{text(i)}</Text>
        </HStack>
      ))}
    </VStack>
  );
}

interface ValueRow {
  remote: string;
  local: string;
  direction: MappingDirection;
}

/** The API's value-map rules for live feedback: per direction, a value may have one row. */
function rowIssues(rows: ValueRow[]): MappingIssue[][] {
  const pulls = new Set<string>();
  const pushes = new Set<string>();
  return rows.map((r) => {
    const out: MappingIssue[] = [];
    if (r.remote.trim() && r.direction !== 'push') {
      const k = r.remote.trim().toLowerCase();
      if (pulls.has(k))
        out.push({ path: 'remote', code: 'duplicate_value', message: '', params: { value: r.remote } });
      pulls.add(k);
    }
    if (r.local.trim() && r.direction !== 'pull') {
      const k = r.local.trim().toLowerCase();
      if (pushes.has(k))
        out.push({ path: 'local', code: 'duplicate_local_value', message: '', params: { value: r.local } });
      pushes.add(k);
    }
    return out;
  });
}

/** A choice field's value picker (the field's own choices, with the raw value as a hint). */
function ChoiceSelect({
  value,
  choices,
  onChange,
  label,
  invalid,
  disabled,
  placeholder,
}: {
  value: string;
  choices: { value: string; label: string }[];
  onChange: (v: string) => void;
  label: string;
  invalid: boolean;
  disabled: boolean;
  placeholder: string;
}) {
  return (
    <Selector
      label={label}
      isLabelHidden
      placeholder={placeholder}
      isDisabled={disabled}
      options={choices.map((c) => ({
        value: c.value,
        label: c.label,
        description: c.label !== c.value ? c.value : undefined,
      }))}
      value={value}
      onChange={onChange}
      status={invalid ? { type: 'error' } : undefined}
    />
  );
}

/**
 * The value map of one mapping: rows of remote value ↔ ISBP value, each with a direction, so several remote
 * values can become one ISBP value ("Into ISBP only") while one row says what it becomes going out. Values
 * identical on both sides need no row.
 */
function ValueMapDialog({
  open,
  onOpenChange,
  mapping,
  local,
  remote,
  system,
  onSave,
  readOnly,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mapping: FieldMapping;
  local: LocalField;
  remote: RemoteField;
  system: string;
  onSave: (values: { remote: string; local: string; direction?: MappingDirection }[]) => void;
  readOnly: boolean;
}) {
  const t = useTranslations('integrations.mapping');
  const tc = useTranslations('common');
  const label = useLabel();
  const id = useId();
  const [rows, setRows] = useState<ValueRow[]>(() =>
    (mapping.values ?? []).map((v) => ({
      remote: v.remote,
      local: v.local,
      direction: v.direction ?? 'both',
    })),
  );
  const remoteChoices = remote.choices ?? [];
  const localChoices = local.choices ?? [];
  const issues = rowIssues(rows);
  const update = (i: number, patch: Partial<ValueRow>) =>
    setRows((prev) => prev.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const missing = remoteChoices.filter(
    (c) => !rows.some((r) => r.direction !== 'push' && r.remote.toLowerCase() === c.value.toLowerCase()),
  );

  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={672} purpose="form">
      <Layout
        header={
          <DialogHeader
            title={t('valuesTitle', { local: label(local.label, local.key), remote: remote.label })}
            subtitle={t('valuesDescription', { system })}
            onOpenChange={onOpenChange}
          />
        }
        content={
          <LayoutContent padding={4}>
            <VStack gap={3} className="min-w-0">
              {rows.length > 0 && (
                <div
                  aria-hidden
                  className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_9.5rem_2rem] gap-2 sm:grid"
                >
                  <Text type="supporting">{t('inSystem', { system })}</Text>
                  <Text type="supporting">{t('inIsbp')}</Text>
                  <Text type="supporting">{t('direction')}</Text>
                </div>
              )}
              <VStack as="ol" gap={2} className="min-w-0">
                {rows.map((r, i) => {
                  const rowErrors = issues[i] ?? [];
                  const n = i + 1;
                  const remoteInvalid = rowErrors.some((e) => e.path === 'remote');
                  const localInvalid = rowErrors.some((e) => e.path === 'local');
                  return (
                    <li
                      key={i}
                      className="grid min-w-0 grid-cols-1 items-start gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_9.5rem_2rem]"
                      aria-describedby={rowErrors.length ? `${id}-row-${i}` : undefined}
                    >
                      {remoteChoices.length ? (
                        <ChoiceSelect
                          value={r.remote}
                          choices={remoteChoices}
                          onChange={(v) => update(i, { remote: v })}
                          label={t('remoteValue', { n })}
                          invalid={remoteInvalid}
                          disabled={readOnly}
                          placeholder={t('chooseValue')}
                        />
                      ) : (
                        <TextInput
                          label={t('remoteValue', { n })}
                          isLabelHidden
                          value={r.remote}
                          isDisabled={readOnly}
                          status={remoteInvalid ? { type: 'error' } : undefined}
                          onChange={(v) => update(i, { remote: v })}
                        />
                      )}
                      {localChoices.length ? (
                        <ChoiceSelect
                          value={r.local}
                          choices={localChoices.map((c) => ({
                            value: c.value,
                            label: label(c.label, c.value),
                          }))}
                          onChange={(v) => update(i, { local: v })}
                          label={t('localValue', { n })}
                          invalid={localInvalid}
                          disabled={readOnly}
                          placeholder={t('chooseValue')}
                        />
                      ) : (
                        <TextInput
                          label={t('localValue', { n })}
                          isLabelHidden
                          value={r.local}
                          isDisabled={readOnly}
                          status={localInvalid ? { type: 'error' } : undefined}
                          onChange={(v) => update(i, { local: v })}
                        />
                      )}
                      <Selector
                        label={t('valueDirection', { n })}
                        isLabelHidden
                        isDisabled={readOnly}
                        options={MAPPING_DIRECTIONS.map((d) => ({
                          value: d,
                          label: t(`dir.${d}`, { system }),
                        }))}
                        value={r.direction}
                        onChange={(v) => update(i, { direction: v as MappingDirection })}
                      />
                      <IconButton
                        label={t('removeValue', { n })}
                        variant="ghost"
                        size="sm"
                        icon={<Icon icon={Trash2Icon} />}
                        isDisabled={readOnly}
                        type="button"
                        onClick={() => setRows((prev) => prev.filter((_, k) => k !== i))}
                      />
                      {rowErrors.length > 0 && (
                        <div className="sm:col-span-4">
                          <IssueList id={`${id}-row-${i}`} issues={rowErrors} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </VStack>
              {!readOnly && (
                <HStack gap={2} wrap="wrap">
                  <Button
                    label={t('addValue')}
                    variant="secondary"
                    size="sm"
                    icon={<Icon icon={ListPlusIcon} />}
                    type="button"
                    onClick={() => setRows((prev) => [...prev, { remote: '', local: '', direction: 'both' }])}
                  />
                  {missing.length > 0 && (
                    <Button
                      label={t('addMissing', { count: missing.length, system })}
                      variant="secondary"
                      size="sm"
                      icon={<Icon icon={PlusIcon} />}
                      type="button"
                      onClick={() =>
                        setRows((prev) => [
                          ...prev,
                          ...missing.map((c) => ({
                            remote: c.value,
                            local:
                              localChoices.find((l) => l.value.toLowerCase() === c.value.toLowerCase())
                                ?.value ?? '',
                            direction: 'both' as const,
                          })),
                        ])
                      }
                    />
                  )}
                </HStack>
              )}
              <Text type="supporting">{t('valuesHint')}</Text>
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={2} hAlign="end">
              <Button label={tc('cancel')} variant="ghost" onClick={() => onOpenChange(false)} />
              {!readOnly && (
                <Button
                  label={tc('save')}
                  variant="primary"
                  onClick={() => {
                    onSave(
                      rows
                        .filter((r) => r.remote.trim() && r.local.trim())
                        .map((r) => ({
                          remote: r.remote.trim(),
                          local: r.local.trim(),
                          ...(r.direction !== 'both' ? { direction: r.direction } : {}),
                        })),
                    );
                    onOpenChange(false);
                  }}
                />
              )}
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}

/**
 * The field mapping: ISBP field ↔ remote field, a direction per row (narrowed by the profile's), and value
 * maps for choices. Remote fields of an incompatible type are left out of each row's list.
 */
export function MappingTable({
  mappings,
  onChange,
  localFields,
  remoteFields,
  direction,
  system,
  issues,
  onSuggest,
  suggesting,
  readOnly,
}: {
  mappings: FieldMapping[];
  onChange: (m: FieldMapping[]) => void;
  localFields: LocalField[];
  remoteFields: RemoteField[];
  direction: Direction;
  system: string;
  issues: MappingIssue[];
  onSuggest: () => void;
  suggesting: boolean;
  readOnly: boolean;
}) {
  const t = useTranslations('integrations.mapping');
  const tf = useTranslations('integrations.fieldType');
  const label = useLabel();
  const id = useId();
  const [editingValues, setEditingValues] = useState<number | null>(null);
  const L = new Map(localFields.map((f) => [f.key, f]));
  const R = new Map(remoteFields.map((f) => [f.key, f]));
  const update = (i: number, patch: Partial<FieldMapping>) =>
    onChange(mappings.map((m, k) => (k === i ? { ...m, ...patch } : m)));
  const issuesAt = (i: number) =>
    issues.filter((x) => x.path === `mappings.${i}` || x.path.startsWith(`mappings.${i}.`));
  const allowed = (d: MappingDirection) => direction === 'both' || d === 'both' || d === direction;
  const editing = editingValues !== null ? mappings[editingValues] : undefined;
  const typeNote = (f: { type: string; readOnly?: boolean }) =>
    `${tf(f.type)}${f.readOnly ? ` · ${t('readOnly')}` : ''}`;

  return (
    <VStack gap={3} className="min-w-0">
      <HStack gap={2} wrap="wrap">
        <Button
          label={t('suggest')}
          variant="secondary"
          size="sm"
          icon={<Icon icon={WandSparklesIcon} />}
          isLoading={suggesting}
          isDisabled={readOnly}
          type="button"
          onClick={onSuggest}
        />
        <Button
          label={t('add')}
          variant="secondary"
          size="sm"
          icon={<Icon icon={PlusIcon} />}
          isDisabled={readOnly}
          type="button"
          onClick={() => onChange([...mappings, { local: '', remote: '', direction: 'both' }])}
        />
      </HStack>
      {mappings.length === 0 ? (
        <VStack gap={2} padding={4} className="items-center text-center">
          <Icon icon={Rows3Icon} color="secondary" />
          <Text color="secondary">{t('empty')}</Text>
        </VStack>
      ) : (
        <VStack as="ol" gap={2} className="min-w-0">
          <li
            aria-hidden
            className="hidden grid-cols-[minmax(0,1fr)_13rem_minmax(0,1fr)_8.5rem] gap-2 sm:grid"
          >
            <Text type="supporting">{t('inIsbp')}</Text>
            <Text type="supporting">{t('direction')}</Text>
            <Text type="supporting">{t('inRemoteHeader', { system })}</Text>
            <span />
          </li>
          {mappings.map((m, i) => {
            const lf = L.get(m.local);
            const rf = R.get(m.remote);
            const rowIssues = issuesAt(i);
            const choice = lf?.type === 'choice' || rf?.type === 'choice';
            return (
              <li
                key={i}
                className="min-w-0"
                aria-describedby={rowIssues.length ? `${id}-issues-${i}` : undefined}
              >
                <VStack gap={2} className="min-w-0">
                  {i > 0 && <Divider />}
                  <div className="grid min-w-0 grid-cols-1 items-start gap-2 sm:grid-cols-[minmax(0,1fr)_13rem_minmax(0,1fr)_8.5rem]">
                    <Text type="supporting" className="sm:hidden" aria-hidden>
                      {t('inIsbp')}
                    </Text>
                    <Selector
                      label={t('localField', { n: i + 1 })}
                      isLabelHidden
                      hasSearch
                      placeholder={t('chooseLocal')}
                      isDisabled={readOnly}
                      options={localFields.map((f) => ({
                        value: f.key,
                        label: label(f.label, f.key),
                        description: typeNote(f),
                      }))}
                      value={m.local}
                      onChange={(v) => update(i, { local: v })}
                      status={
                        rowIssues.some((x) => x.path.endsWith('.local')) ? { type: 'error' } : undefined
                      }
                    />
                    <Text type="supporting" className="sm:hidden" aria-hidden>
                      {t('direction')}
                    </Text>
                    <Selector
                      label={t('directionOf', { n: i + 1 })}
                      isLabelHidden
                      isDisabled={readOnly}
                      startIcon={DIRECTION_ICON[m.direction === 'both' ? 'both' : m.direction]}
                      options={MAPPING_DIRECTIONS.map((d) => ({
                        value: d,
                        label: t(`dir.${d}`, { system }),
                        disabled: !allowed(d),
                      }))}
                      value={m.direction}
                      onChange={(v) => update(i, { direction: v as MappingDirection })}
                    />
                    <Text type="supporting" className="sm:hidden" aria-hidden>
                      {t('inRemoteHeader', { system })}
                    </Text>
                    <Selector
                      label={t('remoteField', { n: i + 1, system })}
                      isLabelHidden
                      hasSearch
                      placeholder={t('chooseRemote')}
                      isDisabled={readOnly}
                      options={remoteFields
                        .filter((f) => !lf || isCompatible(lf.type, f.type) || f.key === m.remote)
                        .map((f) => ({ value: f.key, label: f.label, description: typeNote(f) }))}
                      value={m.remote}
                      onChange={(v) => update(i, { remote: v })}
                      status={
                        rowIssues.some((x) => x.path.endsWith('.remote')) ? { type: 'error' } : undefined
                      }
                    />
                    <HStack gap={1} hAlign="end" vAlign="center">
                      {choice && lf && rf && (
                        <Button
                          label={t('values')}
                          variant="secondary"
                          size="sm"
                          type="button"
                          endContent={
                            m.values?.length ? <Badge variant="neutral" label={m.values.length} /> : undefined
                          }
                          onClick={() => setEditingValues(i)}
                        />
                      )}
                      <IconButton
                        label={t('remove', { n: i + 1 })}
                        variant="ghost"
                        size="sm"
                        icon={<Icon icon={Trash2Icon} />}
                        isDisabled={readOnly}
                        type="button"
                        onClick={() => onChange(mappings.filter((_, k) => k !== i))}
                      />
                    </HStack>
                  </div>
                  {rowIssues.length > 0 && <IssueList id={`${id}-issues-${i}`} issues={rowIssues} />}
                </VStack>
              </li>
            );
          })}
        </VStack>
      )}
      {editing && editingValues !== null && L.get(editing.local) && R.get(editing.remote) && (
        <ValueMapDialog
          key={editingValues}
          open
          onOpenChange={(open) => !open && setEditingValues(null)}
          mapping={editing}
          local={L.get(editing.local)!}
          remote={R.get(editing.remote)!}
          system={system}
          readOnly={readOnly}
          onSave={(values) => update(editingValues, { values: values.length ? values : undefined })}
        />
      )}
    </VStack>
  );
}
