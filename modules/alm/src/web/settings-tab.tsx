'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { DateInput } from '@astryxdesign/core/DateInput';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid } from '@astryxdesign/core/Grid';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, Layout, LayoutContent, LayoutFooter, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { ApiError } from '@isbp/sdk/web';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import { ArrowDownIcon, ArrowUpIcon, GitBranchIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useId, useState } from 'react';
import {
  APP_STAGES,
  type AppDetail,
  DISPOSITIONS,
  ENVIRONMENT_KINDS,
  type Environment,
  type EnvironmentKind,
  type LookupItem,
  REPO_PROVIDERS,
  type Repository,
  type RepoProvider,
} from '../contracts';
import { ENV_ICON, EnvKindLabel, STAGE_META } from './badges';
import { ConfirmDialog } from './confirm-dialog';
import { asDay, INVALIDATE } from './lib';
import { CiPicker, NONE } from './pickers';

/** Owners and managers: environments (with order), repositories, stage and lifecycle dates. */
export function SettingsTab({ app }: { app: AppDetail }) {
  return (
    <div className="grid min-w-0 items-start gap-4 xl:grid-cols-2">
      <div className="grid min-w-0 gap-4">
        <EnvironmentsCard app={app} />
        <LifecycleCard key={String(app.updatedAt)} app={app} />
      </div>
      <RepositoriesCard app={app} />
    </div>
  );
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return <Banner status="error" title={message} collapsible={false} />;
}

/** The footer every dialog form here shares: Cancel and the submit button that belongs to the form `formId`. */
function FormActions({
  formId,
  submitLabel,
  busy,
  onCancel,
}: {
  formId: string;
  submitLabel: string;
  busy: boolean;
  onCancel: () => void;
}) {
  const tc = useTranslations('common');
  return (
    <LayoutFooter hasDivider padding={3}>
      <HStack gap={2} hAlign="end">
        <Button label={tc('cancel')} variant="ghost" onClick={onCancel} />
        <Button label={submitLabel} variant="primary" type="submit" form={formId} isLoading={busy} />
      </HStack>
    </LayoutFooter>
  );
}

/* ───────────── environments ───────────── */

