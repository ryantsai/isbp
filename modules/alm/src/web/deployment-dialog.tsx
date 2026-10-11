'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid } from '@astryxdesign/core/Grid';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, Layout, LayoutContent, LayoutFooter, VStack } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { NEW_CHANGE_PERMISSION } from '@isbp/module-itsm/contracts';
import { ApiError, useCan, usePlatform } from '@isbp/sdk/web';
import { Card, CardContent } from '@isbp/ui/card';
import { countFilled, OptionalFields } from '@isbp/ui/optional-fields';
import { useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { GitPullRequestIcon, ShieldAlertIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useId, useState } from 'react';
import {
  type CreateDeploymentInput,
  type DeploymentStatus,
  type Environment,
  type EnvironmentKind,
  type PolicyCheck,
  type PolicyDecisionDto,
  type RecordedDeployment,
  VERSION_RE,
} from '../contracts';
import { DEPLOYMENT_META, ENV_ICON } from './badges';
import { ChangeLine } from './changes';
import { INVALIDATE, useDebounced } from './lib';

const STATUSES: DeploymentStatus[] = ['succeeded', 'failed', 'in_progress', 'rolled_back'];

/**
 * `/itsm/changes?new=1&title=…&link=alm.release:<id>`: ITSM opens its new-change dialog, linked. Null for people
 * ITSM doesn't give that dialog to (e.g. release managers who only read changes), so the action isn't offered.
 */
export function useRaiseChangeHref() {
  const t = useTranslations('alm.release');
  const { enabledModules } = usePlatform();
  const canRaise = useCan(NEW_CHANGE_PERMISSION) && enabledModules.includes('itsm');
  return (
    app: { name: string },
    release: { id: string; version: string; plannedDate?: string | null },
  ): string | null => {
    if (!canRaise) return null;
    const params = new URLSearchParams({
      new: '1',
      title: t('raiseChangeTitle', { app: app.name, version: release.version }),
      link: `alm.release:${release.id}`,
    });
    // The change window follows the release's planned date: 20:00–21:00 that evening (editable in the form).
    if (release.plannedDate) {
      const start = new Date(`${release.plannedDate}T20:00:00`);
      if (start.getTime() > Date.now()) {
        params.set('start', start.toISOString());
        params.set('end', new Date(start.getTime() + 3_600_000).toISOString());
      }
    }
    return `/itsm/changes?${params.toString()}`;
  };
}

const LINKED = '__linked__';

/**
 * What the change policy says, in words (the live explanation and the refusal). A banner with `role="status"`: the
 * explanation updates live as the form changes, so it must not interrupt like an alert (the dialog's own error does).
 */
export function PolicyExplanation({
  decision,
  check,
  raiseHref,
  soft,
}: {
  decision: PolicyDecisionDto;
  check?: Pick<PolicyCheck, 'environment' | 'changes' | 'requireChange' | 'enforceWindow' | 'namedNotFound'>;
  raiseHref?: string | null;
  /** Nothing was refused yet (a release being prepared): what production needs, in the info tone, not an alarm. */
  soft?: boolean;
}) {
  const t = useTranslations('alm.policy');
  const change = decision.change;
  if (!decision.applies)
    return (
      <Banner
        role="status"
        status="info"
        collapsible={false}
        title={
          check && check.environment.kind !== 'production'
            ? t('notProduction', { environment: check.environment.name })
            : t('switchedOff')
        }
      />
    );
  if (decision.outcome === 'allow' || decision.outcome === 'warn')
    return (
      <Banner
        role="status"
        status={decision.outcome === 'allow' ? 'success' : 'warning'}
        collapsible={false}
        title={decision.outcome === 'allow' ? t('authorized') : t('warnOutsideWindow')}
      >
        {change && <ChangeLine change={change} />}
      </Banner>
    );
  return (
    <Banner
      role="status"
      status={soft ? 'info' : 'error'}
      collapsible={false}
      title={
        soft ? t(`needs.${decision.reason ?? 'no_change'}`) : t(`reason.${decision.reason ?? 'no_change'}`)
      }
    >
      <VStack gap={2}>
        <Text color="secondary">{check?.enforceWindow ? t('ruleWithWindow') : t('rule')}</Text>
        {check?.namedNotFound && <Text weight="medium">{t('namedNotFound')}</Text>}
        {change && <ChangeLine change={change} />}
        {raiseHref && !check?.changes.length && (
          <HStack>
            <Button
              label={t('raiseChange')}
              variant="secondary"
              size="sm"
              icon={<Icon icon={GitPullRequestIcon} />}
              href={raiseHref}
            />
          </HStack>
        )}
      </VStack>
    </Banner>
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
  environmentKind,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  app: { code: string; name: string };
  environments: Environment[];
  release?: { id: string; version: string } | null;
  canOverride: boolean;
  onRecorded?: (d: RecordedDeployment) => void;
  /** Start on the first environment of this kind (`production` from the "ready" notification, `test`). */
  environmentKind?: EnvironmentKind;
}) {
  const t = useTranslations('alm.deploy');
  // The dialog's name is set here, not left to the header: the form inside is mounted per opening, after the dialog.
  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={576} purpose="form" aria-label={t('title')}>
      {open && (
        <DeploymentForm
          app={app}
          environments={environments}
          release={release ?? null}
          canOverride={canOverride}
          environmentKind={environmentKind}
          onCancel={() => onOpenChange(false)}
          onRecorded={(d) => {
            onOpenChange(false);
            onRecorded?.(d);
          }}
        />
      )}
    </Dialog>
  );
}

