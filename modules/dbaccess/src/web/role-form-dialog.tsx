'use client';

import type { LocalizedText } from '@isbp/sdk';
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
import { LocalizedInput } from '@isbp/ui/localized-input';
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import { type PersonOption, PersonPicker } from '@isbp/ui/person-picker';
import { useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Switch } from '@isbp/ui/switch';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import {
  type CreateRoleInput,
  durationPolicyProblem,
  type GroupOption,
  type Inventory,
  type RequestableRole,
  type Risk,
  RISKS,
  type Server,
} from '../contracts';
import { INVALIDATE } from './lib';

const SERVER_LEVEL = '__server__';
const DEFAULT_DAYS = 30;
const DEFAULT_MAX_DAYS = 90;

type Target = { kind: 'create'; server: Server } | { kind: 'edit'; server: Server; role: RequestableRole };

/** Make an inventory role requestable (create), or change one (edit): owner, risk and durations. */
export function RoleFormDialog({ target, onClose }: { target: Target | null; onClose: () => void }) {
  const t = useTranslations('dbaccess.roleForm');
  const tc = useTranslations('common');
  return (
    <Dialog open={Boolean(target)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>
            {target?.kind === 'edit' ? t('editTitle', { role: target.role.roleName }) : t('createTitle')}
          </DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        {target && (
          <RoleForm key={target.kind === 'edit' ? target.role.id : 'new'} target={target} onDone={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RoleForm({ target, onDone }: { target: Target; onDone: () => void }) {
  const t = useTranslations('dbaccess.roleForm');
  const tr = useTranslations('dbaccess.risk');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const list = useFieldList();
  const ids = {
    db: useId(),
    role: useId(),
    name: useId(),
    desc: useId(),
    ownerKind: useId(),
    owner: useId(),
    risk: useId(),
    def: useId(),
    max: useId(),
    perm: useId(),
    just: useId(),
    active: useId(),
  };
  const role = target.kind === 'edit' ? target.role : null;
  const mssql = target.server.engine === 'mssql';
  const inventory = useApiQuery<Inventory>(
    target.kind === 'create' ? `/dbaccess/servers/${target.server.id}/inventory` : null,
  );
  const groups = useApiQuery<{ items: GroupOption[] }>('/dbaccess/lookups/groups');
  const [v, setV] = useState({
    database: role?.database ?? null,
    roleName: role?.roleName ?? '',
    name: (role?.name ?? {}) as LocalizedText,
    description: (role?.description ?? null) as LocalizedText | null,
    ownerKind: (role?.owner?.kind ?? 'group') as 'user' | 'group',
    owner: (role?.owner?.kind === 'user'
      ? { id: role.owner.id, displayName: role.owner.name }
      : null) as PersonOption | null,
    ownerGroupId: role?.owner?.kind === 'group' ? role.owner.id : null,
    risk: (role?.risk ?? 'medium') as Risk,
    defaultDays: role ? role.defaultDays : DEFAULT_DAYS,
    maxDays: role ? role.maxDays : DEFAULT_MAX_DAYS,
    allowPermanent: role?.allowPermanent ?? false,
    justificationRequired: role?.justificationRequired ?? true,
    active: role?.active ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const patch = (p: Partial<typeof v>) => setV((x) => ({ ...x, ...p }));
  const detailsFilled = countFilled(
    v.defaultDays !== DEFAULT_DAYS,
    v.maxDays !== DEFAULT_MAX_DAYS,
    v.allowPermanent,
    !v.justificationRequired,
  );
  const save = useApiMutation(
    (api, body: Partial<CreateRoleInput>) =>
      target.kind === 'edit'
        ? api.patch<RequestableRole>(`/dbaccess/roles/${target.role.id}`, body)
        : api.post<RequestableRole>(`/dbaccess/servers/${target.server.id}/roles`, body),
    { invalidate: INVALIDATE, success: t('saved'), silent: true, onSuccess: onDone },
  );
  const databases = inventory.data?.databases ?? [];
  const candidates = (inventory.data?.roles ?? []).filter(
    (r) => (r.database ?? null) === (v.database ?? null) && !r.requestableRoleId,
  );
  const num = (s: string) => (s.trim() === '' ? null : Math.max(1, Math.floor(Number(s)) || 1));

  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!role && !v.roleName) return setError(t('roleRequired'));
        if (!Object.values(v.name).some(Boolean)) return setError(t('nameRequired'));
        const ownerUserId = v.ownerKind === 'user' ? (v.owner?.id ?? null) : null;
        const ownerGroupId = v.ownerKind === 'group' ? v.ownerGroupId : null;
        if (!ownerUserId && !ownerGroupId) return setError(t('ownerRequired'));
        const problem = durationPolicyProblem(v);
        if (problem) {
          setMoreOpen(true);
          return setError(t(`problems.${problem}`));
        }
        setError(null);
        const common = {
          name: v.name,
          description: v.description && Object.values(v.description).some(Boolean) ? v.description : null,
          ownerUserId,
          ownerGroupId,
          risk: v.risk,
          defaultDays: v.defaultDays,
          maxDays: v.maxDays,
          allowPermanent: v.allowPermanent,
          justificationRequired: v.justificationRequired,
          active: v.active,
        };
        save.mutate(role ? common : { ...common, database: v.database, roleName: v.roleName }, {
          onError: (err) => setError(errorText(err)),
        });
      }}
    >
      {role ? (
        <p className="rounded-md bg-muted/50 px-3 py-2 font-mono text-sm">
          {role.database ? `${role.database}.` : ''}
          {role.roleName}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {mssql && (
            <div className="grid min-w-0 gap-2">
              <Label htmlFor={ids.db}>{t('database')}</Label>
              <Select
                value={v.database ?? SERVER_LEVEL}
                onValueChange={(x) => patch({ database: x === SERVER_LEVEL ? null : x, roleName: '' })}
              >
                <SelectTrigger id={ids.db} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SERVER_LEVEL}>{t('serverLevel')}</SelectItem>
                  {databases.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid min-w-0 gap-2">
            <Label htmlFor={ids.role}>{t('role')}</Label>
            <Select
              value={v.roleName || undefined}
              onValueChange={(x) =>
                patch({ roleName: x, name: Object.values(v.name).some(Boolean) ? v.name : { en: x } })
              }
            >
              <SelectTrigger id={ids.role} className="w-full font-mono" aria-describedby={`${ids.role}-hint`}>
                <SelectValue placeholder={t('rolePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((r) => (
                  <SelectItem key={r.name} value={r.name} className="font-mono">
                    {r.name} ({t('members', { count: r.members })})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p id={`${ids.role}-hint`} className="text-xs text-muted-foreground">
              {t('roleHint')}
            </p>
          </div>
        </div>
      )}
      <div className="grid gap-2">
        <Label htmlFor={ids.name}>{t('name')}</Label>
        <LocalizedInput id={ids.name} value={v.name} onChange={(name) => patch({ name })} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={ids.desc}>
          {t('roleDescription')} <span className="font-normal text-muted-foreground">({tc('optional')})</span>
        </Label>
        <LocalizedInput
          id={ids.desc}
          multiline
          value={v.description}
          onChange={(description) => patch({ description })}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="grid min-w-0 gap-2">
          <Label htmlFor={ids.ownerKind}>{t('ownerKind')}</Label>
          <Select value={v.ownerKind} onValueChange={(x) => patch({ ownerKind: x as 'user' | 'group' })}>
            <SelectTrigger id={ids.ownerKind} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="group">{t('ownerGroup')}</SelectItem>
              <SelectItem value="user">{t('ownerPerson')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid min-w-0 gap-2">
          <Label htmlFor={ids.owner}>{t('owner')}</Label>
          {v.ownerKind === 'user' ? (
            <PersonPicker id={ids.owner} value={v.owner} onChange={(owner) => patch({ owner })} />
          ) : (
            <Select value={v.ownerGroupId ?? undefined} onValueChange={(x) => patch({ ownerGroupId: x })}>
              <SelectTrigger id={ids.owner} className="w-full">
                <SelectValue placeholder={t('groupPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {(groups.data?.items ?? []).map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="grid min-w-0 gap-2">
          <Label htmlFor={ids.risk}>{t('risk')}</Label>
          <Select value={v.risk} onValueChange={(x) => patch({ risk: x as Risk })}>
            <SelectTrigger id={ids.risk} className="w-full" aria-describedby={`${ids.risk}-hint`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RISKS.map((r) => (
                <SelectItem key={r} value={r}>
                  {tr(r)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p id={`${ids.risk}-hint`} className="text-xs text-muted-foreground">
            {t('riskHint')}
          </p>
        </div>
      </div>
      {role && (
        <div className="flex items-center gap-3">
          <Switch id={ids.active} checked={v.active} onCheckedChange={(x) => patch({ active: x })} />
          <Label htmlFor={ids.active} className="font-normal">
            {t('active')}
          </Label>
        </div>
      )}
      <OptionalFields
        hint={list([t('duration'), t('justificationRequired')])}
        filled={detailsFilled}
        open={moreOpen}
        onOpenChange={setMoreOpen}
      >
        <fieldset className="grid gap-3 rounded-lg border p-4">
          <legend className="px-1 text-sm font-medium">{t('duration')}</legend>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid min-w-0 gap-2">
              <Label htmlFor={ids.def}>{t('defaultDays')}</Label>
              <Input
                id={ids.def}
                type="number"
                min={1}
                value={v.defaultDays ?? ''}
                placeholder={v.allowPermanent ? t('permanentPlaceholder') : ''}
                onChange={(e) => patch({ defaultDays: num(e.target.value) })}
              />
            </div>
            <div className="grid min-w-0 gap-2">
              <Label htmlFor={ids.max}>{t('maxDays')}</Label>
              <Input
                id={ids.max}
                type="number"
                min={1}
                value={v.maxDays ?? ''}
                placeholder={v.allowPermanent ? t('noLimitPlaceholder') : ''}
                onChange={(e) => patch({ maxDays: num(e.target.value) })}
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Switch
              id={ids.perm}
              checked={v.allowPermanent}
              onCheckedChange={(x) => patch({ allowPermanent: x })}
            />
            <Label htmlFor={ids.perm} className="font-normal">
              {t('allowPermanent')}
            </Label>
          </div>
        </fieldset>
        <div className="flex items-center gap-3">
          <Switch
            id={ids.just}
            checked={v.justificationRequired}
            onCheckedChange={(x) => patch({ justificationRequired: x })}
          />
          <Label htmlFor={ids.just} className="font-normal">
            {t('justificationRequired')}
          </Label>
        </div>
      </OptionalFields>
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {tc('cancel')}
        </Button>
        <Button type="submit" loading={save.isPending}>
          {role ? tc('saveChanges') : t('create')}
        </Button>
      </DialogFooter>
    </form>
  );
}
