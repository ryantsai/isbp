'use client';

import { Button } from '@isbp/ui/button';
import { useApiQuery } from '@isbp/ui/query';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@isbp/ui/sheet';
import { MessageCircleQuestionIcon, SparklesIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { HelpdeskAiStatus } from '../../contracts';
import { ChatPanel } from './chat-panel';

/**
 * "Ask IT" invitation for the request portal (`core.requests.assist`) and the knowledge home
 * (`knowledge.home.assist`); opens the virtual agent in a sheet.
 */
export default function AskItCard() {
  const t = useTranslations('helpdesk-ai');
  const status = useApiQuery<HelpdeskAiStatus>('/helpdesk-ai/status');
  const [open, setOpen] = useState(false);
  const [conversation, setConversation] = useState<string | null>(null);
  if (status.data && !status.data.virtualAgentEnabled) return null;

  return (
    <>
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        aria-labelledby="hai-ask-it"
        className="relative overflow-hidden rounded-xl border bg-card p-5 shadow-xs"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/14 via-chart-4/6 to-transparent"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -top-10 -right-10 size-40 rounded-full bg-primary/15 blur-3xl"
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary to-chart-4 text-primary-foreground shadow-md">
            <SparklesIcon className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <h2 id="hai-ask-it" className="text-base font-semibold tracking-tight">
              {t('askIt.title')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('askIt.body')}</p>
          </div>
          <Button onClick={() => setOpen(true)} className="shrink-0">
            <MessageCircleQuestionIcon /> {t('askIt.button')}
          </Button>
        </div>
      </motion.section>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="gap-0 p-0 sm:max-w-lg" closeLabel={t('askIt.close')}>
          <SheetHeader className="border-b p-4 pr-12">
            <SheetTitle className="flex items-center gap-2">
              <SparklesIcon className="size-4 text-primary" aria-hidden /> {t('askIt.title')}
            </SheetTitle>
            <SheetDescription>{t('askIt.sheetDescription')}</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1">
            <ChatPanel conversationId={conversation} onConversationChange={setConversation} variant="sheet" />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
