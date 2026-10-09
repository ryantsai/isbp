/**
 * Groups failures that are the same bug: the flow, the step and the message with everything that differs per run
 * (ids, references, numbers, dates, the run's unique suffixes) replaced by placeholders.
 */

/** `REQ-01042 for 0199… took 3120 ms` → `<ref> for <id> took <n> ms`. */
export function normalizeMessage(message: string, runToken = ''): string {
  let s = message;
  if (runToken) s = s.replaceAll(new RegExp(`${escapeRe(runToken)}[a-z0-9-]*`, 'g'), '<sfx>');
  return s
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\b\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?\b/g, '<date>')
    .replace(/\b[A-Z]{2,6}-\d+\b/g, '<ref>')
    .replace(/\b\d+(\.\d+)?\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

export function failureSignature(flow: string, step: string | null, message: string, runToken = ''): string {
  return `${flow} › ${normalizeMessage(step ?? '(no step)', runToken)} › ${normalizeMessage(message, runToken)}`;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
