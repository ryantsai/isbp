'use client';

import type { FormsHeaderSlotProps } from '@isbp/contracts';
import { PackageIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PACKS_HREF } from './lib';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';

/**
 * "Install a process pack" in the header of Administration → Forms (slot `core.forms.header`): the ready-made
 * processes are where people building forms look for them.
 */
export default function InstallPackButton(_: FormsHeaderSlotProps) {
  const t = useTranslations('assistant.list');
  return (
    <Button
      label={t('installPack')}
      variant="secondary"
      icon={<Icon icon={PackageIcon} />}
      href={PACKS_HREF}
    />
  );
}
