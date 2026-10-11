'use client';

import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { List, ListItem } from '@astryxdesign/core/List';
import type { AuditLog } from '@isbp/contracts';
import type { Page } from '@isbp/sdk';
import { Card, CardContent, CardDescription, CardHeader } from '@isbp/ui/card';
import { EmptyState, ErrorState } from '@isbp/ui/empty-state';
import { Skeleton } from '@isbp/ui/skeleton';
import { ArrowRightIcon, HistoryIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { AuditIcon, useActionLabel } from '@/components/audit-action';
import { RelativeTime } from '@/components/relative-time';
import { useApiQuery } from '@/lib/api';
import { AuditDetailSheet } from './audit-detail-sheet';
import { useAuditText } from './audit-text';

/**
 * The Activity tab of a person, group or role (and the history of a form or an approval workflow): the latest audit
 * entries about it, newest first, each opening the full record. `subject` decides the query (a person's own record
 * and the changes that list them; a role's own changes and its grants) and how each line reads.
 */
export function ActivityFeed({
  subject,
  description,
}: {
  subject: { type: 'user' | 'group' | 'role' | 'form' | 'workflow'; id: string };
  description: string;
}) {
  const t = useTranslations('audit.activity');
  const actionLabel = useActionLabel();
  const text = useAuditText();
  const [open, setOpen] = useState<AuditLog | null>(null);
  const query: Record<string, string> =
    subject.type === 'user'
      ? { userId: subject.id }
      : subject.type === 'role'
        ? { roleId: subject.id }
        : {
            entityType: subject.type === 'workflow' ? 'workflow_definition' : subject.type,
            entityId: subject.id,
          };
  const about =
    subject.type === 'user' || subject.type === 'group' || subject.type === 'role'
      ? { type: subject.type, id: subject.id }
      : undefined;
  const { data, isLoading, error, refetch } = useApiQuery<Page<AuditLog>>('/audit-logs', {
    ...query,
    pageSize: 20,
  });
  const items = data?.items ?? [];
  const more = (data?.total ?? 0) > items.length;
  const auditHref = `/admin/audit?${new URLSearchParams(query)}`;

  return (
    <Card>
      <CardHeader>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : error ? (
          <ErrorState error={error} onRetry={() => void refetch()} kind="section" compact />
        ) : items.length === 0 ? (
          <EmptyState icon={<HistoryIcon />} title={t('empty')} variant="compact" />
        ) : (
          <List hasDividers>
            {items.map((log) => (
              <ListItem
                key={log.seq}
                label={`${log.actorName ?? t('system')} ${actionLabel(log.action)}`}
                description={text.summary(log, about) || undefined}
                startContent={<AuditIcon log={log} />}
                endContent={<RelativeTime date={log.occurredAt} className="text-xs text-muted-foreground" />}
                onClick={() => setOpen(log)}
              />
            ))}
          </List>
        )}
        {(more || items.length > 0) && (
          <div className="mt-2">
            <Button
              label={t('openAuditLog')}
              variant="ghost"
              size="sm"
              endContent={<Icon icon={ArrowRightIcon} />}
              href={auditHref}
            />
          </div>
        )}
      </CardContent>
      <AuditDetailSheet log={open} onOpenChange={(o) => !o && setOpen(null)} />
    </Card>
  );
}
