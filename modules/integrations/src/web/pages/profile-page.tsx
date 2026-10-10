'use client';

import type { WebPageProps } from '@isbp/sdk/web';
import { useCan } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { DetailHeader } from '@isbp/ui/page-header';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { Switch } from '@isbp/ui/switch';
import { EyeIcon, FileQuestionIcon, PlayIcon, SaveIcon, Trash2Icon, UploadIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  CONFLICT_POLICIES,
  type Connection,
  DIRECTIONS,
  type DefaultMapping,
  type LocalField,
  type Preview,
  type Profile,
  type RemoteField,
} from '../../contracts';
import { type MappingIssue, validateProfile } from '../../mapping';
import { DIRECTION_ICON, ModuleIcon, RunStatusText } from '../badges';
import { ConfirmDialog } from '../confirm-dialog';
import {
  connectionHref,
  errorCode,
  INVALIDATE,
  issuesOf,
  profileHref,
  runHref,
  useCatalogue,
  useLabel,
} from '../lib';
import { ContainerPicker } from '../profile/container-picker';
import { bodyOf, type Draft, draftOf, emptyDraft, intervalOf, patchOf } from '../profile/draft';
import { FilterEditor } from '../profile/filter-editor';
import { IssueList, MappingTable } from '../profile/mapping-table';
import { PreviewPanel } from '../profile/preview-panel';

const NONE = '__none__';

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <Card role="region" aria-labelledby={id} className="min-w-0">
      <CardHeader>
        <CardTitle id={id} className="text-base">
          {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="grid min-w-0 gap-4">{children}</CardContent>
    </Card>
  );
}

