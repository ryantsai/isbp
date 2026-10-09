'use client';

import type { FormsHeaderSlotProps } from '@isbp/contracts';
import { Button } from '@isbp/ui/button';
import { PackageIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { PACKS_HREF } from './lib';

/**
 * "Install a process pack" in the header of Administration → Forms (slot `core.forms.header`): the ready-made
 * processes are where people building forms look for them.
 */
export default function InstallPackButton(_: FormsHeaderSlotProps) {
  const t = useTranslations('assistant.list');
  return (
    <Button variant="outline" asChild>
      <Link href={PACKS_HREF}>
        <PackageIcon /> {t('installPack')}
      </Link>
    </Button>
  );
}