function EnvironmentsCard({ app }: { app: AppDetail }) {
  const t = useTranslations('alm.settingsTab');
  const tc = useTranslations('common');
  const [editing, setEditing] = useState<Environment | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Environment | null>(null);
  const base = `/alm/applications/${app.code}/environments`;
  const reorder = useApiMutation((api, ids: string[]) => api.post(`${base}/reorder`, { ids }), {
    invalidate: INVALIDATE,
    success: t('envReordered'),
  });
  const remove = useApiMutation((api, id: string) => api.delete(`${base}/${id}`), {
    invalidate: INVALIDATE,
    success: t('envDeleted'),
    onSuccess: () => setDeleting(null),
  });
  const move = (index: number, by: -1 | 1) => {
    const ids = app.environments.map((e) => e.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + by, 0, moved!);
    reorder.mutate(ids);
  };
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{t('environments')}</CardTitle>
        <CardDescription>{t('environmentsHint')}</CardDescription>
        <CardAction>
          <Button
            label={t('addEnvironment')}
            variant="secondary"
            size="sm"
            icon={<Icon icon={PlusIcon} />}
            onClick={() => setEditing('new')}
          />
        </CardAction>
      </CardHeader>
      <CardContent>
        {app.environments.length === 0 ? (
          <Text color="secondary">{t('noEnvironments')}</Text>
        ) : (
          <ol className="divide-y rounded-lg border">
            <AnimatePresence initial={false}>
              {app.environments.map((e, i) => (
                <motion.li
                  key={e.id}
                  layout
                  transition={{ duration: 0.2 }}
                  className="flex min-w-0 items-center gap-2 px-3 py-2"
                >
                  <Text size="xsm" color="secondary" hasTabularNumbers>
                    {i + 1}.
                  </Text>
                  <StackItem size="fill">
                    <VStack>
                      <Text weight="medium" maxLines={1}>
                        {e.name}
                      </Text>
                      <Text size="xsm" color="secondary" as="div">
                        <span className="flex min-w-0 flex-wrap items-center gap-x-2">
                          <EnvKindLabel kind={e.kind} />
                          {e.ci && <span className="truncate">· {e.ci.name}</span>}
                          {e.deploymentCount > 0 && (
                            <span>· {t('deploymentCount', { count: e.deploymentCount })}</span>
                          )}
                        </span>
                      </Text>
                    </VStack>
                  </StackItem>
                  <HStack>
                    <IconButton
                      label={t('moveUp', { name: e.name })}
                      variant="ghost"
                      size="sm"
                      icon={<Icon icon={ArrowUpIcon} />}
                      isDisabled={i === 0 || reorder.isPending}
                      onClick={() => move(i, -1)}
                    />
                    <IconButton
                      label={t('moveDown', { name: e.name })}
                      variant="ghost"
                      size="sm"
                      icon={<Icon icon={ArrowDownIcon} />}
                      isDisabled={i === app.environments.length - 1 || reorder.isPending}
                      onClick={() => move(i, 1)}
                    />
                    <IconButton
                      label={t('editNamed', { name: e.name })}
                      variant="ghost"
                      size="sm"
                      icon={<Icon icon={PencilIcon} />}
                      onClick={() => setEditing(e)}
                    />
                    <IconButton
                      label={t('deleteNamed', { name: e.name })}
                      variant="ghost"
                      size="sm"
                      icon={<Icon icon={Trash2Icon} />}
                      isDisabled={e.deploymentCount > 0}
                      tooltip={e.deploymentCount > 0 ? t('envInUse') : undefined}
                      onClick={() => setDeleting(e)}
                    />
                  </HStack>
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
        )}
      </CardContent>
      <EnvironmentDialog app={app} env={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('deleteEnvTitle', { name: deleting?.name ?? '' })}
        description={t('deleteEnvBody')}
        confirmLabel={tc('delete')}
        destructive
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </Card>
  );
}

function EnvironmentDialog({
  app,
  env,
  onClose,
}: {
  app: AppDetail;
  env: Environment | 'new' | null;
  onClose: () => void;
}) {
  const t = useTranslations('alm.settingsTab');
  const existing = env && env !== 'new' ? env : null;
  return (
    <Dialog
      isOpen={Boolean(env)}
      onOpenChange={(o) => !o && onClose()}
      width={512}
      purpose="form"
      aria-label={existing ? t('editEnvironment', { name: existing.name }) : t('addEnvironment')}
    >
      {env && <EnvironmentForm app={app} env={existing} onDone={onClose} />}
    </Dialog>
  );
}

function EnvironmentForm({
  app,
  env,
  onDone,
}: {
  app: AppDetail;
  env: Environment | null;
  onDone: () => void;
}) {
  const t = useTranslations('alm');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const formId = useId();
  const [name, setName] = useState(env?.name ?? '');
  const [kind, setKind] = useState<EnvironmentKind>(env?.kind ?? 'development');
  const [url, setUrl] = useState(env?.url ?? '');
  const [ci, setCi] = useState<LookupItem | null>(
    env?.ci ? { id: env.ci.id, name: env.ci.name, hint: env.ci.reference } : null,
  );
  const [error, setError] = useState<string | null>(null);
  const base = `/alm/applications/${app.code}/environments`;
  const save = useApiMutation(
    (api, body: Record<string, unknown>) =>
      env ? api.patch(`${base}/${env.id}`, body) : api.post(base, body),
    {
      invalidate: INVALIDATE,
      success: env ? t('settingsTab.envSaved') : t('settingsTab.envAdded'),
      onSuccess: onDone,
      silent: true,
    },
  );
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError(t('settingsTab.nameRequired'));
    if (url.trim() && !/^https:\/\/\S+$/.test(url.trim())) return setError(t('form.httpsOnly'));
    try {
      await save.mutateAsync({ name: name.trim(), kind, url: url.trim() || null, ciId: ci?.id ?? null });
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'CONFLICT' ? t('settingsTab.envDuplicate') : errorText(err),
      );
    }
  };
  return (
    <Layout
      header={
        <DialogHeader
          title={env ? t('settingsTab.editEnvironment', { name: env.name }) : t('settingsTab.addEnvironment')}
          subtitle={t('settingsTab.environmentDialogHint')}
          onOpenChange={(next) => !next && onDone()}
        />
      }
      content={
        <LayoutContent padding={4}>
          <form id={formId} onSubmit={submit} noValidate>
            <FormLayout defaultOptionality="optional">
              <Grid columns={{ minWidth: 200, repeat: 'fit' }} gap={4} align="end">
                <TextInput label={t('fields.name')} isRequired hasAutoFocus value={name} onChange={setName} />
                <Selector
                  label={t('fields.kind')}
                  width="100%"
                  value={kind}
                  onChange={(v) => setKind(v as EnvironmentKind)}
                  options={ENVIRONMENT_KINDS.map((k) => ({
                    value: k,
                    label: t(`envKind.${k}`),
                    icon: ENV_ICON[k],
                  }))}
                />
              </Grid>
              <TextInput
                label={t('fields.url')}
                placeholder="https://"
                autoComplete="off"
                value={url}
                onChange={setUrl}
              />
              <CiPicker label={t('fields.ci')} value={ci} onChange={setCi} />
              <FormError message={error} />
            </FormLayout>
          </form>
        </LayoutContent>
      }
      footer={
        <FormActions
          formId={formId}
          submitLabel={env ? tc('saveChanges') : tc('create')}
          busy={save.isPending}
          onCancel={onDone}
        />
      }
    />
  );
}

