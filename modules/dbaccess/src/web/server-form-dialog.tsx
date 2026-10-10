'use client';

import { usePlatform } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@isbp/ui/dialog';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import { useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Switch } from '@isbp/ui/switch';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import {
  accountNameFor,
  type AuthMode,
  authModesFor,
  type ConnectionInfo,
  type CreateServerInput,
  ENVIRONMENTS,
  type GroupOption,
  isManagedEngine,
  PASSWORD_LENGTH,
  patternProblem,
  type Server,
} from '../contracts';
import { INVALIDATE } from './lib';

const NONE = '__none__';
const DEFAULT_PATTERN = '{username}';

type Target = { kind: 'create'; connection: ConnectionInfo } | { kind: 'edit'; server: Server };

/** Manage accounts on an admin connection (create), or change a server's settings (edit). */
export function ServerFormDialog({
  target,
  onClose,
  onSaved,
}: {
  target: Target | null;
  onClose: () => void;
  onSaved?: (s: Server) => void;
}) {
  const t = useTranslations('dbaccess.serverForm');
  const tc = useTranslations('common');
  return (
    <Dialog open={Boolean(target)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl" closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>
            {target?.kind === 'edit' ? t('editTitle', { name: target.server.displayName }) : t('createTitle')}
          </DialogTitle>
          <DialogDescription>
            {target?.kind === 'create'
              ? t('createDescription', { connection: target.connection.name })
              : t('editDescription')}
          </DialogDescription>
        </DialogHeader>
        {target && (
          <ServerForm
            key={target.kind === 'edit' ? target.server.id : target.connection.id}
            target={target}
            onCancel={onClose}
            onSaved={(s) => {
              onClose();
              onSaved?.(s);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ServerForm({
  target,
  onCancel,
  onSaved,
}: {
  target: Target;
  onCancel: () => void;
  onSaved: (s: Server) => void;
}) {
  const t = useTranslations('dbaccess.serverForm');
  const te = useTranslations('dbaccess.environment');
  const ta = useTranslations('dbaccess.authMode');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const { user } = usePlatform();
  const list = useFieldList();
  const ids = {
    name: useId(),
    env: useId(),
    pattern: useId(),
    auth: useId(),
    domain: useId(),
    length: useId(),
    sync: useId(),
    group: useId(),
  };
  const engine = target.kind === 'edit' ? target.server.engine : target.connection.engine;
  const managed = isManagedEngine(engine) ? engine : 'postgres';
  const s = target.kind === 'edit' ? target.server : null;
  const [v, setV] = useState({
    displayName: s?.displayName ?? (target.kind === 'create' ? target.connection.name : ''),
    environment: s?.environment ?? 'production',
    accountPattern: s?.accountPattern ?? DEFAULT_PATTERN,
    authMode: (s?.authMode ?? 'password') as AuthMode,
    windowsDomain: s?.windowsDomain ?? '',
    passwordLength: s?.passwordLength ?? PASSWORD_LENGTH.default,
    autoSync: s?.autoSync ?? true,
    ownerGroupId: s?.ownerGroup?.id ?? null,
  });
  const [error, setError] = useState<string | null>(null);
  const groups = useApiQuery<{ items: GroupOption[] }>('/dbaccess/lookups/groups');
  const save = useApiMutation(
    (api, body: CreateServerInput) =>
      target.kind === 'edit'
        ? api.patch<Server>(`/dbaccess/servers/${target.server.id}`, body)
        : api.post<Server>('/dbaccess/servers', body),
    { invalidate: INVALIDATE, success: t('saved'), silent: true, onSuccess: onSaved },
  );
  const patch = (p: Partial<typeof v>) => setV((x) => ({ ...x, ...p }));
  const preview = accountNameFor(v.accountPattern, { username: user.username, email: user.email }, managed);
  const problem = patternProblem(v.accountPattern);
  const detailsFilled = countFilled(
    v.accountPattern !== DEFAULT_PATTERN,
    v.authMode === 'password' && v.passwordLength !== PASSWORD_LENGTH.default,
    !v.autoSync,
  );

  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!v.displayName.trim()) return setError(t('nameRequired'));
        if (problem) return setError(t(`pattern.${problem}`));
        if (v.authMode === 'windows' && !v.windowsDomain.trim()) return setError(t('domainRequired'));
        setError(null);
        save.mutate(
          {
            ...(target.kind === 'create' ? { connectionId: target.connection.id } : {}),
            displayName: v.displayName.trim(),
            environment: v.environment,
            accountPattern: v.accountPattern.trim(),
            authMode: v.authMode,
            windowsDomain: v.authMode === 'windows' ? v.windowsDomain.trim().toUpperCase() : null,
            passwordLength: v.passwordLength,
            autoSync: v.autoSync,
            ownerGroupId: v.ownerGroupId,
          } as CreateServerInput,
          { onError: (err) => setError(errorText(err)) },
        );
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="grid min-w-0 gap-2">
          <Label htmlFor={ids.name}>{t('displayName')}</Label>
          <Input
            id={ids.name}
            value={v.displayName}
            maxLength={120}
            onChange={(e) => patch({ displayName: e.target.value })}
          />
        </div>
        <div className="grid min-w-0 gap-2">
          <Label htmlFor={ids.env}>{t('environment')}</Label>
          <Select
            value={v.environment}
            onValueChange={(x) => patch({ environment: x as typeof v.environment })}
          >
            <SelectTrigger id={ids.env} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ENVIRONMENTS.map((x) => (
                <SelectItem key={x} value={x}>
                  {te(x)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="grid min-w-0 gap-2">
          <Label htmlFor={ids.auth}>{t('authMode')}</Label>
          <Select value={v.authMode} onValueChange={(x) => patch({ authMode: x as AuthMode })}>
            <SelectTrigger id={ids.auth} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {authModesFor(managed).map((x) => (
                <SelectItem key={x} value={x}>
                  {ta(x)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {v.authMode === 'windows' ? (
          <div className="grid min-w-0 gap-2">
            <Label htmlFor={ids.domain}>{t('domain')}</Label>
            <Input
              id={ids.domain}
              className="font-mono uppercase"
              value={v.windowsDomain}
              maxLength={15}
              placeholder="CONTOSO"
              onChange={(e) => patch({ windowsDomain: e.target.value })}
            />
          </div>
        ) : v.authMode === 'password' ? null : (
          <p className="self-end text-xs text-muted-foreground">{t('externalHint')}</p>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="grid min-w-0 gap-2">
          <Label htmlFor={ids.group}>{t('ownerGroup')}</Label>
          <Select
            value={v.ownerGroupId ?? NONE}
            onValueChange={(x) => patch({ ownerGroupId: x === NONE ? null : x })}
          >
            <SelectTrigger id={ids.group} className="w-full" aria-describedby={`${ids.group}-hint`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('noGroup')}</SelectItem>
              {(groups.data?.items ?? []).map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p id={`${ids.group}-hint`} className="text-xs text-muted-foreground">
            {t('ownerGroupHint')}
          </p>
        </div>
      </div>
      <OptionalFields
        hint={list([t('pattern.label'), t('passwordLength'), t('autoSync')])}
        filled={detailsFilled}
        contentClassName="grid gap-4 pt-3 sm:grid-cols-2"
      >
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor={ids.pattern}>{t('pattern.label')}</Label>
          <Input
            id={ids.pattern}
            className="font-mono"
            value={v.accountPattern}
            maxLength={60}
            aria-invalid={Boolean(problem) || undefined}
            aria-describedby={`${ids.pattern}-hint`}
            onChange={(e) => patch({ accountPattern: e.target.value })}
          />
          <p id={`${ids.pattern}-hint`} className="text-xs text-muted-foreground">
            {problem ? t(`pattern.${problem}`) : t('pattern.preview', { name: preview ?? '—' })}
          </p>
        </div>
        {v.authMode === 'password' && (
          <div className="grid min-w-0 gap-2">
            <Label htmlFor={ids.length}>{t('passwordLength')}</Label>
            <Input
              id={ids.length}
              type="number"
              min={PASSWORD_LENGTH.min}
              max={PASSWORD_LENGTH.max}
              value={v.passwordLength}
              aria-describedby={`${ids.length}-hint`}
              onChange={(e) => patch({ passwordLength: Number(e.target.value) || PASSWORD_LENGTH.default })}
            />
            <p id={`${ids.length}-hint`} className="text-xs text-muted-foreground">
              {t('passwordHint', { min: PASSWORD_LENGTH.min, max: PASSWORD_LENGTH.max })}
            </p>
          </div>
        )}
        <div className="flex items-center gap-3 self-center">
          <Switch id={ids.sync} checked={v.autoSync} onCheckedChange={(x) => patch({ autoSync: x })} />
          <Label htmlFor={ids.sync} className="font-normal">
            {t('autoSync')}
          </Label>
        </div>
      </OptionalFields>
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {tc('cancel')}
        </Button>
        <Button type="submit" loading={save.isPending}>
          {target.kind === 'edit' ? tc('saveChanges') : t('create')}
        </Button>
      </DialogFooter>
    </form>
  );
}
