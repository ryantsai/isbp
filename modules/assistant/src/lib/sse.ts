import type { ChatStreamEvent } from '../contracts';

/** One Server-Sent Event frame. JSON never contains raw newlines, so `data` is a single line. */
export function formatSse<E extends ChatStreamEvent>(event: E['event'], data: E['data']): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export interface RawSseEvent {
  event: string;
  data: string;
}

/**
 * Incremental `text/event-stream` parser (frames may be split across network chunks). Comment lines
 * (`: ping`) and `retry:` are ignored; multiple `data:` lines are joined with newlines.
 */
export function createSseParser(onEvent: (e: RawSseEvent) => void) {
  let buffer = '';
  const dispatch = (block: string) => {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const i = line.indexOf(':');
      const field = i < 0 ? line : line.slice(0, i);
      const value = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (data.length) onEvent({ event, data: data.join('\n') });
  };
  return {
    push(chunk: string) {
      buffer += chunk.replace(/\r\n?/g, '\n');
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        dispatch(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
      }
    },
    /** Dispatches a final frame that was not terminated by a blank line. */
    flush() {
      if (buffer.trim()) dispatch(buffer);
      buffer = '';
    },
  };
}

const EVENTS: ChatStreamEvent['event'][] = ['delta', 'tool', 'change_set', 'confirm', 'done', 'error'];
const KNOWN = new Set<string>(EVENTS);

/** A typed chat event, or null for unknown events and malformed JSON. */
export function toChatEvent(raw: RawSseEvent): ChatStreamEvent | null {
  if (!KNOWN.has(raw.event)) return null;
  try {
    return { event: raw.event, data: JSON.parse(raw.data) } as ChatStreamEvent;
  } catch {
    return null;
  }
}
