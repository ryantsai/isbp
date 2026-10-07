'use client';

import { Button } from '@isbp/ui/button';
import { useListState } from '@isbp/ui/data-table';
import { PageHeader } from '@isbp/ui/page-header';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@isbp/ui/sheet';
import { HistoryIcon, PlusIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { ChatPanel } from '../chat/chat-panel';
import { ConversationHistory } from '../chat/history';

/** Full-page virtual agent with the conversation history (the open conversation is `?c=` in the URL). */
export default function ChatPage() {
  const t = useTranslations('helpdesk-ai');
  const [state, set] = useListState();
  const id = typeof state.c === 'string' && state.c ? state.c : null;
  const [historyOpen, setHistoryOpen] = useState(false);
  const select = useCallback((c: string | undefined) => set({ c }), [set]);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={t('chat.title')}
        description={t('chat.description')}
        actions={
          <>
            <Button variant="outline" className="lg:hidden" onClick={() => setHistoryOpen(true)}>
              <HistoryIcon /> {t('history.title')}
            </Button>
            <Button variant="outline" onClick={() => select(undefined)}>
              <PlusIcon /> {t('history.new')}
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="hidden h-[calc(100dvh-13rem)] min-h-[30rem] lg:block">
          <ConversationHistory selected={id} onSelect={select} onNew={() => select(undefined)} />
        </aside>
        <div className="h-[calc(100dvh-13rem)] min-h-[30rem] min-w-0 overflow-hidden rounded-xl border bg-card shadow-xs">
          <ChatPanel conversationId={id} onConversationChange={select} />
        </div>
      </div>

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="left" className="gap-0 p-4" closeLabel={t('askIt.close')}>
          <SheetHeader className="p-0 pb-4">
            <SheetTitle>{t('history.title')}</SheetTitle>
          </SheetHeader>
          <ConversationHistory
            selected={id}
            onSelect={(c) => {
              select(c);
              setHistoryOpen(false);
            }}
            onNew={() => {
              select(undefined);
              setHistoryOpen(false);
            }}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}
