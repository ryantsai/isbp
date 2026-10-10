'use client';

import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { DateTime } from '@isbp/ui/relative-time';
import { Label } from '@isbp/ui/label';
import { useApiMutation } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  GitCompareIcon,
  PencilLineIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import {
  type EndpointDefinition,
  type EndpointDetail,
  lineDiff,
  paramLines,
  settingLines,
  statementText,
  type VersionAction,
} from '../../contracts';
import { VersionStatusBadge } from '../badges';
import { ConfirmDialog } from '../confirm-dialog';
import { INVALIDATE } from '../lib';

const DRAFT = 'draft';

function Diff({ before, after, label }: { before: string; after: string; label: string }) {
  const t = useTranslations('etl.versions');
  const lines = useMemo(() => lineDiff(before, after), [before, after]);
  const changed = lines.some((l) => l.kind !== 'same');
  return (
    <section className="grid min-w-0 gap-1.5" aria-label={label}>
      <h3 className="text-sm font-medium">{label}</h3>
      {!changed ? (
        <p className="text-sm text-muted-foreground">{t('noChanges')}</p>
      ) : (
        <pre
          tabIndex={0}
          className="max-h-96 min-w-0 overflow-auto rounded-lg border bg-muted/20 py-2 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {lines.map((l, i) => (
            <span
              key={i}
              className={cn(
                'block px-3 whitespace-pre-wrap',
                l.kind === 'add' && 'bg-success/12 text-success',
                l.kind === 'remove' && 'bg-destructive/10 text-destructive dark:bg-destructive/20',
              )}
            >
              <span aria-hidden className="mr-2 inline-block w-3 select-none">
                {l.kind === 'add' ? '+' : l.kind === 'remove' ? '−' : ' '}
              </span>
              {l.kind !== 'same' && (
                <span className="sr-only">{t(l.kind === 'add' ? 'added' : 'removed')} </span>
              )}
              {l.text || ' '}
            </span>
          ))}
        </pre>
      )}
    </section>
  );
}

/** Published versions (deprecate, retire, restore, load into the draft) and a diff between any two. */
export function VersionsTab({ endpoint }: { endpoint: EndpointDetail }) {
  const t = useTranslations('etl.versions');
  const id = useId();
  const canManage = endpoint.viewer.canManage;
  const latest = endpoint.versions[0]?.version;
  const [from, setFrom] = useState<string>(latest === undefined ? DRAFT : String(latest));
  const [to, setTo] = useState<string>(DRAFT);
  const [confirm, setConfirm] = useState<{ version: number; action: VersionAction } | null>(null);
  const act = useApiMutation(
    (api, v: { version: number; action: VersionAction }) =>
      api.post<EndpointDetail>(`/etl/endpoints/${endpoint.id}/versions/${v.version}/${v.action}`, {}),
    {
      invalidate: INVALIDATE,
      success: () => t(`done.${confirm?.action ?? 'deprecate'}`, { version: confirm?.version ?? 0 }),
      onSuccess: () => setConfirm(null),
    },
  );
  const defOf = (key: string): EndpointDefinition =>
    (key === DRAFT
      ? endpoint.draft
      : (endpoint.versions.find((v) => String(v.version) === key)?.definition ??
        endpoint.draft)) as EndpointDefinition;
  const a = defOf(from);
  const b = defOf(to);
  const options = [
    { value: DRAFT, label: t('draft') },
    ...endpoint.versions.map((v) => ({ value: String(v.version), label: `v${v.version}` })),
  ];

  return (
    <div className="grid min-w-0 gap-4">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            {t('title')}
          </CardTitle>
          <CardDescription>{t('hint')}</CardDescription>
        </CardHeader>
        <CardContent>
          {endpoint.versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('none')}</p>
          ) : (
            <ul className="divide-y" aria-label={t('title')}>
              {endpoint.versions.map((v) => (
                <li key={v.version} className="flex min-w-0 flex-col gap-2 py-3 sm:flex-row sm:items-start">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold">v{v.version}</span>
                      <VersionStatusBadge status={v.status} />
                      {v.version === endpoint.latestVersion && v.status === 'published' && (
                        <span className="text-xs text-muted-foreground">{t('latest')}</span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t('publishedBy', { name: v.publishedBy?.name ?? '—' })} ·{' '}
                      <DateTime date={v.publishedAt} />
                    </span>
                    {v.note && <p className="text-sm wrap-anywhere">{v.note}</p>}
                  </div>
                  {canManage && (
                    <div className="flex shrink-0 flex-wrap gap-1">
                      {v.status === 'published' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setConfirm({ version: v.version, action: 'deprecate' })}
                        >
                          <TriangleAlertIcon /> {t('actions.deprecate')}
                        </Button>
                      )}
                      {v.status !== 'retired' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setConfirm({ version: v.version, action: 'retire' })}
                        >
                          <ArchiveIcon /> {t('actions.retire')}
                        </Button>
                      )}
                      {v.status !== 'published' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setConfirm({ version: v.version, action: 'restore' })}
                        >
                          <ArchiveRestoreIcon /> {t('actions.restore')}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirm({ version: v.version, action: 'load' })}
                      >
                        <PencilLineIcon /> {t('actions.load')}
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle role="heading" aria-level={2} className="flex items-center gap-2">
            <GitCompareIcon className="size-4 text-primary" aria-hidden />
            {t('compare')}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid min-w-0 gap-4">
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            {(
              [
                ['from', from, setFrom],
                ['to', to, setTo],
              ] as const
            ).map(([key, value, setter]) => (
              <div key={key} className="grid min-w-0 gap-1.5">
                <Label htmlFor={`${id}-${key}`}>{t(key)}</Label>
                <Select value={value} onValueChange={setter}>
                  <SelectTrigger id={`${id}-${key}`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          <Diff label={t('statement')} before={statementText(a)} after={statementText(b)} />
          <Diff label={t('parameters')} before={paramLines(a.params)} after={paramLines(b.params)} />
          <Diff label={t('settings')} before={settingLines(a)} after={settingLines(b)} />
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm ? t(`confirm.${confirm.action}.title`, { version: confirm.version }) : ''}
        description={confirm ? t(`confirm.${confirm.action}.body`, { version: confirm.version }) : ''}
        confirmLabel={confirm ? t(`actions.${confirm.action}`) : ''}
        destructive={confirm?.action === 'retire'}
        loading={act.isPending}
        onConfirm={() => confirm && act.mutate(confirm)}
      />
    </div>
  );
}
