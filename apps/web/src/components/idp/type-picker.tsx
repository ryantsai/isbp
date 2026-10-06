'use client';

import { Badge } from '@isbp/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@isbp/ui/dialog';
import { easeOut } from '@isbp/ui/motion';
import { ChevronRightIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { IDP_CHOICES, type IdpChoice, IdpTypeTile } from './idp-meta';

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
  const tc = useTranslations('common');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" closeLabel={tc('close')}>
        <DialogHeader>
          <p className="text-xs font-medium text-muted-foreground">
            {t('create.step', { step: 1, total: 2 })}
          </p>
          <DialogTitle>{t('create.chooseTitle')}</DialogTitle>
          <DialogDescription>{t('create.chooseDescription')}</DialogDescription>
        </DialogHeader>
        <ul className="grid gap-3 sm:grid-cols-2">
          {IDP_CHOICES.map((choice, i) => (
            <motion.li
              key={choice}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: easeOut, delay: 0.04 * i }}
            >
              <motion.button
                type="button"
                onClick={() => onPick(choice)}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.98 }}
                className="group flex h-full w-full items-start gap-3 rounded-xl border bg-card p-4 text-left shadow-xs transition-[border-color,box-shadow] outline-none hover:border-primary/40 hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <IdpTypeTile choice={choice} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {t(`choices.${choice}.title`)}
                    {choice === 'entra' && <Badge variant="info">{t('choices.preset')}</Badge>}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {t(`choices.${choice}.description`)}
                  </span>
                </span>
                <ChevronRightIcon
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5"
                  aria-hidden
                />
              </motion.button>
            </motion.li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
