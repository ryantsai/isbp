'use client';

import type { DbConnectionDto, DbTestResult } from '@isbp/contracts';
import { Badge } from '@isbp/ui/badge';
import { CheckCircle2Icon, CircleDashedIcon, LockIcon, PauseCircleIcon, XCircleIcon } from 'lucide-react';
import { useFormatter, useNow, useTranslations } from 'next-intl';

export type DbConnection = DbConnectionDto & { lastCheckedAt: string | null };

export function EngineBadge({ engine }: { engine: DbConnection['engine'] }) {
  const t = useTranslations('databases.engines');
  return (
    <Badge variant="outline" className="font-normal">
      {t(engine)}
    </Badge>
  );
}

export function PurposeBadges({
  purposes,
  readOnly,
}: {
  purposes: DbConnection['purposes'];
  readOnly: boolean;
}) {
  const t = useTranslations('databases');
  return (
    <span className="flex flex-wrap items-center gap-1">
      {purposes.map((p) => (
        <Badge key={p} variant={p === 'admin' ? 'warning' : 'info'}>
          {t(`purposes.${p}`)}
        </Badge>
      ))}
      {readOnly && (
        <Badge variant="muted">
          <LockIcon aria-hidden />
          {t('readOnly')}
        </Badge>
      )}
    </span>
  );
}

/** Status with an icon and words (never colour alone), plus when it was last checked. */
export function ConnectionStatus({ connection }: { connection: DbConnection }) {
  const t = useTranslations('databases.status');
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const { status, enabled, lastCheckedAt } = connection;
  const [Icon, label, tone] = !enabled
    ? [PauseCircleIcon, t('disabled'), 'text-muted-foreground']
    : status === 'ok'
      ? [CheckCircle2Icon, t('ok'), 'text-success']
      : status === 'error'
        ? [XCircleIcon, t('error'), 'text-destructive']
        : [CircleDashedIcon, t('unknown'), 'text-muted-foreground'];
  return (
    <span className="block min-w-0">
      <span className={`flex items-center gap-1.5 font-medium ${tone}`}>
        <Icon className="size-4 shrink-0" aria-hidden />
        {label}
      </span>
      {lastCheckedAt && (
        <span className="block text-xs text-muted-foreground">
          {t('checked', { when: format.relativeTime(new Date(lastCheckedAt), now) })}
        </span>
      )}
    </span>
  );
}

/** Outcome of "Test connection": latency and version, or the server's error code and message. */
export function TestResultNote({ result }: { result: DbTestResult }) {
  const t = useTranslations('databases.test');
  if (result.ok)
    return (
      <div
        role="status"
        className="flex items-start gap-2 rounded-md border border-success/30 bg-success/8 px-3 py-2 text-sm"
      >
        <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
        <div className="min-w-0">
          <p className="font-medium">{t('ok', { ms: result.latencyMs ?? 0 })}</p>
          {result.version && (
            <p className="break-words text-xs text-muted-foreground">
              {t('version', { version: result.version })}
            </p>
          )}
        </div>
      </div>
    );
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm"
    >
      <XCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
      <div className="min-w-0">
        <p className="font-medium text-destructive">{t('failed')}</p>
        {result.error?.dbCode && (
          <p className="text-xs text-muted-foreground">{t('code', { code: result.error.dbCode })}</p>
        )}
        {result.error?.message && <p className="break-words font-mono text-xs">{result.error.message}</p>}
      </div>
    </div>
  );
}