/* ───────────── repositories ───────────── */

function RepositoriesCard({ app }: { app: AppDetail }) {
  const t = useTranslations('alm.settingsTab');
  const tp = useTranslations('alm.provider');
  const tc = useTranslations('common');
  const [editing, setEditing] = useState<Repository | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Repository | null>(null);
  const remove = useApiMutation(
    (api, id: string) => api.delete(`/alm/applications/${app.code}/repositories/${id}`),
    { invalidate: INVALIDATE, success: t('repoDeleted'), onSuccess: () => setDeleting(null) },
  );
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{t('repositories')}</CardTitle>
        <CardDescription>{t('repositoriesHint')}</CardDescription>
        <CardAction>
          <Button
            label={t('addRepository')}
            variant="secondary"
            size="sm"
            icon={<Icon icon={PlusIcon} />}
            onClick={() => setEditing('new')}
          />
        </CardAction>
      </CardHeader>
      <CardContent>
        {app.repositories.length === 0 ? (
          <Text color="secondary">{t('noRepositories')}</Text>
        ) : (
          <ul className="divide-y rounded-lg border">
            {app.repositories.map((r) => (
              <li key={r.id} className="flex min-w-0 items-center gap-2 px-3 py-2">
                <Icon icon={GitBranchIcon} color="secondary" />
                <StackItem size="fill">
                  <VStack>
                    <Text weight="medium" maxLines={1}>
                      {r.name}
                    </Text>
                    <Text size="xsm" color="secondary" maxLines={1}>
                      {tp(r.provider)} · {r.defaultBranch}
                    </Text>
                  </VStack>
                </StackItem>
                <IconButton
                  label={t('editNamed', { name: r.name })}
                  variant="ghost"
                  size="sm"
                  icon={<Icon icon={PencilIcon} />}
                  onClick={() => setEditing(r)}
                />
                <IconButton
                  label={t('deleteNamed', { name: r.name })}
                  variant="ghost"
                  size="sm"
                  icon={<Icon icon={Trash2Icon} />}
                  onClick={() => setDeleting(r)}
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <Dialog
        isOpen={Boolean(editing)}
        onOpenChange={(o) => !o && setEditing(null)}
        width={512}
        purpose="form"
        aria-label={
          editing && editing !== 'new' ? t('editRepository', { name: editing.name }) : t('addRepository')
        }
      >
        {editing && (
          <RepositoryForm
            app={app}
            repo={editing === 'new' ? null : editing}
            onDone={() => setEditing(null)}
          />
        )}
      </Dialog>
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('deleteRepoTitle', { name: deleting?.name ?? '' })}
        description={t('deleteRepoBody')}
        confirmLabel={tc('delete')}
        destructive
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </Card>
  );
}

function RepositoryForm({
  app,
  repo,
  onDone,
}: {
  app: AppDetail;
  repo: Repository | null;
  onDone: () => void;
}) {
  const t = useTranslations('alm');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const formId = useId();
  const [name, setName] = useState(repo?.name ?? '');
  const [url, setUrl] = useState(repo?.url ?? '');
  const [provider, setProvider] = useState<RepoProvider>(repo?.provider ?? 'azure_devops');
  const [branch, setBranch] = useState(repo?.defaultBranch ?? 'main');
  const [error, setError] = useState<string | null>(null);
  const base = `/alm/applications/${app.code}/repositories`;
  const save = useApiMutation(
    (api, body: Record<string, unknown>) =>
      repo ? api.patch(`${base}/${repo.id}`, body) : api.post(base, body),
    {
      invalidate: INVALIDATE,
      success: repo ? t('settingsTab.repoSaved') : t('settingsTab.repoAdded'),
      onSuccess: onDone,
      silent: true,
    },
  );
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !branch.trim()) return setError(t('settingsTab.nameRequired'));
    if (!/^https?:\/\/\S+$/i.test(url.trim())) return setError(t('form.httpOrHttps'));
    try {
      await save.mutateAsync({ name: name.trim(), url: url.trim(), provider, defaultBranch: branch.trim() });
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'CONFLICT' ? t('settingsTab.repoDuplicate') : errorText(err),
      );
    }
  };
  return (
    <Layout
      header={
        <DialogHeader
          title={repo ? t('settingsTab.editRepository', { name: repo.name }) : t('settingsTab.addRepository')}
          subtitle={t('settingsTab.repositoryDialogHint')}
          onOpenChange={(next) => !next && onDone()}
        />
      }
      content={
        <LayoutContent padding={4}>
          <form id={formId} onSubmit={submit} noValidate>
            <FormLayout defaultOptionality="optional">
              <Grid columns={{ minWidth: 200, repeat: 'fit' }} gap={4} align="end">
                <TextInput label={t('fields.name')} isRequired hasAutoFocus value={name} onChange={setName} />
                <Selector
                  label={t('fields.provider')}
                  width="100%"
                  value={provider}
                  onChange={(v) => setProvider(v as RepoProvider)}
                  options={REPO_PROVIDERS.map((p) => ({ value: p, label: t(`provider.${p}`) }))}
                />
              </Grid>
              <TextInput
                label={t('fields.url')}
                isRequired
                placeholder="https://devops.example.com/DefaultCollection/Project/_git/repo"
                autoComplete="off"
                value={url}
                onChange={setUrl}
              />
              <TextInput label={t('fields.defaultBranch')} isRequired value={branch} onChange={setBranch} />
              <FormError message={error} />
            </FormLayout>
          </form>
        </LayoutContent>
      }
      footer={
        <FormActions
          formId={formId}
          submitLabel={repo ? tc('saveChanges') : tc('create')}
          busy={save.isPending}
          onCancel={onDone}
        />
      }
    />
  );
}