function DeploymentForm({
  app,
  environments,
  release,
  canOverride,
  environmentKind,
  onCancel,
  onRecorded,
}: {
  app: { code: string; name: string };
  environments: Environment[];
  release: { id: string; version: string } | null;
  canOverride: boolean;
  environmentKind?: EnvironmentKind;
  onCancel: () => void;
  onRecorded: (d: RecordedDeployment) => void;
}) {
  const t = useTranslations('alm.deploy');
  const ta = useTranslations('alm');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const raise = useRaiseChangeHref();
  const ids = { form: useId(), policy: useId() };
  // Default: the first environment that doesn't run this version yet (the next step of the pipeline).
  const initialEnv =
    (environmentKind &&
      (environments.find((e) => e.kind === environmentKind) ??
        (environmentKind === 'test' ? environments.find((e) => e.kind === 'staging') : undefined))) ||
    (release && environments.find((e) => e.currentVersion !== release.version)) ||
    environments[0] ||
    null;
  const [envId, setEnvId] = useState(initialEnv?.id ?? '');
  const [version, setVersion] = useState(release?.version ?? '');
  const [status, setStatus] = useState<DeploymentStatus>('succeeded');
  const [changeRef, setChangeRef] = useState('');
  /** `''` = the release's linked change (or none), `other` = type a reference. */
  const [changeChoice, setChangeChoice] = useState<string>('');
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

  // Changes linked to the release (from the live policy check), offered by reference.
  const linkedChanges = policy.data?.changes ?? [];
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
    // Refused by the change policy: the explanation above says why; point at it instead of a disabled button.
    if (blocked && !overriding) {
      document.getElementById(ids.policy)?.scrollIntoView({ block: 'nearest' });
      return setError(canOverride ? t('blockedOverride') : t('blockedExplain'));
    }
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

  const overrideRecord = overriding && blocked;

  return (
    <Layout
      header={
        <DialogHeader
          title={t('title')}
          subtitle={t('description', { name: app.name })}
          onOpenChange={(next) => !next && onCancel()}
        />
      }
      content={
        <LayoutContent padding={4}>
          <form id={ids.form} onSubmit={submit} noValidate>
            <FormLayout defaultOptionality="optional">
              <Grid columns={{ minWidth: 220, repeat: 'fit' }} gap={4} align="end">
                <Selector
                  label={ta('fields.environment')}
                  isRequired
                  width="100%"
                  placeholder={t('chooseEnvironment')}
                  value={envId || undefined}
                  onChange={(v) => {
                    setEnvId(v);
                    setRefusal(null);
                    setOverriding(false);
                  }}
                  options={environments.map((e) => ({ value: e.id, label: e.name, icon: ENV_ICON[e.kind] }))}
                />
                <TextInput
                  label={ta('fields.version')}
                  isRequired
                  isReadOnly={Boolean(release)}
                  value={version}
                  onChange={(v) => {
                    setVersion(v);
                    setRefusal(null);
                  }}
                  status={
                    version.length > 0 && !versionOk
                      ? { type: 'error', message: ta('releaseForm.versionInvalid') }
                      : undefined
                  }
                />
                <Selector
                  label={t('outcome')}
                  width="100%"
                  value={status}
                  onChange={(v) => setStatus(v as DeploymentStatus)}
                  options={STATUSES.map((s) => ({
                    value: s,
                    label: ta(`deploymentStatus.${s}`),
                    icon: DEPLOYMENT_META[s].icon,
                  }))}
                />
                <VStack gap={2}>
                  <Selector
                    label={t('change')}
                    width="100%"
                    description={t('changeHint')}
                    value={changeChoice || LINKED}
                    onChange={(v) => {
                      const choice = v === LINKED ? '' : v;
                      setChangeChoice(choice);
                      setChangeRef(choice === 'other' || choice === '' ? '' : choice);
                      setRefusal(null);
                    }}
                    options={[
                      {
                        value: LINKED,
                        label:
                          linkedChanges.length === 1
                            ? t('linkedOne', { reference: linkedChanges[0]!.reference })
                            : linkedChanges.length
                              ? t('linkedChange')
                              : t('noChange'),
                      },
                      ...(linkedChanges.length > 1 ? linkedChanges : []).map((c) => ({
                        value: c.reference,
                        label: c.reference,
                        description: c.title,
                      })),
                      { value: 'other', label: t('otherChange') },
                    ]}
                  />
                  {changeChoice === 'other' && (
                    <TextInput
                      label={t('changeReference')}
                      isLabelHidden
                      hasAutoFocus
                      placeholder="CHG-00012"
                      value={changeRef}
                      onChange={(v) => {
                        setChangeRef(v.toUpperCase());
                        setRefusal(null);
                      }}
                    />
                  )}
                </VStack>
              </Grid>

              <VStack gap={2} as="section" id={ids.policy} aria-live="polite" aria-label={t('policyCheck')}>
                <Text type="label" color="secondary">
                  {t('policyCheck')}
                </Text>
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
                      <PolicyExplanation
                        decision={decision}
                        check={live ?? undefined}
                        raiseHref={raiseHref}
                      />
                      {others.length > 0 && (
                        <Card>
                          <CardContent>
                            <VStack gap={3}>
                              <Text type="label" color="secondary">
                                {t('linkedChanges')}
                              </Text>
                              {others.map((c) => (
                                <ChangeLine key={c.id} change={c} />
                              ))}
                            </VStack>
                          </CardContent>
                        </Card>
                      )}
                    </motion.div>
                  </AnimatePresence>
                )}
                {blocked && canOverride && !overriding && (
                  <HStack>
                    <Button
                      label={t('overrideWithReason')}
                      variant="secondary"
                      icon={<Icon icon={ShieldAlertIcon} />}
                      onClick={() => setOverriding(true)}
                    />
                  </HStack>
                )}
                {blocked && !canOverride && (
                  <Text type="supporting" color="secondary">
                    {t('cannotOverride')}
                  </Text>
                )}
                {overrideRecord && (
                  <TextArea
                    label={t('overrideReason')}
                    isRequired
                    rows={2}
                    maxLength={2000}
                    placeholder={t('overridePlaceholder')}
                    description={t('overrideAudited')}
                    value={reason}
                    onChange={setReason}
                  />
                )}
              </VStack>

              <TextArea label={t('notes')} rows={2} maxLength={10_000} value={notes} onChange={setNotes} />
              <OptionalFields label={t('moreDetails')} filled={countFilled(commitSha, pipelineUrl)}>
                <FormLayout defaultOptionality="optional">
                  <Grid columns={{ minWidth: 220, repeat: 'fit' }} gap={4} align="end">
                    <TextInput label={t('commitSha')} value={commitSha} onChange={setCommitSha} />
                    <TextInput
                      label={t('pipelineUrl')}
                      placeholder="https://"
                      autoComplete="off"
                      value={pipelineUrl}
                      onChange={setPipelineUrl}
                    />
                  </Grid>
                </FormLayout>
              </OptionalFields>

              {error && <Banner status="error" title={error} collapsible={false} />}
            </FormLayout>
          </form>
        </LayoutContent>
      }
      footer={
        <LayoutFooter hasDivider padding={3}>
          <HStack gap={2} hAlign="end">
            <Button label={tc('cancel')} variant="ghost" onClick={onCancel} />
            <Button
              label={overrideRecord ? t('recordWithOverride') : t('record')}
              variant={overrideRecord ? 'destructive' : 'primary'}
              type="submit"
              form={ids.form}
              isLoading={record.isPending}
            />
          </HStack>
        </LayoutFooter>
      }
    />
  );
}
