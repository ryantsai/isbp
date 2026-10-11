'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Divider } from '@astryxdesign/core/Divider';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid } from '@astryxdesign/core/Grid';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { WebPageProps } from '@isbp/sdk/web';
import { useCan } from '@isbp/sdk/web';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { DetailHeader } from '@isbp/ui/page-header';
import { useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { EyeIcon, FileQuestionIcon, PlayIcon, SaveIcon, Trash2Icon, UploadIcon } from 'lucide-react';
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
import { IssueList, MappingTable, useIssueText } from '../profile/mapping-table';
import { PreviewPanel } from '../profile/preview-panel';

const NONE = '__none__';

type Issues = { code?: string; message: string; params?: Record<string, string> }[];

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
        <CardTitle id={id}>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="min-w-0">
        <FormLayout>{children}</FormLayout>
      </CardContent>
    </Card>
  );
}

/** "Last run: Partly failed 33 minutes ago · 1 error · View run · next run in 27 minutes", above the settings. */
function LastRunStrip({ profile, connectionId }: { profile: Profile; connectionId: string }) {
  const t = useTranslations('integrations.editor');
  const last = profile.lastRun;
  const when = last ? (last.finishedAt ?? last.startedAt) : null;
  return (
    <Card>
      <CardContent>
        <HStack gap={2} wrap="wrap" vAlign="center">
          <Text color="secondary">{t('lastRunLabel')}</Text>
          {last ? (
            <>
              <RunStatusText status={last.status} />
              {when && (
                <Text color="secondary">
                  <RelativeTime date={when} />
                </Text>
              )}
              {profile.stats.errors > 0 && (
                <Link href={`${connectionHref(connectionId)}?tab=links&state=error`} weight="medium">
                  · {t('errorsCount', { count: profile.stats.errors })}
                </Link>
              )}
              {profile.stats.conflicts > 0 && (
                <Link href={`${connectionHref(connectionId)}?tab=conflicts`} weight="medium">
                  · {t('conflictsCount', { count: profile.stats.conflicts })}
                </Link>
              )}
              <Link href={runHref(last.id)}>· {t('viewRun')}</Link>
            </>
          ) : (
            <Text>{t('neverRun')}</Text>
          )}
          {profile.enabled && profile.nextRunAt && (
            <Text color="secondary">
              · {t('nextRun')} <RelativeTime date={profile.nextRunAt} />
            </Text>
          )}
        </HStack>
      </CardContent>
    </Card>
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
  const issueText = useIssueText();
  const router = useRouter();
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
  /** The `status` of an input for a list of issues (the first one is shown, with an icon). */
  const statusOf = (list?: Issues) =>
    list?.length ? { type: 'error' as const, message: list.map(issueText).join(' · ') } : undefined;

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
      <VStack gap={5}>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </VStack>
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
  const matchLocalKeys = entity?.matchKeys ?? [];
  const containerStatus =
    submitted && !draft.containerId
      ? { type: 'error' as const, message: t('containerRequired') }
      : statusOf(at('containerId'));

  return (
    <VStack gap={5} className="pb-24">
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
              label={t('runNow')}
              variant="primary"
              icon={<Icon icon={PlayIcon} />}
              isLoading={run.isPending && run.variables === 'run'}
              type="button"
              onClick={() => run.mutate('run')}
            />
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
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <VStack gap={4} className="min-w-0">
          <Section title={t('what')} description={editingSaved ? t('whatFixed') : t('whatHint')}>
            <TextInput
              label={t('name')}
              autoComplete="off"
              isDisabled={readOnly}
              value={draft.name}
              onChange={(name) => set({ name: name.slice(0, 200), nameTouched: true })}
              status={statusOf(submitted && nameMissing ? [{ message: t('nameRequired') }] : undefined)}
            />
            <Grid columns={{ minWidth: 240 }} gap={4}>
              <VStack gap={4} className="min-w-0">
                <Selector
                  label={t('remoteObject', { system })}
                  placeholder={t('chooseObject')}
                  isDisabled={editingSaved || readOnly}
                  options={(connector?.objects ?? []).map((o) => ({
                    value: o.type,
                    label: label(o.name, o.type),
                  }))}
                  value={draft.objectType}
                  onChange={(v) => set({ objectType: v, remoteScope: null, mappings: [], matchRule: null })}
                />
                {object?.scoped &&
                  (editingSaved ? (
                    <TextInput
                      label={t('remoteScope')}
                      isReadOnly
                      isDisabled
                      value={saved.data?.remoteScopeName ?? draft.remoteScope ?? ''}
                      status={statusOf(at('remoteScope'))}
                    />
                  ) : (
                    <Selector
                      label={t('remoteScope')}
                      placeholder={scopes.isLoading ? tc('loading') : t('chooseScope')}
                      isDisabled={readOnly}
                      hasSearch
                      options={(scopes.data?.items ?? []).map((s) => ({ value: s.id, label: s.name }))}
                      value={draft.remoteScope ?? ''}
                      onChange={(v) => set({ remoteScope: v, mappings: [] })}
                      status={statusOf(
                        submitted && !draft.remoteScope
                          ? [{ message: t('scopeRequired') }]
                          : at('remoteScope'),
                      )}
                    />
                  ))}
              </VStack>
              <VStack gap={4} className="min-w-0">
                <Selector
                  label={t('localEntity')}
                  placeholder={t('chooseEntity')}
                  isDisabled={editingSaved || readOnly}
                  options={entities.map((e) => ({
                    value: e.entity,
                    label: label(e.name, e.entity),
                    description: object?.entities.includes(e.entity) ? t('suggested') : undefined,
                    disabled: !e.canConfigure,
                  }))}
                  value={draft.entity}
                  onChange={(v) =>
                    set({
                      entity: v,
                      containerId: null,
                      containerLabel: null,
                      mappings: [],
                      matchRule: null,
                      pushFilter: [],
                    })
                  }
                  status={statusOf(
                    entity && !entity.canConfigure && !editingSaved
                      ? [{ message: t('noSyncPermission') }]
                      : undefined,
                  )}
                />
                {entity?.container && (
                  <ContainerPicker
                    entity={draft.entity}
                    value={draft.containerId}
                    valueLabel={draft.containerLabel}
                    label={t('container', {
                      entity: label(catalogue.entities.get(entity.container)?.name, entity.container),
                    })}
                    disabled={editingSaved || readOnly}
                    status={containerStatus}
                    onChange={(o) => set({ containerId: o.id, containerLabel: o.label, mappings: [] })}
                  />
                )}
              </VStack>
            </Grid>
          </Section>

          <Section title={t('direction')} description={t('directionHint')}>
            <RadioList
              label={t('direction')}
              isLabelHidden
              isDisabled={readOnly}
              value={draft.direction}
              onChange={(d) => {
                const direction = d as (typeof DIRECTIONS)[number];
                set({
                  direction,
                  ...(direction === 'push' ? { createLocal: false } : {}),
                  ...(direction === 'pull' ? { createRemote: false } : {}),
                });
              }}
            >
              {DIRECTIONS.map((d) => (
                <RadioListItem
                  key={d}
                  value={d}
                  label={td(d)}
                  description={td(`${d}Hint`, { system })}
                  endContent={<Icon icon={DIRECTION_ICON[d]} color="accent" />}
                />
              ))}
            </RadioList>
          </Section>

          <Section title={t('records')} description={t('recordsHint')}>
            <Switch
              label={t('createLocal')}
              description={t('createLocalHint', { system })}
              value={draft.createLocal}
              onChange={(v) => set({ createLocal: v })}
              isDisabled={readOnly || !pullable}
              status={statusOf(at('createLocal'))}
            />
            <Switch
              label={t('createRemote', { system })}
              description={
                object && !object.capabilities.create
                  ? t('createRemoteUnsupported', { system })
                  : t('createRemoteHint', { system })
              }
              value={draft.createRemote}
              onChange={(v) => set({ createRemote: v })}
              isDisabled={readOnly || !pushable || (object ? !object.capabilities.create : false)}
              status={statusOf(at('createRemote'))}
            />
            <VStack gap={2} className="min-w-0">
              <Text type="label">{t('matchRule')}</Text>
              <Text type="supporting">{t('matchRuleHint')}</Text>
              <Grid columns={{ minWidth: 200 }} gap={2}>
                <Selector
                  label={t('matchLocal')}
                  isLabelHidden
                  isDisabled={readOnly}
                  options={[
                    { value: NONE, label: t('noMatching') },
                    ...matchLocalKeys.map((k) => ({
                      value: k,
                      label: label(L?.find((f) => f.key === k)?.label, k),
                    })),
                  ]}
                  value={draft.matchRule?.local ?? NONE}
                  onChange={(v) =>
                    set({
                      matchRule: v === NONE ? null : { local: v, remote: draft.matchRule?.remote ?? '' },
                    })
                  }
                />
                <Selector
                  label={t('matchRemote', { system })}
                  isLabelHidden
                  hasSearch
                  placeholder={t('chooseRemoteField')}
                  isDisabled={readOnly || !draft.matchRule}
                  options={(R ?? []).map((f) => ({ value: f.key, label: f.label }))}
                  value={draft.matchRule?.remote ?? ''}
                  onChange={(v) =>
                    draft.matchRule && set({ matchRule: { local: draft.matchRule.local, remote: v } })
                  }
                />
              </Grid>
              <IssueList issues={[...at('matchRule.local'), ...at('matchRule.remote')]} />
            </VStack>
            {draft.createRemote && pushable && (
              <VStack gap={2} className="min-w-0">
                <Text type="label">{t('pushFilter')}</Text>
                <Text type="supporting">{t('pushFilterHint', { system })}</Text>
                <FilterEditor
                  conditions={draft.pushFilter}
                  onChange={(pushFilter) => set({ pushFilter })}
                  fields={L ?? []}
                  readOnly={readOnly}
                />
                <IssueList issues={shown.filter((i) => i.path.startsWith('pushFilter'))} />
              </VStack>
            )}
          </Section>

          <Section title={t('schedule')}>
            <TextInput
              label={t('interval')}
              description={draft.direction === 'push' ? t('intervalPush') : t('intervalHint')}
              value={draft.interval}
              isDisabled={readOnly || draft.direction === 'push'}
              onChange={(v) => set({ interval: v.replace(/[^0-9]/g, '') })}
              status={statusOf(submitted && intervalBad ? [{ message: t('intervalInvalid') }] : undefined)}
            />
            <Switch
              label={t('enabled')}
              description={t('enabledHint')}
              value={draft.enabled}
              onChange={(v) => set({ enabled: v })}
              isDisabled={readOnly}
            />
          </Section>

          <Section title={t('conflicts')} description={t('conflictsHint')}>
            <RadioList
              label={t('policy')}
              isLabelHidden
              isDisabled={readOnly}
              value={draft.conflictPolicy}
              onChange={(p) => set({ conflictPolicy: p as (typeof CONFLICT_POLICIES)[number] })}
            >
              {CONFLICT_POLICIES.map((p) => (
                <RadioListItem
                  key={p}
                  value={p}
                  label={tp(p, { system })}
                  description={tp(`${p}Hint`, { system })}
                />
              ))}
            </RadioList>
            {draft.direction !== 'both' && <Text type="supporting">{t('policyOneWay', { system })}</Text>}
            <Switch
              label={t('comments')}
              description={
                entity && object && (!entity.comments || !object.capabilities.comments)
                  ? t('commentsUnsupported')
                  : t('commentsHint', { system })
              }
              value={draft.comments}
              onChange={(v) => set({ comments: v })}
              isDisabled={
                readOnly || Boolean(entity && object && (!entity.comments || !object.capabilities.comments))
              }
              status={statusOf(at('comments'))}
            />
          </Section>

          <Section title={t('mapping')} description={t('mappingHint', { system })}>
            {!remoteReady || !localReady ? (
              <Text color="secondary">{t('mappingWaiting')}</Text>
            ) : remoteFields.error || localFields.error ? (
              <VStack gap={1}>
                <Banner
                  status="error"
                  title={errorText(remoteFields.error ?? localFields.error)}
                  collapsible={false}
                />
                {errorCode(remoteFields.error) === 'INSECURE_HTTP' && (
                  <Text type="supporting">{t('insecureHint')}</Text>
                )}
              </VStack>
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

          <Section title={t('preview')} description={t('previewHint')}>
            <div>
              <Button
                label={t('runPreview')}
                variant="secondary"
                icon={<Icon icon={EyeIcon} />}
                isLoading={runPreview.isPending}
                isDisabled={!canManage}
                type="button"
                onClick={doPreview}
              />
            </div>
            <div role="status" aria-live="polite" className="min-w-0">
              {preview && <PreviewPanel preview={preview} system={system} />}
            </div>
          </Section>

          <VStack gap={2} className="sticky bottom-0 z-10 bg-background/95 pb-3 backdrop-blur">
            <Divider />
            {rootError && <Banner status="error" title={rootError} collapsible={false} />}
            {canEdit && (
              <HStack gap={2} hAlign="end">
                <Button
                  label={profileId ? tc('saveChanges') : t('create')}
                  variant="primary"
                  icon={<Icon icon={SaveIcon} />}
                  isLoading={pending}
                  type="submit"
                />
              </HStack>
            )}
          </VStack>
        </VStack>
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
    </VStack>
  );
}