function Field({
  id,
  label,
  hint,
  issues,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  issues?: MappingIssue[] | { code?: string; message: string }[];
  children: ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {issues?.length ? (
        <IssueList id={`${id}-error`} issues={issues} />
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function SwitchRow({
  id,
  label,
  hint,
  checked,
  onChange,
  disabled,
  issues,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  issues?: MappingIssue[];
}) {
  return (
    <div className="flex items-start gap-3">
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-describedby={`${id}-hint`}
      />
      <div className="grid min-w-0 gap-0.5">
        <Label htmlFor={id}>{label}</Label>
        {hint && (
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            {hint}
          </p>
        )}
        {issues?.length ? <IssueList issues={issues} /> : null}
      </div>
    </div>
  );
}

/** "Last run: Partly failed 33 minutes ago · 1 error · View run · next run in 27 minutes", above the settings. */
function LastRunStrip({ profile, connectionId }: { profile: Profile; connectionId: string }) {
  const t = useTranslations('integrations.editor');
  const last = profile.lastRun;
  const when = last ? (last.finishedAt ?? last.startedAt) : null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border bg-card px-4 py-3 text-sm">
      <span className="text-muted-foreground">{t('lastRunLabel')}</span>
      {last ? (
        <>
          <RunStatusText status={last.status} />
          {when && <RelativeTime date={when} className="text-muted-foreground" />}
          {profile.stats.errors > 0 && (
            <Link
              href={`${connectionHref(connectionId)}?tab=links&state=error`}
              className="font-medium text-destructive hover:underline"
            >
              · {t('errorsCount', { count: profile.stats.errors })}
            </Link>
          )}
          {profile.stats.conflicts > 0 && (
            <Link
              href={`${connectionHref(connectionId)}?tab=conflicts`}
              className="font-medium text-warning-foreground hover:underline"
            >
              · {t('conflictsCount', { count: profile.stats.conflicts })}
            </Link>
          )}
          <Link href={runHref(last.id)} className="text-primary hover:underline">
            · {t('viewRun')}
          </Link>
        </>
      ) : (
        <span>{t('neverRun')}</span>
      )}
      {profile.enabled && profile.nextRunAt && (
        <span className="text-muted-foreground">
          · {t('nextRun')} <RelativeTime date={profile.nextRunAt} />
        </span>
      )}
    </p>
  );
}

/**
 * A sync profile: what ↔ what (fixed once saved), direction, records, schedule, conflicts and the field
 * mapping, checked live with the same rules as the API. "Preview" is a dry run; "Run now" follows the run.
 */
export default function ProfilePage({ params }: WebPageProps) {
  const t = useTranslations('integrations.editor');
  const td = useTranslations('integrations.direction');
  const tp = useTranslations('integrations.policy');
  const tc = useTranslations('common');
  const label = useLabel();
  const errorText = useErrorText();
  const router = useRouter();
  const id = useId();
  const connectionId = params.id ?? '';
  const profileId = params.profileId && params.profileId !== 'new' ? params.profileId : null;
  const canManage = useCan('integrations.connections.manage');
  const catalogue = useCatalogue();
  const connection = useApiQuery<Connection>(`/integrations/connections/${connectionId}`);
  const saved = useApiQuery<Profile>(profileId ? `/integrations/profiles/${profileId}` : null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [serverIssues, setServerIssues] = useState<MappingIssue[]>([]);
  const [rootError, setRootError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Load the saved profile once.
  const loaded = useRef<string | null>(null);
  useEffect(() => {
    if (saved.data && loaded.current !== saved.data.id) {
      loaded.current = saved.data.id;
      setDraft(draftOf(saved.data));
    }
  }, [saved.data]);

  const connector = connection.data ? catalogue.connectors.get(connection.data.type) : undefined;
  const object = connector?.objects.find((o) => o.type === draft.objectType);
  const entity = catalogue.entities.get(draft.entity);
  const system = connection.data?.name ?? '';
  const editingSaved = Boolean(profileId);
  const canEdit = profileId ? Boolean(saved.data?.canEdit) : canManage && (!entity || entity.canConfigure);

  const scopes = useApiQuery<{ items: { id: string; name: string }[] }>(
    object?.scoped && !editingSaved ? `/integrations/connections/${connectionId}/scopes` : null,
    { objectType: draft.objectType },
  );
  const remoteReady = Boolean(draft.objectType) && (!object?.scoped || Boolean(draft.remoteScope));
  const remoteFields = useApiQuery<{ items: RemoteField[] }>(
    remoteReady ? `/integrations/connections/${connectionId}/fields` : null,
    { objectType: draft.objectType, scope: draft.remoteScope ?? undefined },
  );
  const localReady = Boolean(draft.entity) && (!entity?.container || Boolean(draft.containerId));
  const localFields = useApiQuery<{ items: LocalField[] }>(
    localReady ? `/integrations/entities/${draft.entity}/fields` : null,
    { containerId: draft.containerId ?? undefined },
  );
  const L = localFields.data?.items;
  const R = remoteFields.data?.items;

  const set = (patch: Partial<Draft>) => {
    setDraft((d) => {
      const next = { ...d, ...patch };
      if (!next.nameTouched && (patch.objectType !== undefined || patch.entity !== undefined)) {
        const o = connector?.objects.find((x) => x.type === next.objectType);
        const e = catalogue.entities.get(next.entity);
        next.name = o && e ? t('defaultName', { remote: label(o.name), local: label(e.name) }) : next.name;
      }
      return next;
    });
    setPreview(null);
  };

  // Live validation with the API's own rules, once both catalogues are in.
  const issues = useMemo<MappingIssue[]>(() => {
    if (!L || !R || !object || !entity) return [];
    return validateProfile(draft, L, R, {
      object: object.capabilities,
      entity: { comments: entity.comments, matchKeys: entity.matchKeys },
    });
  }, [draft, L, R, object, entity]);
  const shown = submitted
    ? [...issues, ...serverIssues.filter((s) => !issues.some((i) => i.path === s.path))]
    : serverIssues;
  const at = (path: string) => shown.filter((i) => i.path === path);
  const mappingIssues = shown.filter((i) => i.path.startsWith('mappings'));

  const onError = (err: unknown) => {
    const list = issuesOf(err) as MappingIssue[];
    setServerIssues(list);
    setRootError(errorText(err));
  };

  const suggest = useApiMutation(
    (api) =>
      api.get<DefaultMapping>('/integrations/profiles/default-mapping', {
        connectionId,
        objectType: draft.objectType,
        entity: draft.entity,
        scope: draft.remoteScope ?? undefined,
        containerId: draft.containerId ?? undefined,
      }),
    {
      silent: true,
      onSuccess: (r) =>
        set({ mappings: r.mappings.map((m) => ({ ...m, direction: m.direction ?? 'both' })) }),
    },
  );
  // A new pair starts from the connector's suggestion.
  const suggestedFor = useRef('');
  useEffect(() => {
    const key = `${draft.objectType}|${draft.entity}|${draft.remoteScope}|${draft.containerId}`;
    if (editingSaved || !remoteReady || !localReady || draft.mappings.length || suggestedFor.current === key)
      return;
    suggestedFor.current = key;
    suggest.mutate(undefined);
  }, [
    editingSaved,
    remoteReady,
    localReady,
    draft.objectType,
    draft.entity,
    draft.remoteScope,
    draft.containerId,
    draft.mappings.length,
    suggest,
  ]);

  const create = useApiMutation((api, body: unknown) => api.post<Profile>('/integrations/profiles', body), {
    invalidate: INVALIDATE,
    success: t('created'),
    silent: true,
    onSuccess: (p) => router.replace(profileHref(connectionId, p.id)),
  });
  const update = useApiMutation(
    (api, body: unknown) => api.patch<Profile>(`/integrations/profiles/${profileId}`, body),
    {
      invalidate: INVALIDATE,
      success: t('saved'),
      silent: true,
    },
  );
  const runPreview = useApiMutation(
    (api) =>
      profileId
        ? api.post<Preview>(`/integrations/profiles/${profileId}/preview`, patchOf(draft))
        : api.post<Preview>('/integrations/profiles/preview', bodyOf(draft, connectionId)),
    { silent: true, onSuccess: setPreview },
  );
  const run = useApiMutation(
    (api, kind: 'run' | 'export') => api.post<{ id: string }>(`/integrations/profiles/${profileId}/${kind}`),
    { invalidate: INVALIDATE, success: t('runStarted'), onSuccess: (r) => router.push(runHref(r.id)) },
  );
  const remove = useApiMutation((api) => api.delete(`/integrations/profiles/${profileId}`), {
    invalidate: INVALIDATE,
    success: t('deleted'),
    onSuccess: () => router.push(`${connectionHref(connectionId)}?tab=profiles`),
  });

  const nameMissing = !draft.name.trim();
  const intervalBad = intervalOf(draft) === null;
  const whatMissing =
    !draft.objectType ||
    !draft.entity ||
    (object?.scoped && !draft.remoteScope) ||
    (entity?.container && !draft.containerId);

  const check = () => {
    setSubmitted(true);
    setRootError(null);
    setServerIssues([]);
    return !(nameMissing || intervalBad || whatMissing || issues.length);
  };
  const save = () => {
    if (!check()) {
      setRootError(t('fixIssues'));
      return;
    }
    if (profileId) update.mutate(patchOf(draft), { onError });
    else create.mutate(bodyOf(draft, connectionId), { onError });
  };
  const doPreview = () => {
    setRootError(null);
    if (whatMissing) {
      setSubmitted(true);
      return;
    }
    runPreview.mutate(undefined, { onError });
  };

  if (connection.isLoading || (profileId && saved.isLoading))
    return (
      <div className="space-y-5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  if (!connection.data || (profileId && !saved.data))
    return <EmptyState icon={<FileQuestionIcon />} title={t('notFound')} />;

  const readOnly = !canEdit;
  const pending = create.isPending || update.isPending;
  const entities = catalogue.list.entities
    .slice()
    .sort(
      (a, b) =>
        Number(object?.entities.includes(b.entity) ?? 0) - Number(object?.entities.includes(a.entity) ?? 0),
    );
  const pullable = draft.direction !== 'push';
  const pushable = draft.direction !== 'pull';

  return (
    <div className="space-y-5 pb-24">
      <DetailHeader
        className="pb-0"
        back={{ href: `${connectionHref(connectionId)}?tab=profiles`, label: system }}
        icon={<ModuleIcon name={connection.data.connector.icon} />}
        reference={t('eyebrow', { system })}
        title={profileId ? (saved.data?.name ?? '') : t('newTitle')}
        meta={readOnly ? t('readOnly') : undefined}
        primaryAction={
          profileId &&
          canManage && (
            <Button
              type="button"
              loading={run.isPending && run.variables === 'run'}
              onClick={() => run.mutate('run')}
            >
              <PlayIcon /> {t('runNow')}
            </Button>
          )
        }
        actions={
          profileId && canManage && saved.data?.direction !== 'pull' && saved.data?.createRemote
            ? [
                {
                  id: 'export',
                  label: t('export', { system }),
                  icon: <UploadIcon />,
                  disabled: run.isPending,
                  onSelect: () => run.mutate('export'),
                },
              ]
            : []
        }
        menu={
          profileId && canManage
            ? [
                {
                  label: tc('delete'),
                  icon: <Trash2Icon />,
                  destructive: true,
                  onSelect: () => setDeleting(true),
                },
              ]
            : []
        }
      />
      {saved.data && <LastRunStrip profile={saved.data} connectionId={connectionId} />}

      <form
        noValidate
        className="grid min-w-0 gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <fieldset disabled={readOnly} className="grid min-w-0 gap-4">
          <Section title={t('what')} description={editingSaved ? t('whatFixed') : t('whatHint')}>
            <Field
              id={`${id}-name`}
              label={t('name')}
              issues={submitted && nameMissing ? [{ message: t('nameRequired') }] : undefined}
            >
              <Input
                id={`${id}-name`}
                value={draft.name}
                maxLength={200}
                autoComplete="off"
                aria-invalid={(submitted && nameMissing) || undefined}
                onChange={(e) => set({ name: e.target.value, nameTouched: true })}
              />
            </Field>
            <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
              <div className="grid min-w-0 gap-4">
                <Field id={`${id}-object`} label={t('remoteObject', { system })}>
                  <Select
                    value={draft.objectType || ''}
                    onValueChange={(v) =>
                      set({ objectType: v, remoteScope: null, mappings: [], matchRule: null })
                    }
                    disabled={editingSaved}
                  >
                    <SelectTrigger id={`${id}-object`} className="w-full">
                      <SelectValue placeholder={t('chooseObject')} />
                    </SelectTrigger>
                    <SelectContent>
                      {(connector?.objects ?? []).map((o) => (
                        <SelectItem key={o.type} value={o.type}>
                          {label(o.name, o.type)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                {object?.scoped && (
                  <Field
                    id={`${id}-scope`}
                    label={t('remoteScope')}
                    issues={
                      submitted && !draft.remoteScope ? [{ message: t('scopeRequired') }] : at('remoteScope')
                    }
                  >
                    {editingSaved ? (
                      <Input
                        id={`${id}-scope`}
                        value={saved.data?.remoteScopeName ?? draft.remoteScope ?? ''}
                        disabled
                        readOnly
                      />
                    ) : (
                      <Select
                        value={draft.remoteScope ?? ''}
                        onValueChange={(v) => set({ remoteScope: v, mappings: [] })}
                      >
                        <SelectTrigger id={`${id}-scope`} className="w-full">
                          <SelectValue placeholder={scopes.isLoading ? tc('loading') : t('chooseScope')} />
                        </SelectTrigger>
                        <SelectContent>
                          {(scopes.data?.items ?? []).map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </Field>
                )}
              </div>
              <div className="grid min-w-0 gap-4">
                <Field
                  id={`${id}-entity`}
                  label={t('localEntity')}
                  issues={
                    entity && !entity.canConfigure && !editingSaved
                      ? [{ message: t('noSyncPermission') }]
                      : undefined
                  }
                >
                  <Select
                    value={draft.entity || ''}
                    onValueChange={(v) =>
                      set({
                        entity: v,
                        containerId: null,
                        containerLabel: null,
                        mappings: [],
                        matchRule: null,
                        pushFilter: [],
                      })
                    }
                    disabled={editingSaved}
                  >
                    <SelectTrigger id={`${id}-entity`} className="w-full">
                      <SelectValue placeholder={t('chooseEntity')} />
                    </SelectTrigger>
                    <SelectContent>
                      {entities.map((e) => (
                        <SelectItem key={e.entity} value={e.entity} disabled={!e.canConfigure}>
                          {label(e.name, e.entity)}
                          {object?.entities.includes(e.entity) && (
                            <span className="ml-1 text-xs text-muted-foreground">{t('suggested')}</span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                {entity?.container && (
                  <Field
                    id={`${id}-container`}
                    label={t('container', {
                      entity: label(catalogue.entities.get(entity.container)?.name, entity.container),
                    })}
                    issues={
                      submitted && !draft.containerId
                        ? [{ message: t('containerRequired') }]
                        : at('containerId')
                    }
                  >
                    <ContainerPicker
                      id={`${id}-container`}
                      entity={draft.entity}
                      value={draft.containerId}
                      label={draft.containerLabel}
                      disabled={editingSaved || readOnly}
                      invalid={submitted && !draft.containerId}
                      onChange={(o) => set({ containerId: o.id, containerLabel: o.label, mappings: [] })}
                    />
                  </Field>
                )}
              </div>
            </div>
          </Section>

          <Section title={t('direction')} description={t('directionHint')}>
            <div
              role="radiogroup"
              aria-label={t('direction')}
              className="grid grid-cols-1 gap-3 md:grid-cols-3"
            >
              {DIRECTIONS.map((d) => {
                const Icon = DIRECTION_ICON[d];
                return (
                  <label
                    key={d}
                    htmlFor={`${id}-dir-${d}`}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-checked:border-primary has-checked:bg-primary/5 has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50 motion-reduce:transition-none"
                  >
                    <input
                      id={`${id}-dir-${d}`}
                      type="radio"
                      name={`${id}-direction`}
                      value={d}
                      checked={draft.direction === d}
                      onChange={() =>
                        set({
                          direction: d,
                          ...(d === 'push' ? { createLocal: false } : {}),
                          ...(d === 'pull' ? { createRemote: false } : {}),
                        })
                      }
                      className="mt-1 size-4 shrink-0 accent-primary"
                    />
                    <span className="grid gap-1">
                      <span className="flex items-center gap-1.5 font-medium">
                        <Icon className="size-4 text-primary" aria-hidden />
                        {td(d)}
                      </span>
                      <span className="text-xs text-muted-foreground">{td(`${d}Hint`, { system })}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </Section>

          <Section title={t('records')} description={t('recordsHint')}>
            <SwitchRow
              id={`${id}-create-local`}
              label={t('createLocal')}
              hint={t('createLocalHint', { system })}
              checked={draft.createLocal}
              onChange={(v) => set({ createLocal: v })}
              disabled={readOnly || !pullable}
              issues={at('createLocal')}
            />
            <SwitchRow
              id={`${id}-create-remote`}
              label={t('createRemote', { system })}
              hint={
                object && !object.capabilities.create
                  ? t('createRemoteUnsupported', { system })
                  : t('createRemoteHint', { system })
              }
              checked={draft.createRemote}
              onChange={(v) => set({ createRemote: v })}
              disabled={readOnly || !pushable || (object ? !object.capabilities.create : false)}
              issues={at('createRemote')}
            />
            <div className="grid min-w-0 gap-2">
              <p className="text-sm font-medium">{t('matchRule')}</p>
              <p className="text-xs text-muted-foreground">{t('matchRuleHint')}</p>
              <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                <Select
                  value={draft.matchRule?.local ?? NONE}
                  onValueChange={(v) =>
                    set({
                      matchRule: v === NONE ? null : { local: v, remote: draft.matchRule?.remote ?? '' },
                    })
                  }
                >
                  <SelectTrigger className="w-full" aria-label={t('matchLocal')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t('noMatching')}</SelectItem>
                    {(entity?.matchKeys ?? []).map((k) => (
                      <SelectItem key={k} value={k}>
                        {label(L?.find((f) => f.key === k)?.label, k)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={draft.matchRule?.remote || ''}
                  onValueChange={(v) =>
                    draft.matchRule && set({ matchRule: { local: draft.matchRule.local, remote: v } })
                  }
                  disabled={!draft.matchRule}
                >
                  <SelectTrigger className="w-full" aria-label={t('matchRemote', { system })}>
                    <SelectValue placeholder={t('chooseRemoteField')} />
                  </SelectTrigger>
                  <SelectContent>
                    {(R ?? []).map((f) => (
                      <SelectItem key={f.key} value={f.key}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <IssueList issues={[...at('matchRule.local'), ...at('matchRule.remote')]} />
            </div>
            {draft.createRemote && pushable && (
              <div className="grid min-w-0 gap-2">
                <p className="text-sm font-medium">{t('pushFilter')}</p>
                <p className="text-xs text-muted-foreground">{t('pushFilterHint', { system })}</p>
                <FilterEditor
                  conditions={draft.pushFilter}
                  onChange={(pushFilter) => set({ pushFilter })}
                  fields={L ?? []}
                  readOnly={readOnly}
                />
                <IssueList issues={shown.filter((i) => i.path.startsWith('pushFilter'))} />
              </div>
            )}
          </Section>

          <Section title={t('schedule')}>
            <Field
              id={`${id}-interval`}
              label={t('interval')}
              hint={draft.direction === 'push' ? t('intervalPush') : t('intervalHint')}
              issues={submitted && intervalBad ? [{ message: t('intervalInvalid') }] : undefined}
            >
              <Input
                id={`${id}-interval`}
                inputMode="numeric"
                className="w-32"
                value={draft.interval}
                disabled={draft.direction === 'push'}
                aria-invalid={(submitted && intervalBad) || undefined}
                aria-describedby={`${id}-interval-hint`}
                onChange={(e) => set({ interval: e.target.value.replace(/[^0-9]/g, '') })}
              />
            </Field>
            <SwitchRow
              id={`${id}-enabled`}
              label={t('enabled')}
              hint={t('enabledHint')}
              checked={draft.enabled}
              onChange={(v) => set({ enabled: v })}
              disabled={readOnly}
            />
          </Section>

          <Section title={t('conflicts')} description={t('conflictsHint')}>
            <div role="radiogroup" aria-label={t('policy')} className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {CONFLICT_POLICIES.map((p) => (
                <label
                  key={p}
                  htmlFor={`${id}-policy-${p}`}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-checked:border-primary has-checked:bg-primary/5 has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50',
                    draft.direction !== 'both' && 'opacity-70',
                  )}
                >
                  <input
                    id={`${id}-policy-${p}`}
                    type="radio"
                    name={`${id}-policy`}
                    value={p}
                    checked={draft.conflictPolicy === p}
                    onChange={() => set({ conflictPolicy: p })}
                    className="mt-1 size-4 shrink-0 accent-primary"
                  />
                  <span className="grid gap-0.5">
                    <span className="font-medium">{tp(p, { system })}</span>
                    <span className="text-xs text-muted-foreground">{tp(`${p}Hint`, { system })}</span>
                  </span>
                </label>
              ))}
            </div>
            {draft.direction !== 'both' && (
              <p className="text-xs text-muted-foreground">{t('policyOneWay', { system })}</p>
            )}
            <SwitchRow
              id={`${id}-comments`}
              label={t('comments')}
              hint={
                entity && object && (!entity.comments || !object.capabilities.comments)
                  ? t('commentsUnsupported')
                  : t('commentsHint', { system })
              }
              checked={draft.comments}
              onChange={(v) => set({ comments: v })}
              disabled={
                readOnly || Boolean(entity && object && (!entity.comments || !object.capabilities.comments))
              }
              issues={at('comments')}
            />
          </Section>

          <Section title={t('mapping')} description={t('mappingHint', { system })}>
            {!remoteReady || !localReady ? (
              <p className="text-sm text-muted-foreground">{t('mappingWaiting')}</p>
            ) : remoteFields.error || localFields.error ? (
              <div role="alert" className="grid gap-1 text-sm text-destructive">
                <p>{errorText(remoteFields.error ?? localFields.error)}</p>
                {errorCode(remoteFields.error) === 'INSECURE_HTTP' && (
                  <p className="text-muted-foreground">{t('insecureHint')}</p>
                )}
              </div>
            ) : !L || !R ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <MappingTable
                mappings={draft.mappings}
                onChange={(mappings) => set({ mappings })}
                localFields={L}
                remoteFields={R}
                direction={draft.direction}
                system={system}
                issues={mappingIssues}
                onSuggest={() => suggest.mutate(undefined)}
                suggesting={suggest.isPending}
                readOnly={readOnly}
              />
            )}
          </Section>
        </fieldset>

        <Section title={t('preview')} description={t('previewHint')}>
          <div>
            <Button
              type="button"
              variant="outline"
              onClick={doPreview}
              loading={runPreview.isPending}
              disabled={!canManage}
            >
              <EyeIcon /> {t('runPreview')}
            </Button>
          </div>
          <div role="status" aria-live="polite" className="min-w-0">
            {preview && <PreviewPanel preview={preview} system={system} />}
          </div>
        </Section>

        <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
          {rootError && (
            <p role="alert" className="text-sm text-destructive">
              {rootError}
            </p>
          )}
          {canEdit && (
            <div className="flex items-center justify-end gap-2">
              <Button type="submit" loading={pending}>
                <SaveIcon /> {profileId ? tc('saveChanges') : t('create')}
              </Button>
            </div>
          )}
        </div>
      </form>

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('deleteTitle', { name: saved.data?.name ?? '' })}
        description={t('deleteDescription')}
        confirmLabel={tc('delete')}
        destructive
        loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined)}
      />
    </div>
  );
}
