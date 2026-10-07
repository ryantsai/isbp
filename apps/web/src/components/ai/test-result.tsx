'use client';

import type { AiTestResult } from '@isbp/contracts';
import { Button } from '@isbp/ui/button';
import { cn } from '@isbp/ui';
import { CircleCheckIcon, CircleMinusIcon, CircleXIcon, PlugZapIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { modelLabel } from './ai-meta';

export type TestState = { result: AiTestResult } | { error: string } | null;

/** "Test connection" for one card, with its ok / error result (icon + text), latency and dimensions. */
export function TestConnection({
  section,
  state,
  pending,
  blocked,
  onTest,
}: {
  section: 'chat' | 'embeddings';
  state: TestState;
  pending: boolean;
  /** Why the test can't run now (unsaved changes, nothing to test), or null. */
  blocked: string | null;
  onTest: () => void;
}) {
  const t = useTranslations('ai.models.test');
  const id = useId();
  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={Boolean(blocked)}
          loading={pending}
          onClick={onTest}
          aria-describedby={blocked ? `${id}-blocked` : undefined}
          className="self-start"
        >
          {!pending && <PlugZapIcon />} {t('button')}
        </Button>
        {blocked && (
          <span id={`${id}-blocked`} className="text-xs text-muted-foreground">
            {blocked}
          </span>
        )}
      </div>
      <div aria-live="polite">
        <AnimatePresence initial={false} mode="wait">
          {state && (
            <motion.div
              key={JSON.stringify(state)}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <ResultLine section={section} state={state} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function ResultLine({ section, state }: { section: 'chat' | 'embeddings'; state: NonNullable<TestState> }) {
  const t = useTranslations('ai.models.test');
  if ('error' in state) return <Box tone="error" title={t('failed')} detail={state.error} />;
  if (section === 'chat') {
    const r = state.result.chat;
    // Builtin mode: the gateway has no chat model to call.
    if (!r.ok && !r.error && r.model === null) return <Box tone="muted" title={t('nothingToTest')} />;
    const facts = [r.model && modelLabel(r.model), t('latency', { ms: r.latencyMs })].filter(Boolean);
    return r.ok ? (
      <Box tone="ok" title={t('ok')} facts={facts as string[]} />
    ) : (
      <Box tone="error" title={t('failed')} facts={facts as string[]} detail={r.error} />
    );
  }
  const r = state.result.embeddings;
  return r.ok ? (
    <Box
      tone="ok"
      title={t('ok')}
      facts={[t('dimensions', { count: r.dimensions }), t('latency', { ms: r.latencyMs })]}
    />
  ) : (
    <Box tone="error" title={t('failed')} facts={[t('latency', { ms: r.latencyMs })]} detail={r.error} />
  );
}

function Box({
  tone,
  title,
  facts = [],
  detail,
}: {
  tone: 'ok' | 'error' | 'muted';
  title: string;
  facts?: string[];
  detail?: string | null;
}) {
  const Icon = tone === 'ok' ? CircleCheckIcon : tone === 'error' ? CircleXIcon : CircleMinusIcon;
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm',
        tone === 'ok' && 'bg-success/10',
        tone === 'error' && 'bg-destructive/8',
        tone === 'muted' && 'bg-muted/60',
      )}
    >
      <Icon
        className={cn(
          'mt-0.5 size-4 shrink-0',
          tone === 'ok' && 'text-success',
          tone === 'error' && 'text-destructive',
          tone === 'muted' && 'text-muted-foreground',
        )}
        aria-hidden
      />
      <div className="min-w-0">
        <p className="font-medium">
          {title}
          {facts.map((f) => (
            <span key={f} className="font-normal text-muted-foreground">
              {' · '}
              {f}
            </span>
          ))}
        </p>
        {detail && <p className="mt-0.5 font-mono text-xs break-words text-muted-foreground">{detail}</p>}
      </div>
    </div>
  );
}
