'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { DateInput } from '@astryxdesign/core/DateInput';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { HStack, Layout, LayoutContent, LayoutFooter, VStack } from '@astryxdesign/core/Layout';
import { Icon } from '@astryxdesign/core/Icon';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { useCan } from '@isbp/sdk/web';
import { EmptyState } from '@isbp/ui/empty-state';
import { type PersonOption, PersonPicker } from '@isbp/ui/person-picker';
import { useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { BanIcon, ShieldCheckIcon, ShieldQuestionIcon, UserPlusIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { addDays, type Unmanaged } from '../contracts';
import { EngineLabel, RiskBadge } from './badges';
import { ReasonDialog } from './dialogs';
import { asDay, INVALIDATE, useLocalized, useToday } from './lib';

const keyOf = (u: Unmanaged) => `${u.server.id}|${u.role.id}|${u.memberName}`;

/**
 * Memberships of requestable roles that no grant explains, with the DBA's two ways out: adopt (a grant
 * for the right person, with an end date) or revoke (through the worker).
 */
export function UnmanagedList({ serverId }: { serverId?: string }) {
  const t = useTranslations('dbaccess.unmanaged');
  const l = useLocalized();
  const canManage = useCan('dbaccess.grants.manage');
  const [adopting, setAdopting] = useState<Unmanaged | null>(null);
  const [revoking, setRevoking] = useState<Unmanaged | null>(null);
  const { data, isLoading } = useApiQuery<{ items: Unmanaged[] }>('/dbaccess/unmanaged', { serverId });
  const revoke = useApiMutation(
    (api, v: { item: Unmanaged; reason: string }) =>
      api.post('/dbaccess/unmanaged/revoke', {
        serverId: v.item.server.id,
        roleId: v.item.role.id,
        memberName: v.item.memberName,
        reason: v.reason,
      }),
    { invalidate: INVALIDATE, success: t('revokeStarted') },
  );

  if (isLoading) return <Skeleton className="h-40 w-full rounded-xl" />;
  const items = data?.items ?? [];
  if (!items.length)
    return (
      <div className="rounded-xl border bg-card">
        <EmptyState icon={<ShieldCheckIcon />} title={t('empty')} description={t('emptyHint')} />
      </div>
    );
  return (
    <>
      <ul className="divide-y rounded-xl border bg-card" aria-label={t('title')}>
        {items.map((u) => (
          <li key={keyOf(u)} className="flex min-w-0 flex-col gap-3 px-4 py-3 md:flex-row md:items-center">
            <Icon icon={ShieldQuestionIcon} color="warning" className="hidden shrink-0 md:block" />
            <VStack gap={1} className="min-w-0 flex-1">
              <HStack gap={2} wrap="wrap" vAlign="center" className="min-w-0">
                <Text type="code" weight="medium" maxLines={1}>
                  {u.memberName}
                </Text>
                <Text color="secondary">{t('memberOf')}</Text>
                <Text weight="medium" maxLines={1}>
                  {l(u.role.name)}
                </Text>
                <RiskBadge risk={u.role.risk} />
              </HStack>
              <HStack gap={3} wrap="wrap" vAlign="center" className="min-w-0">
                <Text type="supporting" maxLines={1}>
                  {u.server.displayName}
                </Text>
                <EngineLabel engine={u.server.engine} />
                <Text type="code" color="secondary">
                  {u.database ? `${u.database}.` : ''}
                  {u.role.roleName}
                </Text>
                {u.suggested && (
                  <Text type="supporting">{t('looksLike', { name: u.suggested.displayName })}</Text>
                )}
                {u.syncedAt && (
                  <Text type="supporting">
                    {t('seen')} <RelativeTime date={u.syncedAt} />
                  </Text>
                )}
              </HStack>
            </VStack>
            {canManage && (
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button
                  label={t('adopt')}
                  variant="secondary"
                  size="sm"
                  icon={<Icon icon={UserPlusIcon} />}
                  onClick={() => setAdopting(u)}
                />
                <Button
                  label={t('revoke')}
                  variant="ghost"
                  size="sm"
                  icon={<Icon icon={BanIcon} />}
                  onClick={() => setRevoking(u)}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
      <AdoptDialog item={adopting} onClose={() => setAdopting(null)} />
      <ReasonDialog
        open={Boolean(revoking)}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={t('revokeTitle', { account: revoking?.memberName ?? '' })}
        description={t('revokeDescription')}
        confirmLabel={t('revoke')}
        pending={revoke.isPending}
        onConfirm={(reason) => revoke.mutateAsync({ item: revoking!, reason })}
      />
    </>
  );
}

function AdoptDialog({ item, onClose }: { item: Unmanaged | null; onClose: () => void }) {
  const t = useTranslations('dbaccess.unmanaged');
  // The form (and its header) mounts after the dialog opens, so name the dialog here: Astryx reads the title at mount.
  return (
    <Dialog
      isOpen={Boolean(item)}
      onOpenChange={(o) => !o && onClose()}
      width={512}
      purpose="form"
      aria-label={item ? t('adoptTitle', { account: item.memberName }) : undefined}
    >
      {item && <AdoptForm key={keyOf(item)} item={item} onDone={onClose} />}
    </Dialog>
  );
}

function AdoptForm({ item, onDone }: { item: Unmanaged; onDone: () => void }) {
  const t = useTranslations('dbaccess.unmanaged');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const today = useToday();
  const formId = useId();
  const personId = useId();
  const [person, setPerson] = useState<PersonOption | null>(item.suggested);
  const [until, setUntil] = useState(addDays(today, 30));
  const [note, setNote] = useState('');
  const adopt = useApiMutation(
    (api) =>
      api.post('/dbaccess/unmanaged/adopt', {
        serverId: item.server.id,
        roleId: item.role.id,
        memberName: item.memberName,
        userId: person!.id,
        expiresOn: until || null,
        note: note.trim() || null,
      }),
    { invalidate: INVALIDATE, success: t('adopted'), silent: true, onSuccess: onDone },
  );
  return (
    <Layout
      header={
        <DialogHeader
          title={t('adoptTitle', { account: item.memberName })}
          subtitle={t('adoptDescription')}
          onOpenChange={(o) => !o && onDone()}
        />
      }
      content={
        <LayoutContent padding={4}>
          <form
            id={formId}
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (person) adopt.mutate(undefined);
            }}
          >
            <FormLayout defaultOptionality="optional">
              <Field label={t('person')} inputID={personId} isRequired>
                <PersonPicker id={personId} value={person} onChange={setPerson} />
              </Field>
              <DateInput
                label={t('until')}
                hasClear
                width={208}
                min={asDay(addDays(today, 1))}
                value={asDay(until)}
                description={t('untilHint')}
                onChange={(d) => setUntil(d ?? '')}
              />
              <TextArea
                label={t('note')}
                isOptional
                rows={2}
                maxLength={1_000}
                value={note}
                onChange={(value) => setNote(value.slice(0, 1_000))}
              />
              {adopt.error && <Banner status="error" title={errorText(adopt.error)} collapsible={false} />}
            </FormLayout>
          </form>
        </LayoutContent>
      }
      footer={
        <LayoutFooter hasDivider padding={3}>
          <HStack gap={2} hAlign="end">
            <Button label={tc('cancel')} variant="ghost" type="button" onClick={onDone} />
            <Button
              label={t('adopt')}
              variant="primary"
              icon={<Icon icon={UserPlusIcon} />}
              isLoading={adopt.isPending}
              isDisabled={!person}
              type="submit"
              form={formId}
            />
          </HStack>
        </LayoutFooter>
      }
    />
  );
}
