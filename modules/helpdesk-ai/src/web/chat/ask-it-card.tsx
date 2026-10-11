'use client';

import { useCan } from '@isbp/sdk/web';
import { useApiQuery } from '@isbp/ui/query';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@isbp/ui/sheet';
import { MessageCircleQuestionIcon, SparklesIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { HelpdeskAiStatus } from '../../contracts';
import { ChatPanel } from './chat-panel';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';

/**
 * "Ask IT" invitation on the knowledge home (`knowledge.home.assist`): for the people the desk serves, not for its
 * agents (holders of `itsm.tickets.work`), who search the knowledge base for answers they give.
 */
export function KnowledgeAskItCard() {
  const agent = useCan('itsm.tickets.work');
  return agent ? null : <AskItCard />;
}

/** "Ask IT" invitation for the request portal (`core.requests.assist`); opens the virtual agent in a sheet. */
export default function AskItCard() {
  const t = useTranslations('helpdesk-ai');
  const status = useApiQuery<HelpdeskAiStatus>('/helpdesk-ai/status');
  const [open, setOpen] = useState(false);
  const [conversation, setConversation] = useState<string | null>(null);
  if (status.data && !status.data.virtualAgentEnabled) return null;

  return (
    <>
      <section
        aria-labelledby="hai-ask-it"
        className="relative overflow-hidden rounded-xl border bg-card p-3 sm:p-4"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/14 via-chart-4/6 to-transparent"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -top-10 -right-10 size-40 rounded-full bg-primary/15 blur-3xl"
        />
        {/* A compact tile, one row on phones too: the catalog below is what most people came for. */}
        <div className="relative flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-primary to-chart-4 text-primary-foreground shadow-sm">
            <SparklesIcon className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="hai-ask-it" className="text-sm font-semibold tracking-tight">
              {t('askIt.title')}
            </h2>
            <p className="line-clamp-2 text-xs text-muted-foreground sm:text-sm">{t('askIt.body')}</p>
          </div>
          <Button
            label={t('askIt.button')}
            variant="primary"
            size="sm"
            icon={<Icon icon={MessageCircleQuestionIcon} />}
            onClick={() => setOpen(true)}
            className="shrink-0"
          />
        </div>
      </section>

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
