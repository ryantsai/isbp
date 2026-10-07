'use client';

import { ApiError } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
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
import { useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Skeleton } from '@isbp/ui/skeleton';
import { Textarea } from '@isbp/ui/textarea';
import {
  CircleCheckIcon,
  CircleXIcon,
  GitPullRequestIcon,
  InfoIcon,
  type LucideIcon,
  ShieldAlertIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type FormEvent, type ReactNode, useId, useState } from 'react';
import {
  type CreateDeploymentInput,
  type DeploymentStatus,
  type Environment,
  type PolicyCheck,
  type PolicyDecisionDto,
  type RecordedDeployment,
  VERSION_RE,
} from '../contracts';
import { DeploymentStatusBadge, ENV_ICON } from './badges';
import { ChangeLine } from './changes';
import { INVALIDATE, useDebounced } from './lib';

const STATUSES: DeploymentStatus[] = ['succeeded', 'failed', 'in_progress', 'rolled_back'];

/** `/itsm/changes?new=1&title=…&link=alm.release:<id>`: ITSM opens its new-change dialog, linked. */
export function useRaiseChangeHref() {
  const t = useTranslations('alm.release');
  return (app: { name: string }, release: { id: string; version: string }) =>
    `/itsm/changes?new=1&title=${encodeURIComponent(t('raiseChangeTitle', { app: app.name, version: release.version }))}&link=alm.release:${release.id}`;
}