/* ───────────── lifecycle ───────────── */

function LifecycleCard({ app }: { app: AppDetail }) {
  const t = useTranslations('alm');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const [stage, setStage] = useState(app.stage);
  const [disposition, setDisposition] = useState<string>(app.disposition ?? NONE);
  const [goLive, setGoLive] = useState(app.goLiveDate ?? '');
  const [retire, setRetire] = useState(app.retireDate ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = useApiMutation(
    (api, body: Record<string, unknown>) => api.patch(`/alm/applications/${app.code}`, body),
    { invalidate: INVALIDATE, success: t('settingsTab.lifecycleSaved'), silent: true },
  );
  const dirty =
    stage !== app.stage ||
    disposition !== (app.disposition ?? NONE) ||
    goLive !== (app.goLiveDate ?? '') ||
    retire !== (app.retireDate ?? '');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (goLive && retire && retire < goLive) return setError(t('form.retireBeforeGoLive'));
    try {
      await save.mutateAsync({
        stage,
        disposition: disposition === NONE ? null : disposition,
        goLiveDate: goLive || null,
        retireDate: retire || null,
      });
    } catch (err) {
      setError(errorText(err));
    }
  };
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{t('settingsTab.lifecycle')}</CardTitle>
        <CardDescription>{t('settingsTab.lifecycleHint')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate>
          <FormLayout defaultOptionality="optional">
            <Grid columns={{ minWidth: 200, repeat: 'fit' }} gap={4} align="end">
              <Selector
                label={t('fields.stage')}
                width="100%"
                value={stage}
                onChange={(v) => setStage(v as typeof stage)}
                options={APP_STAGES.map((s) => ({
                  value: s,
                  label: t(`stage.${s}`),
                  icon: STAGE_META[s].icon,
                }))}
              />
              <Selector
                label={t('fields.disposition')}
                width="100%"
                value={disposition}
                onChange={setDisposition}
                options={[
                  { value: NONE, label: t('form.notDecided') },
                  ...DISPOSITIONS.map((d) => ({ value: d, label: t(`disposition.${d}`) })),
                ]}
              />
              <DateInput
                label={t('fields.goLiveDate')}
                hasClear
                value={asDay(goLive)}
                onChange={(d) => setGoLive(d ?? '')}
              />
              <DateInput
                label={t('fields.retireDate')}
                hasClear
                value={asDay(retire)}
                onChange={(d) => setRetire(d ?? '')}
              />
            </Grid>
            <FormError message={error} />
            <HStack hAlign="end">
              <Button
                label={tc('saveChanges')}
                variant="primary"
                isLoading={save.isPending}
                isDisabled={!dirty}
                type="submit"
              />
            </HStack>
          </FormLayout>
        </form>
      </CardContent>
    </Card>
  );
}
