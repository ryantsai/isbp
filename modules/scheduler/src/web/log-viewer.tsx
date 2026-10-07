'use client';

import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { Label } from '@isbp/ui/label';
import { toast } from '@isbp/ui/sonner';
import { Switch } from '@isbp/ui/switch';
import { CopyIcon, DownloadIcon, ScrollTextIcon } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import type { LogLineDto, RunStatus } from '../contracts';
import { LOG_LEVEL, TEXT_TONE } from './badges';

/**
 * The run's log, live: Server-Sent Events from `/runs/:id/logs/stream` (`lines`, `status`, `end`). The
 * stream replays what was written so far, follows new lines while the run is going and ends with it.
 */
export function LogViewer({
  runId,
  onStatus,
  fileName,
}: {
  runId: string;
  onStatus?: (status: RunStatus) => void;
  fileName: string;
}) {
  const t = useTranslations('scheduler.log');
  const format = useFormatter();
  const id = useId();
  const [lines, setLines] = useState<LogLineDto[]>([]);
  const [live, setLive] = useState(true);
  const [follow, setFollow] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const onStatusRef = useRef(onStatus);

  useEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);

  // Mounted per run (the page keys it by run id), so state starts empty.
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const source = new EventSource(`/api/v1/scheduler/runs/${runId}/logs/stream`);
    const onLines = (e: MessageEvent<string>) => {
      try {
        const batch = JSON.parse(e.data) as LogLineDto[];
        setLines((prev) => {
          const last = prev.at(-1)?.seq ?? 0;
          const fresh = batch.filter((l) => l.seq > last);
          return fresh.length ? [...prev, ...fresh] : prev;
        });
      } catch {
        /* ignore malformed events */
      }
    };
    const onStatusEvent = (e: MessageEvent<string>) => {
      try {
        onStatusRef.current?.((JSON.parse(e.data) as { status: RunStatus }).status);
      } catch {
        /* ignore */
      }
    };
    const onEnd = (e: MessageEvent<string>) => {
      source.close();
      setLive(false);
      onStatusEvent(e);
    };
    source.addEventListener('lines', onLines as EventListener);
    source.addEventListener('status', onStatusEvent as EventListener);
    source.addEventListener('end', onEnd as EventListener);
    return () => {
      source.removeEventListener('lines', onLines as EventListener);
      source.removeEventListener('status', onStatusEvent as EventListener);
      source.removeEventListener('end', onEnd as EventListener);
      source.close();
    };
  }, [runId]);

  useEffect(() => {
    const el = box.current;
    if (follow && el) el.scrollTop = el.scrollHeight;
  }, [lines, follow]);

  const asText = () =>
    lines
      .map((l) => `${new Date(l.at).toISOString()} ${l.level.toUpperCase().padEnd(5)} ${l.message}`)
      .join('\n');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText());
      toast.success(t('copied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([`${asText()}\n`], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  return (
    <section aria-labelledby={`${id}-title`} className="min-w-0 rounded-xl border bg-card shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <ScrollTextIcon className="size-4 shrink-0 text-primary" aria-hidden />
          <h2 id={`${id}-title`} className="font-semibold">
            {t('title')}
          </h2>
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {live ? t('live', { count: lines.length }) : t('lines', { count: lines.length })}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch id={`${id}-follow`} checked={follow} onCheckedChange={setFollow} />
            <Label htmlFor={`${id}-follow`} className="text-sm font-normal">
              {t('follow')}
            </Label>
          </div>
          <Button variant="outline" size="sm" onClick={() => void copy()} disabled={!lines.length}>
            <CopyIcon /> {t('copy')}
          </Button>
          <Button variant="outline" size="sm" onClick={download} disabled={!lines.length}>
            <DownloadIcon /> {t('download')}
          </Button>
        </div>
      </div>
      <div
        ref={box}
        role="log"
        aria-live="off"
        aria-label={t('title')}
        tabIndex={0}
        className="max-h-[32rem] min-h-40 overflow-auto bg-muted/30 py-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {lines.length === 0 ? (
          <p className="px-4 py-6 text-center font-sans text-sm text-muted-foreground">
            {live ? t('waiting') : t('empty')}
          </p>
        ) : (
          <ol className="min-w-0">
            {lines.map((l) => {
              const meta = LOG_LEVEL[l.level];
              const Icon = meta.icon;
              return (
                <li
                  key={l.seq}
                  className={cn(
                    'grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-x-2 px-4 py-0.5 hover:bg-accent/40',
                    l.level === 'error' && 'bg-destructive/5',
                  )}
                >
                  <time dateTime={l.at} className="text-muted-foreground tabular-nums select-none">
                    {format.dateTime(new Date(l.at), {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </time>
                  <span
                    className={cn(
                      'inline-flex w-16 items-center gap-1 font-sans font-medium',
                      TEXT_TONE[meta.tone],
                    )}
                  >
                    <Icon className="size-3.5 shrink-0" aria-hidden />
                    {t(`level.${l.level}`)}
                  </span>
                  <span className="whitespace-pre-wrap wrap-anywhere">{l.message}</span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
