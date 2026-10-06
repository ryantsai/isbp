/** Cron presets offered for directory sync (server time zone). */
export const CRON_PRESETS = [
  { id: 'hourly', cron: '0 * * * *' },
  { id: 'every6h', cron: '0 */6 * * *' },
  { id: 'every12h', cron: '0 */12 * * *' },
  { id: 'daily', cron: '0 2 * * *' },
] as const;

export type CronShape =
  | { kind: 'everyMinutes'; n: number }
  | { kind: 'hourly' }
  | { kind: 'hourlyAt'; minute: string }
  | { kind: 'everyHours'; n: number }
  | { kind: 'dailyAt'; time: string };

const pad = (n: number) => String(n).padStart(2, '0');
const int = (s: string | undefined, max: number) =>
  s !== undefined && /^\d+$/.test(s) && Number(s) <= max ? Number(s) : null;

/** Recognises the common 5-field cron shapes so they can be described in words; `null` otherwise. */
export function parseCron(expr: string | null | undefined): CronShape | null {
  const parts = (expr ?? '').trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, mon, dow] = parts;
  if (dom !== '*' || mon !== '*' || dow !== '*') return null;
  const stepMin = /^\*\/(\d+)$/.exec(min ?? '');
  if (stepMin && hour === '*') return { kind: 'everyMinutes', n: Number(stepMin[1]) };
  const m = int(min, 59);
  if (m === null) return null;
  if (hour === '*') return m === 0 ? { kind: 'hourly' } : { kind: 'hourlyAt', minute: pad(m) };
  const stepHour = /^\*\/(\d+)$/.exec(hour ?? '');
  if (stepHour && m === 0) return { kind: 'everyHours', n: Number(stepHour[1]) };
  const h = int(hour, 23);
  if (h !== null) return { kind: 'dailyAt', time: `${pad(h)}:${pad(m)}` };
  return null;
}

/** Loose syntax check: 5 or 6 space-separated fields of cron characters. */
export function isCronLike(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  return (parts.length === 5 || parts.length === 6) && parts.every((p) => /^[\d*/,\-?LW#A-Za-z]+$/.test(p));
}
