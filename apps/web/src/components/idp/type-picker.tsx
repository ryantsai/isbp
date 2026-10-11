'use client';

import { FormDialog } from '@isbp/ui/form-dialog';
import { easeOut } from '@isbp/ui/motion';
import { ChevronRightIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { IDP_CHOICES, type IdpChoice, IdpTypeTile } from './idp-meta';
import { Badge } from '@astryxdesign/core/Badge';
import { ClickableCard } from '@astryxdesign/core/ClickableCard';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';

/** Step 1 of adding a provider: pick the kind. */
export function TypePickerDialog({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (choice: IdpChoice) => void;
}) {
  const t = useTranslations('idp');
  return (
    <FormDialog
      isOpen={open}
      onOpenChange={onOpenChange}
      title={t('create.chooseTitle')}
      subtitle={t('create.chooseDescription')}
      size="xl"
    >
      <VStack gap={3}>
        <Text type="supporting" color="secondary">
          {t('create.step', { step: 1, total: 2 })}
        </Text>
        <ul className="grid gap-3 sm:grid-cols-2">
          {IDP_CHOICES.map((choice, i) => (
            <motion.li
              key={choice}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: easeOut, delay: 0.04 * i }}
            >
              <ClickableCard
                label={t(`choices.${choice}.title`)}
                height="100%"
                onClick={() => onPick(choice)}
              >
                <HStack gap={3} vAlign="start">
                  <IdpTypeTile choice={choice} />
                  <StackItem size="fill">
                    <VStack gap={1}>
                      <HStack gap={2} wrap="wrap" vAlign="center">
                        <Text weight="medium">{t(`choices.${choice}.title`)}</Text>
                        {choice === 'entra' && <Badge variant="info" label={t('choices.preset')} />}
                      </HStack>
                      <Text type="supporting" color="secondary">
                        {t(`choices.${choice}.description`)}
                      </Text>
                    </VStack>
                  </StackItem>
                  <Icon icon={ChevronRightIcon} color="secondary" />
                </HStack>
              </ClickableCard>
            </motion.li>
          ))}
        </ul>
      </VStack>
    </FormDialog>
  );
}
