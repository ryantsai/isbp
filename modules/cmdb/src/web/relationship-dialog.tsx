'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, Layout, LayoutContent, LayoutFooter, VStack } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { ApiError } from '@isbp/sdk/web';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import { ArrowRightIcon, InfoIcon, ZapIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useId, useState } from 'react';
import {
  type CiRef,
  type CreateRelationshipInput,
  IMPACT_FROM_SOURCE,
  IMPACT_FROM_TARGET,
  type RelationDirection,
  type Relationship,
  RELATIONSHIP_TYPES,
  type RelationshipType,
} from '../contracts';
import { CiPicker } from './ci-picker';
import { ClassIcon } from './class-icon';
import { INVALIDATE } from './data';

type Choice = `${RelationshipType}:${RelationDirection}`;
const PROPAGATING = new Set<RelationshipType>([...IMPACT_FROM_TARGET, ...IMPACT_FROM_SOURCE]);

function CiChip({ ci }: { ci: Pick<CiRef, 'name' | 'reference' | 'class'> }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-sm">
      <ClassIcon name={ci.class.icon} className="size-3.5 shrink-0 text-primary" />
      <span className="truncate font-medium">{ci.name}</span>
    </span>
  );
}

/** Relate this CI to another one, choosing the link from this CI's point of view. */
export function RelationshipDialog({
  ci,
  open,
  onOpenChange,
}: {
  ci: CiRef;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('cmdb');
  // The form (and its header) mounts after the dialog opens, so name the dialog here: Astryx reads the title at mount.
  return (
    <Dialog
      isOpen={open}
      onOpenChange={onOpenChange}
      width={512}
      purpose="form"
      aria-label={t('rel.dialogTitle')}
    >
      {/* Mounted per opening, so every opening starts from a clean form. */}
      {open && <RelationshipForm ci={ci} onDone={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function RelationshipForm({ ci, onDone }: { ci: CiRef; onDone: () => void }) {
  const t = useTranslations('cmdb');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const formId = useId();
  const [choice, setChoice] = useState<Choice>('depends_on:outgoing');
  const [other, setOther] = useState<CiRef | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const [type, direction] = choice.split(':') as [RelationshipType, RelationDirection];
  const label = (rt: RelationshipType, d: RelationDirection) =>
    t(`relationships.${rt}.${d === 'outgoing' ? 'forward' : 'reverse'}`);

  const add = useApiMutation(
    (api, body: CreateRelationshipInput) => api.post<Relationship>('/cmdb/relationships', body),
    {
      invalidate: INVALIDATE,
      success: t('rel.added'),
      onSuccess: onDone,
      silent: true,
    },
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (!other) return;
    const body: CreateRelationshipInput =
      direction === 'outgoing'
        ? { sourceId: ci.id, targetId: other.id, type, note: note.trim() || null }
        : { sourceId: other.id, targetId: ci.id, type, note: note.trim() || null };
    try {
      await add.mutateAsync(body);
    } catch (err) {
      const reason =
        err instanceof ApiError ? (err.details as { reason?: string } | undefined)?.reason : null;
      setError(
        err instanceof ApiError &&
          err.code === 'RELATIONSHIP_INVALID' &&
          reason &&
          t.has(`rel.errors.${reason}`)
          ? t(`rel.errors.${reason}` as 'rel.errors.self')
          : errorText(err),
      );
    }
  };

  const missing = touched && !other;

  return (
    <Layout
      header={
        <DialogHeader
          title={t('rel.dialogTitle')}
          subtitle={t('rel.dialogDescription', { name: ci.name })}
          onOpenChange={(o) => !o && onDone()}
        />
      }
      content={
        <LayoutContent padding={4}>
          <form id={formId} onSubmit={submit} noValidate>
            <FormLayout defaultOptionality="optional">
              <Selector
                label={t('rel.type')}
                value={choice}
                onChange={(v) => setChoice(v as Choice)}
                options={RELATIONSHIP_TYPES.flatMap((rt, i) => [
                  ...(i > 0 ? [{ type: 'divider' as const }] : []),
                  ...(['outgoing', 'incoming'] as const).map((d) => ({
                    value: `${rt}:${d}`,
                    label: label(rt, d),
                  })),
                ])}
              />
              <CiPicker
                label={t('rel.other')}
                isRequired
                value={other}
                onChange={(c) => {
                  setOther(c);
                  setError(null);
                }}
                excludeId={ci.id}
                status={missing ? { type: 'error', message: t('rel.otherPlaceholder') } : undefined}
              />
              <TextArea
                label={t('rel.note')}
                rows={2}
                maxLength={500}
                value={note}
                placeholder={t('rel.notePlaceholder')}
                onChange={(value) => setNote(value.slice(0, 500))}
              />

              <VStack gap={2} className="rounded-lg border bg-muted/40 p-3">
                <Text type="label">{t('rel.preview')}</Text>
                <HStack gap={2} wrap="wrap" vAlign="center" className="min-w-0">
                  <CiChip ci={ci} />
                  <HStack as="span" gap={1} vAlign="center">
                    <Text color="secondary">{label(type, direction)}</Text>
                    <Icon icon={ArrowRightIcon} size="sm" color="secondary" />
                  </HStack>
                  {other ? (
                    <CiChip ci={other} />
                  ) : (
                    <span className="rounded-md border border-dashed px-2 py-1 text-sm text-muted-foreground">
                      {t('rel.other')}
                    </span>
                  )}
                </HStack>
                <HStack gap={1.5} vAlign="start">
                  <Icon icon={PROPAGATING.has(type) ? ZapIcon : InfoIcon} size="sm" color="secondary" />
                  <Text type="supporting">
                    {PROPAGATING.has(type) ? t('rel.propagates') : t('rel.noPropagation')}
                  </Text>
                </HStack>
              </VStack>

              {error && <Banner status="error" title={error} collapsible={false} />}
            </FormLayout>
          </form>
        </LayoutContent>
      }
      footer={
        <LayoutFooter hasDivider padding={3}>
          <HStack gap={2} hAlign="end">
            <Button label={tc('cancel')} variant="ghost" type="button" onClick={onDone} />
            <Button
              label={tc('add')}
              variant="primary"
              isLoading={add.isPending}
              type="submit"
              form={formId}
            />
          </HStack>
        </LayoutFooter>
      }
    />
  );
}