function Panel({
  tone,
  icon: Icon,
  children,
}: {
  tone: 'success' | 'warning' | 'danger' | 'info';
  icon: LucideIcon;
  children: ReactNode;
}) {
  const styles = {
    success: 'border-success/30 bg-success/8 [&>svg]:text-success',
    warning: 'border-warning/40 bg-warning/10 [&>svg]:text-warning-foreground',
    danger: 'border-destructive/30 bg-destructive/8 [&>svg]:text-destructive',
    info: 'border-info/30 bg-info/8 [&>svg]:text-info',
  }[tone];
  return (
    <div className={cn('flex min-w-0 gap-3 rounded-lg border p-3 text-sm', styles)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="grid min-w-0 flex-1 gap-2">{children}</div>
    </div>
  );
}

/** What the change policy says, in words (the live explanation and the refusal). */
export function PolicyExplanation({
  decision,
  check,
  raiseHref,
}: {
  decision: PolicyDecisionDto;
  check?: Pick<PolicyCheck, 'environment' | 'changes' | 'requireChange' | 'enforceWindow' | 'namedNotFound'>;
  raiseHref?: string | null;
}) {
  const t = useTranslations('alm.policy');
  const change = decision.change;
  if (!decision.applies)
    return (
      <Panel tone="info" icon={InfoIcon}>
        <p>
          {check && check.environment.kind !== 'production'
            ? t('notProduction', { environment: check.environment.name })
            : t('switchedOff')}
        </p>
      </Panel>
    );
  if (decision.outcome === 'allow' || decision.outcome === 'warn')
    return (
      <Panel
        tone={decision.outcome === 'allow' ? 'success' : 'warning'}
        icon={decision.outcome === 'allow' ? CircleCheckIcon : TriangleAlertIcon}
      >
        <p className="font-medium">
          {decision.outcome === 'allow' ? t('authorized') : t('warnOutsideWindow')}
        </p>
        {change && <ChangeLine change={change} />}
      </Panel>
    );
  return (
    <Panel tone="danger" icon={CircleXIcon}>
      <p className="font-medium">{t(`reason.${decision.reason ?? 'no_change'}`)}</p>
      <p className="text-muted-foreground">{check?.enforceWindow ? t('ruleWithWindow') : t('rule')}</p>
      {check?.namedNotFound && <p className="text-destructive">{t('namedNotFound')}</p>}
      {change && <ChangeLine change={change} />}
      {raiseHref && !check?.changes.length && (
        <Button variant="outline" size="sm" asChild className="w-fit">
          <Link href={raiseHref}>
            <GitPullRequestIcon /> {t('raiseChange')}
          </Link>
        </Button>
      )}
    </Panel>
  );
}

/**
 * "Record deployment": choose the environment and outcome; for production the dialog explains the change
 * policy live (what recording it now would meet), and on a refusal offers an override to people who may.
 */
export function DeploymentDialog({
  open,
  onOpenChange,
  app,
  environments,
  release,
  canOverride,
  onRecorded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  app: { code: string; name: string };
  environments: Environment[];
  release?: { id: string; version: string } | null;
  canOverride: boolean;
  onRecorded?: (d: RecordedDeployment) => void;
}) {
  const t = useTranslations('alm.deploy');
  const tc = useTranslations('common');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl" closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description', { name: app.name })}</DialogDescription>
        </DialogHeader>
        {open && (
          <DeploymentForm
            app={app}
            environments={environments}
            release={release ?? null}
            canOverride={canOverride}
            onCancel={() => onOpenChange(false)}
            onRecorded={(d) => {
              onOpenChange(false);
              onRecorded?.(d);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DeploymentForm({
  app,
  environments,
  release,
  canOverride,
  onCancel,
  onRecorded,
}: {
  app: { code: string; name: string };
  environments: Environment[];
  release: { id: string; version: string } | null;
  canOverride: boolean;
  onCancel: () => void;
  onRecorded: (d: RecordedDeployment) => void;
}) {
  const t = useTranslations('alm.deploy');
  const ta = useTranslations('alm');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const raise = useRaiseChangeHref();
  const ids = {
    env: useId(),
    version: useId(),
    status: useId(),
    change: useId(),
    changeHint: useId(),
    notes: useId(),
    commit: useId(),
    pipeline: useId(),
    reason: useId(),
    policy: useId(),
  };
  // Default: the first environment that doesn't run this version yet (the next step of the pipeline).
  const initialEnv =
    (release && environments.find((e) => e.currentVersion !== release.version)) ?? environments[0] ?? null;
  const [envId, setEnvId] = useState(initialEnv?.id ?? '');
  const [version, setVersion] = useState(release?.version ?? '');
  const [status, setStatus] = useState<DeploymentStatus>('succeeded');
  const [changeRef, setChangeRef] = useState('');
  const [notes, setNotes] = useState('');
  const [commitSha, setCommitSha] = useState('');
  const [pipelineUrl, setPipelineUrl] = useState('');
  const [refusal, setRefusal] = useState<PolicyDecisionDto | null>(null);
  const [overriding, setOverriding] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const env = environments.find((e) => e.id === envId) ?? null;
  const debouncedChange = useDebounced(changeRef);
  const debouncedVersion = useDebounced(version);
  const versionOk = VERSION_RE.test(version.trim());
  const policy = useApiQuery<PolicyCheck>(env ? '/alm/deployments/policy' : null, {
    application: app.code,
    environment: env?.name,
    version: debouncedVersion || undefined,
    changeReference: debouncedChange || undefined,
  });

  // While another environment's answer is still on screen (kept while refetching), show nothing stale.
  const live = policy.data && policy.data.environment.id === envId ? policy.data : null;
  const decision = refusal ?? live?.decision ?? null;
  // The release's other linked changes (the one the policy is about is shown in the explanation).
  const others = live && decision?.applies ? live.changes.filter((c) => c.id !== decision.change?.id) : [];
  // Refused (by the live check or by the server): only an override with a reason can record it.
  const blocked = Boolean(decision?.applies && decision.outcome === 'deny');
  const raiseHref = release ? raise(app, release) : null;

  const record = useApiMutation(
    (api, body: CreateDeploymentInput) => api.post<RecordedDeployment>('/alm/deployments', body),
    {
      invalidate: INVALIDATE,
      success: (d) => t('recorded', { version: d.version, environment: d.environment.name }),
      onSuccess: onRecorded,
      silent: true,
    },
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!env || !versionOk) return setError(t('incomplete'));
    if (overriding && blocked && reason.trim().length < 10) return setError(t('reasonTooShort'));
    try {
      await record.mutateAsync({
        application: app.code,
        environment: env.name,
        version: version.trim(),
        status,
        changeReference: changeRef.trim() || null,
        notes: notes.trim() || null,
        commitSha: commitSha.trim() || null,
        pipelineUrl: pipelineUrl.trim() || null,
        override: overriding && blocked ? { reason: reason.trim() } : null,
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CHANGE_REQUIRED') {
        const d = err.details as { reason: PolicyDecisionDto['reason']; change: PolicyDecisionDto['change'] };
        setRefusal({
          outcome: 'deny',
          applies: true,
          reason: d.reason,
          warning: null,
          change: d.change ?? null,
        });
        return;
      }
      setError(errorText(err));
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid min-w-0 gap-2">
          <Label htmlFor={ids.env}>{ta('fields.environment')}</Label>
          <Select
            value={envId}
            onValueChange={(v) => {
              setEnvId(v);
              setRefusal(null);
              setOverriding(false);
            }}
          >
            <SelectTrigger id={ids.env} className="w-full">
              <SelectValue placeholder={t('chooseEnvironment')} />
            </SelectTrigger>
            <SelectContent>
              {environments.map((e) => {
                const Icon = ENV_ICON[e.kind];
                return (
                  <SelectItem key={e.id} value={e.id}>
                    <Icon className="size-4 text-muted-foreground" aria-hidden />
                    {e.name}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
        <div className="grid min-w-0 gap-2">
          <Label htmlFor={ids.version}>{ta('fields.version')}</Label>
          <Input
            id={ids.version}
            className="font-mono"
            value={version}
            readOnly={Boolean(release)}
            maxLength={40}
            aria-invalid={version.length > 0 && !versionOk}
            onChange={(e) => {
              setVersion(e.target.value);
              setRefusal(null);
            }}
          />
        </div>
        <div className="grid min-w-0 gap-2">
          <Label htmlFor={ids.status}>{t('outcome')}</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as DeploymentStatus)}>
            <SelectTrigger id={ids.status} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  <DeploymentStatusBadge status={s} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid min-w-0 gap-2">
          <Label htmlFor={ids.change}>{t('changeReference')}</Label>
          <Input
            id={ids.change}
            className="font-mono"
            placeholder="CHG-00012"
            value={changeRef}
            maxLength={32}
            aria-describedby={ids.changeHint}
            onChange={(e) => {
              setChangeRef(e.target.value.toUpperCase());
              setRefusal(null);
            }}
          />
          <p id={ids.changeHint} className="text-xs text-muted-foreground">
            {t('changeHint')}
          </p>
        </div>
      </div>

      <section
        id={ids.policy}
        aria-live="polite"
        aria-label={t('policyCheck')}
        className="grid min-w-0 gap-2"
      >
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {t('policyCheck')}
        </h3>
        {!env ? null : !decision ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${decision.outcome}-${decision.reason}-${decision.change?.id ?? ''}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="grid min-w-0 gap-2"
            >
              <PolicyExplanation decision={decision} check={live ?? undefined} raiseHref={raiseHref} />
              {others.length > 0 && (
                <div className="grid gap-2 rounded-lg border p-3">
                  <p className="text-xs font-medium text-muted-foreground">{t('linkedChanges')}</p>
                  <ul className="grid gap-3">
                    {others.map((c) => (
                      <li key={c.id}>
                        <ChangeLine change={c} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        )}
        {blocked && canOverride && !overriding && (
          <Button type="button" variant="outline" className="w-fit" onClick={() => setOverriding(true)}>
            <ShieldAlertIcon /> {t('overrideWithReason')}
          </Button>
        )}
        {blocked && !canOverride && <p className="text-xs text-muted-foreground">{t('cannotOverride')}</p>}
        {overriding && blocked && (
          <div className="grid gap-2 rounded-lg border border-destructive/30 p-3">
            <Label htmlFor={ids.reason}>{t('overrideReason')}</Label>
            <Textarea
              id={ids.reason}
              rows={2}
              value={reason}
              maxLength={2000}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('overridePlaceholder')}
            />
            <p className="text-xs text-muted-foreground">{t('overrideAudited')}</p>
          </div>
        )}
      </section>

      <div className="grid gap-2">
        <Label htmlFor={ids.notes}>{t('notes')}</Label>
        <Textarea
          id={ids.notes}
          rows={2}
          value={notes}
          maxLength={10_000}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      <details className="group rounded-lg border px-3 py-2 text-sm">
        <summary className="cursor-pointer text-muted-foreground outline-none focus-visible:underline">
          {t('moreDetails')}
        </summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div className="grid min-w-0 gap-2">
            <Label htmlFor={ids.commit}>{t('commitSha')}</Label>
            <Input
              id={ids.commit}
              className="font-mono"
              value={commitSha}
              maxLength={64}
              onChange={(e) => setCommitSha(e.target.value)}
            />
          </div>
          <div className="grid min-w-0 gap-2">
            <Label htmlFor={ids.pipeline}>{t('pipelineUrl')}</Label>
            <Input
              id={ids.pipeline}
              type="url"
              placeholder="https://"
              value={pipelineUrl}
              maxLength={500}
              onChange={(e) => setPipelineUrl(e.target.value)}
            />
          </div>
        </div>
      </details>

      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {tc('cancel')}
        </Button>
        <Button
          type="submit"
          variant={overriding && blocked ? 'destructive' : 'default'}
          loading={record.isPending}
          disabled={!env || !versionOk || (blocked && !overriding)}
        >
          {overriding && blocked ? t('recordWithOverride') : t('record')}
        </Button>
      </DialogFooter>
    </form>
  );
}
