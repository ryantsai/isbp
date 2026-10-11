'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { toast } from '@isbp/ui/toast';
import { CopyIcon, ExternalLinkIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';

/**
 * "Version 2 is live": shown under the builder's header right after publishing, with the form's address, a copy
 * button and a link to the portal — the next thing people do after publishing is share it.
 */
export function PublishSuccess({
  open,
  version,
  audience,
  href,
  live,
  onClose,
}: {
  open: boolean;
  version: number;
  /** "Everyone", "2 groups". */
  audience: string;
  href: string;
  /** Turned off forms are published but nobody sees them. */
  live: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('forms.builder.success');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(new URL(href, window.location.origin).toString());
      toast.success(t('copied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  };
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className="overflow-hidden"
        >
          <Banner
            status="success"
            title={live ? t('title', { version, audience }) : t('titleOff', { version })}
            description={
              <Text type="code" maxLines={1}>
                {href}
              </Text>
            }
            collapsible={false}
            isDismissable
            dismissLabel={t('dismiss')}
            onDismiss={onClose}
            endContent={
              <HStack gap={2} wrap="wrap">
                <Button
                  label={t('copy')}
                  variant="secondary"
                  size="sm"
                  icon={<Icon icon={CopyIcon} />}
                  onClick={() => void copy()}
                />
                {live && (
                  <Button
                    label={t('open')}
                    variant="secondary"
                    size="sm"
                    icon={<Icon icon={ExternalLinkIcon} />}
                    href={href}
                  />
                )}
              </HStack>
            }
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
