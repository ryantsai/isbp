'use client';

import { RunLog } from '@isbp/ui/run-detail';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LogLineDto, RunStatus } from '../contracts';

/**
 * The run's log, live: Server-Sent Events from `/runs/:id/logs/stream` (`lines`, `status`, `end`). The
 * stream replays what was written so far, follows new lines while the run is going and ends with it. Shown with
 * the shared run log (level filter, follow, copy, download).
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
  const [lines, setLines] = useState<LogLineDto[]>([]);
  const [live, setLive] = useState(true);
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

  const shown = useMemo(
    () => lines.map((l) => ({ key: l.seq, at: String(l.at), level: l.level, message: l.message })),
    [lines],
  );
  return <RunLog lines={shown} live={live} fileName={fileName} />;
}
