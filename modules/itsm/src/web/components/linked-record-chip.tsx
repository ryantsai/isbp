'use client';

import type { ResolvedRecordInfo } from '@isbp/contracts';
import { useApiQuery } from '@isbp/ui/query';
import { LinkIcon, XIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Icon } from '@astryxdesign/core/Icon';

/**
 * The record a new ticket will be linked to (from `?link=<type>:<id>`, e.g. the asset behind "Report a
 * problem" or the release behind "Raise a change"), with a way to drop the link.
 */
export function LinkedRecordChip({
  record,
  onRemove,
}: {
  record: { type: string; id: string };
  onRemove: () => void;
}) {
  const t = useTranslations('itsm.common');
  const root = useTranslations();
  const { data, isError } = useApiQuery<ResolvedRecordInfo>(`/records/${record.type}/${record.id}`);
  // A record the person can't see (or that no longer exists) is simply not linked.
  useEffect(() => {
    if (isError) onRemove();
  }, [isError, onRemove]);
  if (isError) return null;
  const status = data?.status && root.has(data.status.key) ? root(data.status.key) : null;
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
      <LinkIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="shrink-0 text-muted-foreground">{t('linkedTo')}</span>
      <span className="min-w-0 flex-1 truncate font-medium">
        {data ? (
          <>
            {data.reference && (
              <span className="mr-1.5 font-mono text-xs text-muted-foreground">{data.reference}</span>
            )}{' '}
            {data.title}
            {status && <span className="ml-1.5 text-xs font-normal text-muted-foreground">· {status}</span>}
          </>
        ) : (
          '…'
        )}
      </span>
      <IconButton
        label={t('unlink')}
        variant="ghost"
        size="sm"
        icon={<Icon icon={XIcon} />}
        type="button"
        className="shrink-0 text-muted-foreground"
        onClick={onRemove}
      />
    </div>
  );
}
