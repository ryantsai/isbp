'use client';

import { HStack } from '@astryxdesign/core/Layout';
import { cn } from '@isbp/ui';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { ErrorState } from '@isbp/ui/empty-state';
import { Meter } from '@isbp/ui/meter';
import { useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  CircleCheckIcon,
  CircleXIcon,
  FlaskConicalIcon,
  GitPullRequestIcon,
  ListChecksIcon,
  NotebookPenIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import type { EnvironmentKind, Readiness, ReleaseDetail } from '../contracts';
import { ChangeLine } from './changes';
import { PolicyExplanation, useRaiseChangeHref } from './deployment-dialog';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';

/** ✕ → ✓ cross-fades when a check flips (a deployment recorded, a change approved). */
function CheckIcon({ ok }: { ok: boolean }) {
  return (
    <span className="relative mt-0.5 size-4 shrink-0">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={ok ? 'ok' : 'no'}
          className="absolute inset-0"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {ok ? (
            <CircleCheckIcon className="size-4 text-success" aria-hidden />
          ) : (
            <CircleXIcon className="size-4 text-destructive" aria-hidden />
          )}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/**
 * The readiness checklist: an authorized change linked (with its reference, approval state and window), tested in
 * test or staging, release notes written, no failed production deployment. Each open check offers its next step
 * (raise or link the change, record a test deployment, write the notes); what production needs is explained in
 * the info tone until a deployment is actually refused.
 */
export function ReadinessCard({
  release,
  onEditNotes,
  onDeploy,
}: {
  release: ReleaseDetail;
  onEditNotes?: () => void;
  onDeploy?: (kind: EnvironmentKind | null) => void;
}) {
  const t = useTranslations('alm.readiness');
  const raise = useRaiseChangeHref();
  const { data, error, refetch } = useApiQuery<Readiness>(`/alm/releases/${release.id}/readiness`);
  const done = release.status === 'released' || release.status === 'cancelled';
  const raiseHref = raise(release.application, release);

  const detail = (key: Readiness['checks'][number]['key'], ok: boolean) => {
    if (!data) return null;
    if (key === 'change')
      return data.change ? (
        <>
          <ChangeLine change={data.change} />
          {!ok && <span className="mt-1 block text-xs">{t('details.changeNotYet')}</span>}
        </>
      ) : (
        <span className="text-muted-foreground">{t('details.noChange')}</span>
      );
    if (key === 'tested')
      return ok ? t('details.testedIn', { environments: data.testedIn.join(', ') }) : t('details.notTested');
    if (key === 'notes') return ok ? t('details.notesWritten') : t('details.noNotes');
    return ok ? t('details.noFailures') : t('details.failures', { count: data.failedInProduction });
  };

  /** The next step of a check that hasn't passed. */
  const action = (key: Readiness['checks'][number]['key']): ReactNode => {
    if (done || !data) return null;
    if (key === 'change' && !data.change && raiseHref)
      return (
        <Button
          label={t('raiseChange')}
          variant="secondary"
          size="sm"
          icon={<Icon icon={GitPullRequestIcon} />}
          href={raiseHref}
          className="w-fit"
        />
      );
    if (key === 'change' && data.change)
      return (
        <Button
          label={t('openChange', { reference: data.change.reference })}
          variant="secondary"
          size="sm"
          href={data.change.href}
          className="w-fit"
        />
      );
    if (key === 'tested' && onDeploy)
      return (
        <Button
          label={t('recordTest')}
          variant="secondary"
          size="sm"
          icon={<Icon icon={FlaskConicalIcon} />}
          className="w-fit"
          onClick={() => onDeploy('test')}
        />
      );
    if (key === 'notes' && onEditNotes)
      return (
        <Button
          label={t('writeNotes')}
          variant="secondary"
          size="sm"
          icon={<Icon icon={NotebookPenIcon} />}
          className="w-fit"
          onClick={onEditNotes}
        />
      );
    return null;
  };

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>
          <HStack gap={2} vAlign="center">
            <Icon icon={ListChecksIcon} color="accent" />
            {t('title')}
          </HStack>
        </CardTitle>
        <CardDescription>
          {!data
            ? '…'
            : data.ready
              ? t('allPass')
              : t('progressLong', { passed: data.passed, total: data.total })}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-4">
        {error && !data ? (
          <ErrorState compact error={error} onRetry={() => refetch()} />
        ) : !data ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <Meter
              value={data.passed}
              max={data.total}
              label={t('progressLong', { passed: data.passed, total: data.total })}
              tone={data.ready ? 'success' : 'primary'}
              size="sm"
            />
            <ul className="grid gap-4">
              {data.checks.map((c) => {
                const next = c.ok ? null : action(c.key);
                return (
                  <li key={c.key} className="flex min-w-0 gap-2.5">
                    <CheckIcon ok={c.ok} />
                    <div className="grid min-w-0 flex-1 gap-1 text-sm">
                      <span className={cn('font-medium', c.ok && 'text-muted-foreground')}>
                        <span className="sr-only">{c.ok ? t('passed') : t('notPassed')}: </span>
                        {t(`checks.${c.key}`)}
                      </span>
                      <div className="min-w-0 text-muted-foreground">{detail(c.key, c.ok)}</div>
                      {next}
                    </div>
                  </li>
                );
              })}
            </ul>
            {data.changes.length > 1 && (
              <div className="grid gap-2 border-t pt-3">
                <p className="text-xs font-medium text-muted-foreground">{t('allChanges')}</p>
                <ul className="grid gap-3">
                  {data.changes.map((c) => (
                    <li key={c.id}>
                      <ChangeLine change={c} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!done && data.policy.production && (
              <div className="grid gap-2 border-t pt-3">
                <p className="text-xs font-medium text-muted-foreground">{t('policyNow')}</p>
                <PolicyExplanation
                  soft
                  decision={data.policy.production}
                  check={{
                    environment: { id: '', name: '', kind: 'production' },
                    changes: data.changes,
                    requireChange: data.policy.requireChange,
                    enforceWindow: data.policy.enforceWindow,
                    namedNotFound: false,
                  }}
                />
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
