'use client';

import type { ShellHeaderSlotProps } from '@isbp/contracts';
import { Button } from '@isbp/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@isbp/ui/sheet';
import { Hint } from '@isbp/ui/tooltip';
import { SparklesIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { AssistantPanel } from './assistant-panel';
import { useAssistantChat } from './use-assistant-chat';

/**
 * The assistant in the shell header (`core.shell.header`): a sparkles button on every page that opens the panel
 * in a side sheet (full width on phones). The conversation lives here, so a turn keeps streaming and the panel
 * resumes where it was after the sheet closes or the page changes.
 */
export default function AssistantLauncher(_props: ShellHeaderSlotProps) {
  const t = useTranslations('assistant.panel');
  const [open, setOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [templateChangeSet, setTemplateChangeSet] = useState<string | null>(null);
  const chat = useAssistantChat(conversationId, setConversationId);

  return (
    <>
      <Hint label={t('open')}>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={t('open')}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <SparklesIcon />
          {chat.busy && !open && (
            <span
              aria-hidden
              className="absolute top-1.5 right-1.5 size-2 rounded-full bg-primary motion-safe:animate-pulse"
            />
          )}
        </Button>
      </Hint>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full gap-0 p-0 sm:max-w-lg" closeLabel={t('close')}>
          <SheetHeader className="border-b p-4 pr-12">
            <SheetTitle className="flex items-center gap-2 text-base">
              <SparklesIcon className="size-4 text-primary" aria-hidden />
              {t('title')}
            </SheetTitle>
            <SheetDescription>{t('description')}</SheetDescription>
          </SheetHeader>
          <AssistantPanel
            chat={chat}
            conversationId={conversationId}
            onConversation={setConversationId}
            templateChangeSet={templateChangeSet}
            onTemplateChangeSet={setTemplateChangeSet}
            onNavigate={() => setOpen(false)}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
