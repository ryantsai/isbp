'use client';

import { ApiError } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
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
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
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
import { EnvKindLabel, StageBadge } from './badges';
import { ConfirmDialog } from './confirm-dialog';
import { INVALIDATE } from './lib';
import { CiPicker, NONE } from './pickers';

/** Owners and managers: environments (with order), repositories, stage and lifecycle dates. */
export function SettingsTab({ app }: { app: AppDetail }) {
  return (
    <div className="grid min-w-0 items-start gap-6 xl:grid-cols-2">
      <div className="grid min-w-0 gap-6">
        <EnvironmentsCard app={app} />
        <LifecycleCard key={String(app.updatedAt)} app={app} />
      </div>
      <RepositoriesCard app={app} />
    </div>
  );
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </p>
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
          <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
            <PlusIcon /> {t('addEnvironment')}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {app.environments.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noEnvironments')}</p>
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
                  <span className="w-5 shrink-0 text-xs text-muted-foreground tabular-nums">{i + 1}.</span>
                  <div className="grid min-w-0 flex-1">
                    <span className="truncate text-sm font-medium">{e.name}</span>
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <EnvKindLabel kind={e.kind} />
                      {e.ci && <span className="truncate">· {e.ci.name}</span>}
                      {e.deploymentCount > 0 && (
                        <span>· {t('deploymentCount', { count: e.deploymentCount })}</span>
                      )}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      disabled={i === 0 || reorder.isPending}
                      onClick={() => move(i, -1)}
                      aria-label={t('moveUp', { name: e.name })}
                    >
                      <ArrowUpIcon />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      disabled={i === app.environments.length - 1 || reorder.isPending}
                      onClick={() => move(i, 1)}
                      aria-label={t('moveDown', { name: e.name })}
                    >
                      <ArrowDownIcon />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => setEditing(e)}
                      aria-label={t('editNamed', { name: e.name })}
                    >
                      <PencilIcon />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive"
                      disabled={e.deploymentCount > 0}
                      title={e.deploymentCount > 0 ? t('envInUse') : undefined}
                      onClick={() => setDeleting(e)}
                      aria-label={t('deleteNamed', { name: e.name })}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
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
  const tc = useTranslations('common');
  const existing = env && env !== 'new' ? env : null;
  return (
    <Dialog open={Boolean(env)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>
            {existing ? t('editEnvironment', { name: existing.name }) : t('addEnvironment')}
          </DialogTitle>
          <DialogDescription>{t('environmentDialogHint')}</DialogDescription>
        </DialogHeader>
        {env && <EnvironmentForm app={app} env={existing} onDone={onClose} />}
      </DialogContent>
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
  const ids = { name: useId(), kind: useId(), url: useId(), ci: useId() };
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
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid min-w-0 gap-2">
          <Label htmlFor={ids.name}>{t('fields.name')}</Label>
          <Input
            id={ids.name}
            value={name}
            maxLength={64}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="grid min-w-0 gap-2">
          <Label htmlFor={ids.kind}>{t('fields.kind')}</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as EnvironmentKind)}>
            <SelectTrigger id={ids.kind} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ENVIRONMENT_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  <EnvKindLabel kind={k} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid min-w-0 gap-2">
        <Label htmlFor={ids.url}>{t('fields.url')}</Label>
        <Input
          id={ids.url}
          type="url"
          placeholder="https://"
          value={url}
          maxLength={500}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>
      <div className="grid min-w-0 gap-2">
        <Label htmlFor={ids.ci}>{t('fields.ci')}</Label>
        <CiPicker id={ids.ci} value={ci} onChange={setCi} />
      </div>
      <FormError message={error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {tc('cancel')}
        </Button>
        <Button type="submit" loading={save.isPending}>
          {env ? tc('saveChanges') : tc('create')}
        </Button>
      </DialogFooter>
    </form>
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
          <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
            <PlusIcon /> {t('addRepository')}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {app.repositories.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noRepositories')}</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {app.repositories.map((r) => (
              <li key={r.id} className="flex min-w-0 items-center gap-2 px-3 py-2">
                <GitBranchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="grid min-w-0 flex-1">
                  <span className="truncate text-sm font-medium">{r.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {tp(r.provider)} · {r.defaultBranch}
                  </span>
                </div>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => setEditing(r)}
                  aria-label={t('editNamed', { name: r.name })}
                >
                  <PencilIcon />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setDeleting(r)}
                  aria-label={t('deleteNamed', { name: r.name })}
                >
                  <Trash2Icon />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent closeLabel={tc('close')}>
          <DialogHeader>
            <DialogTitle>
              {editing && editing !== 'new'
                ? t('editRepository', { name: editing.name })
                : t('addRepository')}
            </DialogTitle>
            <DialogDescription>{t('repositoryDialogHint')}</DialogDescription>
          </DialogHeader>
          {editing && (
            <RepositoryForm
              app={app}
              repo={editing === 'new' ? null : editing}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
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
  const ids = { name: useId(), url: useId(), provider: useId(), branch: useId() };
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
    if (!/^https:\/\/\S+$/.test(url.trim())) return setError(t('form.httpsOnly'));
    try {
      await save.mutateAsync({ name: name.trim(), url: url.trim(), provider, defaultBranch: branch.trim() });
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'CONFLICT' ? t('settingsTab.repoDuplicate') : errorText(err),
      );
    }
  };
  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid min-w-0 gap-2">
          <Label htmlFor={ids.name}>{t('fields.name')}</Label>
          <Input
            id={ids.name}
            value={name}
            maxLength={200}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="grid min-w-0 gap-2">
          <Label htmlFor={ids.provider}>{t('fields.provider')}</Label>
          <Select value={provider} onValueChange={(v) => setProvider(v as RepoProvider)}>
            <SelectTrigger id={ids.provider} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REPO_PROVIDERS.map((p) => (
                <SelectItem key={p} value={p}>
                  {t(`provider.${p}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid min-w-0 gap-2">
        <Label htmlFor={ids.url}>{t('fields.url')}</Label>
        <Input
          id={ids.url}
          type="url"
          placeholder="https://devops.example.com/DefaultCollection/Project/_git/repo"
          value={url}
          maxLength={500}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>
      <div className="grid min-w-0 gap-2">
        <Label htmlFor={ids.branch}>{t('fields.defaultBranch')}</Label>
        <Input
          id={ids.branch}
          className="font-mono"
          value={branch}
          maxLength={200}
          onChange={(e) => setBranch(e.target.value)}
        />
      </div>
      <FormError message={error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {tc('cancel')}
        </Button>
        <Button type="submit" loading={save.isPending}>
          {repo ? tc('saveChanges') : tc('create')}
        </Button>
      </DialogFooter>
    </form>
  );
}

/* ───────────── lifecycle ───────────── */

function LifecycleCard({ app }: { app: AppDetail }) {
  const t = useTranslations('alm');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const ids = { stage: useId(), disposition: useId(), goLive: useId(), retire: useId() };
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
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid min-w-0 gap-2">
              <Label htmlFor={ids.stage}>{t('fields.stage')}</Label>
              <Select value={stage} onValueChange={(v) => setStage(v as typeof stage)}>
                <SelectTrigger id={ids.stage} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {APP_STAGES.map((s) => (
                    <SelectItem key={s} value={s}>
                      <StageBadge stage={s} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid min-w-0 gap-2">
              <Label htmlFor={ids.disposition}>{t('fields.disposition')}</Label>
              <Select value={disposition} onValueChange={setDisposition}>
                <SelectTrigger id={ids.disposition} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>
                    <span className="text-muted-foreground">{t('form.notDecided')}</span>
                  </SelectItem>
                  {DISPOSITIONS.map((d) => (
                    <SelectItem key={d} value={d}>
                      {t(`disposition.${d}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid min-w-0 gap-2">
              <Label htmlFor={ids.goLive}>{t('fields.goLiveDate')}</Label>
              <Input id={ids.goLive} type="date" value={goLive} onChange={(e) => setGoLive(e.target.value)} />
            </div>
            <div className="grid min-w-0 gap-2">
              <Label htmlFor={ids.retire}>{t('fields.retireDate')}</Label>
              <Input id={ids.retire} type="date" value={retire} onChange={(e) => setRetire(e.target.value)} />
            </div>
          </div>
          <FormError message={error} />
          <div className="flex justify-end">
            <Button type="submit" disabled={!dirty} loading={save.isPending}>
              {tc('saveChanges')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
