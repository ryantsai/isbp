'use client';

import type { RecordPanelSlotProps } from '@isbp/contracts';
import { Slot, useSlot } from '@isbp/sdk/web';
import { EmptyState } from '@isbp/ui/empty-state';
import { Skeleton } from '@isbp/ui/skeleton';
import { PaperclipIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * "Links & files": the platform's linked-records and attachments panels for one of our records. Whether
 * the viewer may change them comes from our record resolver (`editable`).
 */
export function LinksAndFiles({
  type,
  id,
}: {
  type: 'itam.asset' | 'itam.license' | 'itam.contract';
  id: string;
}) {
  const t = useTranslations('itam.links');
  const links = useSlot('core.record.links');
  const files = useSlot('core.record.files');
  const props: RecordPanelSlotProps = { record: { type, id } };
  if (!links.length && !files.length)
    return (
      <EmptyState icon={<PaperclipIcon />} title={t('unavailable')} description={t('unavailableHint')} />
    );
  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-2">
      <div className="min-w-0">
        <Slot
          name="core.record.links"
          props={props}
          fallback={<Skeleton className="h-40 w-full rounded-xl" />}
        />
      </div>
      <div className="min-w-0">
        <Slot
          name="core.record.files"
          props={props}
          fallback={<Skeleton className="h-40 w-full rounded-xl" />}
        />
      </div>
    </div>
  );
}
