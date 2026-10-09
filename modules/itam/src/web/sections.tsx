'use client';

import { useCan } from '@isbp/sdk/web';
import { type SectionTab, SectionTabs } from '@isbp/ui/section-tabs';
import { useTranslations } from 'next-intl';

/**
 * Software is one area with three sections — licences, the approved list and installed software (discovery) — so
 * the questions "are we licensed?" and "is it allowed?" are answered in one place. Each tab is its own page.
 */
export function SoftwareSections() {
  const t = useTranslations('itam.sections');
  const software = useCan('itam.software.read');
  const discovery = useCan('itam.hardware.manage');
  const items: SectionTab[] = [
    ...(software
      ? [
          { href: '/itam/software', label: t('licences') },
          { href: '/itam/approved-software', label: t('approved') },
        ]
      : []),
    ...(discovery ? [{ href: '/itam/discovery', label: t('installed') }] : []),
  ];
  if (items.length < 2) return null;
  return <SectionTabs label={t('software')} items={items} />;
}

/** Contracts and the vendors they are with: one area, two sections. */
export function ContractSections() {
  const t = useTranslations('itam.sections');
  return (
    <SectionTabs
      label={t('contracts')}
      items={[
        { href: '/itam/contracts', label: t('contractList') },
        { href: '/itam/vendors', label: t('vendors') },
      ]}
    />
  );
}
