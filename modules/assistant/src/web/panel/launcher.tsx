'use client';

import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import type { ShellHeaderSlotProps } from '@isbp/contracts';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@isbp/ui/sheet';
import { useApiQuery } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { SparklesIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { lazy, Suspense, useState } from 'react';
import { type AssistantStatusDto, STATUS_PATH } from '../lib';
import { useAssistantChat } from './use-assistant-chat';

// The launcher appears on every page; load the chat, Markdown and template forms only on first use.
const AssistantPanel = lazy(() => import('./assistant-panel').then((m) => ({ default: m.AssistantPanel })));

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
  // Without a chat model there is nothing to describe in your own words: the header says what templates do.
  const status = useApiQuery<AssistantStatusDto>(open ? STATUS_PATH : null);

  return (
    <>
      {/* The tooltip says what it's for; the accessible name stays the short "Assistant" the guide uses. */}
      <span className="relative inline-flex">
        <IconButton
          label={t('open')}
          tooltip={t('openHint')}
          variant="ghost"
          icon={<Icon icon={SparklesIcon} />}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        />
        {chat.busy && !open && (
          <span
            aria-hidden
            className="pointer-events-none absolute top-1.5 right-1.5 size-2 rounded-full bg-primary motion-safe:animate-pulse"
          />
        )}
      </span>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full gap-0 p-0 sm:max-w-lg" closeLabel={t('close')}>
          <SheetHeader className="border-b p-4 pr-12">
            <SheetTitle className="flex items-center gap-2 text-base">
              <SparklesIcon className="size-4 text-primary" aria-hidden />
              {t('title')}
            </SheetTitle>
            <SheetDescription>
              {status.data?.mode === 'builtin' ? t('descriptionBuiltin') : t('description')}
            </SheetDescription>
          </SheetHeader>
          <Suspense fallback={<Skeleton className="m-4 h-64" />}>
            <AssistantPanel
              chat={chat}
              conversationId={conversationId}
              onConversation={setConversationId}
              templateChangeSet={templateChangeSet}
              onTemplateChangeSet={setTemplateChangeSet}
              onNavigate={() => setOpen(false)}
            />
          </Suspense>
        </SheetContent>
      </Sheet>
    </>
  );
}
