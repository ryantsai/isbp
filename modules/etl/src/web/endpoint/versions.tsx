'use client';

import { Button } from '@astryxdesign/core/Button';
import { Grid } from '@astryxdesign/core/Grid';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { cn } from '@isbp/ui';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { useApiMutation } from '@isbp/ui/query';
import { DateTime } from '@isbp/ui/relative-time';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  GitCompareIcon,
  PencilLineIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
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
    <VStack as="section" gap={1.5} className="min-w-0" aria-label={label}>
      <Text type="label" as="div" role="heading" aria-level={3}>
        {label}
      </Text>
      {!changed ? (
        <Text color="secondary">{t('noChanges')}</Text>
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
    </VStack>
  );
}

/** Published versions (deprecate, retire, restore, load into the draft) and a diff between any two. */
export function VersionsTab({ endpoint }: { endpoint: EndpointDetail }) {
  const t = useTranslations('etl.versions');
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
            <Text color="secondary">{t('none')}</Text>
          ) : (
            <List hasDividers aria-label={t('title')}>
              {endpoint.versions.map((v) => (
                <ListItem
                  key={v.version}
                  label={`v${v.version}`}
                  description={
                    <VStack gap={1}>
                      <Text type="supporting">
                        {t('publishedBy', { name: v.publishedBy?.name ?? '—' })} ·{' '}
                        <DateTime date={v.publishedAt} />
                      </Text>
                      {v.note && (
                        <Text as="p" display="block" className="wrap-anywhere">
                          {v.note}
                        </Text>
                      )}
                    </VStack>
                  }
                  endContent={
                    <HStack gap={2} wrap="wrap" vAlign="center" hAlign="end">
                      <VersionStatusBadge status={v.status} />
                      {v.version === endpoint.latestVersion && v.status === 'published' && (
                        <Text type="supporting">{t('latest')}</Text>
                      )}
                      {canManage && v.status === 'published' && (
                        <Button
                          label={t('actions.deprecate')}
                          variant="secondary"
                          size="sm"
                          icon={<Icon icon={TriangleAlertIcon} />}
                          onClick={() => setConfirm({ version: v.version, action: 'deprecate' })}
                        />
                      )}
                      {canManage && v.status !== 'retired' && (
                        <Button
                          label={t('actions.retire')}
                          variant="secondary"
                          size="sm"
                          icon={<Icon icon={ArchiveIcon} />}
                          onClick={() => setConfirm({ version: v.version, action: 'retire' })}
                        />
                      )}
                      {canManage && v.status !== 'published' && (
                        <Button
                          label={t('actions.restore')}
                          variant="secondary"
                          size="sm"
                          icon={<Icon icon={ArchiveRestoreIcon} />}
                          onClick={() => setConfirm({ version: v.version, action: 'restore' })}
                        />
                      )}
                      {canManage && (
                        <Button
                          label={t('actions.load')}
                          variant="ghost"
                          size="sm"
                          icon={<Icon icon={PencilLineIcon} />}
                          onClick={() => setConfirm({ version: v.version, action: 'load' })}
                        />
                      )}
                    </HStack>
                  }
                />
              ))}
            </List>
          )}
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            <HStack gap={2} vAlign="center">
              <Icon icon={GitCompareIcon} color="accent" />
              {t('compare')}
            </HStack>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid min-w-0 gap-4">
          <Grid columns={{ minWidth: 200 }} gap={3}>
            <Selector label={t('from')} options={options} value={from} onChange={setFrom} />
            <Selector label={t('to')} options={options} value={to} onChange={setTo} />
          </Grid>
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
