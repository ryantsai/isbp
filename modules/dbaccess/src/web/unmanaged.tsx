'use client';

import { useCan } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@isbp/ui/dialog';
import { EmptyState } from '@isbp/ui/empty-state';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { type PersonOption, PersonPicker } from '@isbp/ui/person-picker';
import { useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { Textarea } from '@isbp/ui/textarea';
import { BanIcon, ShieldCheckIcon, ShieldQuestionIcon, UserPlusIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { addDays, type Unmanaged } from '../contracts';
import { EngineLabel, RiskBadge } from './badges';
import { ReasonDialog } from './dialogs';
import { INVALIDATE, useLocalized, useToday } from './lib';

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
      <div className="rounded-xl border bg-card shadow-xs">
        <EmptyState icon={<ShieldCheckIcon />} title={t('empty')} description={t('emptyHint')} />
      </div>
    );
  return (
    <>
      <ul className="divide-y rounded-xl border bg-card shadow-xs" aria-label={t('title')}>
        {items.map((u) => (
          <li key={keyOf(u)} className="flex min-w-0 flex-col gap-3 px-4 py-3 md:flex-row md:items-center">
            <ShieldQuestionIcon
              className="hidden size-5 shrink-0 text-warning-foreground md:block"
              aria-hidden
            />
            <div className="grid min-w-0 flex-1 gap-1">
              <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="truncate font-mono text-sm font-medium">{u.memberName}</span>
                <span className="text-sm text-muted-foreground">{t('memberOf')}</span>
                <span className="truncate text-sm font-medium">{l(u.role.name)}</span>
                <RiskBadge risk={u.role.risk} />
              </p>
              <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="truncate">{u.server.displayName}</span>
                <EngineLabel engine={u.server.engine} />
                <span className="font-mono">
                  {u.database ? `${u.database}.` : ''}
                  {u.role.roleName}
                </span>
                {u.suggested && <span>{t('looksLike', { name: u.suggested.displayName })}</span>}
                {u.syncedAt && (
                  <span>
                    {t('seen')} <RelativeTime date={u.syncedAt} />
                  </span>
                )}
              </p>
            </div>
            {canManage && (
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setAdopting(u)}>
                  <UserPlusIcon /> {t('adopt')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRevoking(u)}>
                  <BanIcon /> {t('revoke')}
                </Button>
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
  const tc = useTranslations('common');
  return (
    <Dialog open={Boolean(item)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg" closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('adoptTitle', { account: item?.memberName ?? '' })}</DialogTitle>
          <DialogDescription>{t('adoptDescription')}</DialogDescription>
        </DialogHeader>
        {item && <AdoptForm key={keyOf(item)} item={item} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function AdoptForm({ item, onDone }: { item: Unmanaged; onDone: () => void }) {
  const t = useTranslations('dbaccess.unmanaged');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const today = useToday();
  const ids = { person: useId(), until: useId(), note: useId() };
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
    <form
      className="grid gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (person) adopt.mutate(undefined);
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor={ids.person}>{t('person')}</Label>
        <PersonPicker id={ids.person} value={person} onChange={setPerson} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={ids.until}>{t('until')}</Label>
        <Input
          id={ids.until}
          type="date"
          className="w-44"
          min={addDays(today, 1)}
          value={until}
          onChange={(e) => setUntil(e.target.value)}
          aria-describedby={`${ids.until}-hint`}
        />
        <p id={`${ids.until}-hint`} className="text-xs text-muted-foreground">
          {t('untilHint')}
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={ids.note}>
          {t('note')} <span className="font-normal text-muted-foreground">({tc('optional')})</span>
        </Label>
        <Textarea
          id={ids.note}
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1_000}
        />
      </div>
      {adopt.error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errorText(adopt.error)}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {tc('cancel')}
        </Button>
        <Button type="submit" disabled={!person} loading={adopt.isPending}>
          <UserPlusIcon /> {t('adopt')}
        </Button>
      </DialogFooter>
    </form>
  );
}
