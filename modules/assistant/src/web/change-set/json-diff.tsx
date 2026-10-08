'use client';

import { cn } from '@isbp/ui';
import { ArrowDownUpIcon, ArrowRightIcon, MinusIcon, PlusIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { isRecord } from '../lib';

/*
 * A readable, structured diff of two JSON values (an object's current and proposed configuration): every changed,
 * added and removed leaf with its path and before → after values. Arrays of objects with an `id` (workflow steps,
 * form elements) or a `key` are matched by it, so inserting a step shows one addition rather than every later
 * step as changed. Long values fold away in native <details>.
 */

type Segment = { kind: 'key'; key: string } | { kind: 'index'; index: number } | { kind: 'id'; id: string };

export interface DiffEntry {
  path: Segment[];
  kind: 'added' | 'removed' | 'changed' | 'reordered';
  before?: unknown;
  after?: unknown;
}

const MAX_ENTRIES = 150;

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => equal(x, b[i]));
  if (isRecord(a) && isRecord(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => equal(a[k], b[k]));
  }
  return false;
}

/** `id` (or `key`) of an array element, when every element has a unique one. */
function identities(list: readonly unknown[]): string[] | null {
  const ids: string[] = [];
  for (const el of list) {
    if (!isRecord(el)) return null;
    const id = typeof el.id === 'string' ? el.id : typeof el.key === 'string' ? el.key : null;
    if (id === null) return null;
    ids.push(id);
  }
  return new Set(ids).size === ids.length ? ids : null;
}

export function diffValues(before: unknown, after: unknown, path: Segment[] = [], out: DiffEntry[] = []) {
  if (equal(before, after)) return out;
  if (isRecord(before) && isRecord(after)) {
    const keys = [...Object.keys(after), ...Object.keys(before).filter((k) => !(k in after))];
    for (const key of keys) {
      const b = before[key];
      const a = after[key];
      const p: Segment[] = [...path, { kind: 'key', key }];
      if (b === undefined && a === undefined) continue;
      if (b === undefined) out.push({ path: p, kind: 'added', after: a });
      else if (a === undefined) out.push({ path: p, kind: 'removed', before: b });
      else diffValues(b, a, p, out);
    }
    return out;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const ib = identities(before);
    const ia = identities(after);
    if (ib && ia && (ib.length || ia.length)) {
      const common = ia.filter((id) => ib.includes(id));
      if (common.join('\u0000') !== ib.filter((id) => ia.includes(id)).join('\u0000'))
        out.push({ path, kind: 'reordered', before: ib, after: ia });
      for (const [i, id] of ib.entries())
        if (!ia.includes(id))
          out.push({ path: [...path, { kind: 'id', id }], kind: 'removed', before: before[i] });
      for (const [i, id] of ia.entries()) {
        const j = ib.indexOf(id);
        const p: Segment[] = [...path, { kind: 'id', id }];
        if (j < 0) out.push({ path: p, kind: 'added', after: after[i] });
        else diffValues(before[j], after[i], p, out);
      }
      return out;
    }
    const n = Math.max(before.length, after.length);
    for (let i = 0; i < n; i++) {
      const p: Segment[] = [...path, { kind: 'index', index: i }];
      if (i >= before.length) out.push({ path: p, kind: 'added', after: after[i] });
      else if (i >= after.length) out.push({ path: p, kind: 'removed', before: before[i] });
      else diffValues(before[i], after[i], p, out);
    }
    return out;
  }
  out.push({
    path,
    kind: before === undefined ? 'added' : after === undefined ? 'removed' : 'changed',
    before,
    after,
  });
  return out;
}

/** `graph.steps[manager].approvers[0].type` */
export function formatPath(path: readonly Segment[]): string {
  return path
    .map((s, i) =>
      s.kind === 'key' ? (i === 0 ? s.key : `.${s.key}`) : s.kind === 'index' ? `[${s.index}]` : `[${s.id}]`,
    )
    .join('');
}

/** One value: inline when short, folded in <details> when long or structured. */
export function ValueView({ value, className }: { value: unknown; className?: string }) {
  const t = useTranslations('assistant.diff');
  if (value === null || value === undefined || value === '')
    return <span className={cn('italic', className)}>{t('empty')}</span>;
  if (typeof value === 'boolean')
    return <code className={cn('font-mono text-xs', className)}>{value ? t('true') : t('false')}</code>;
  if (typeof value === 'number') return <code className={cn('font-mono text-xs', className)}>{value}</code>;
  const structured = typeof value === 'object';
  const text = structured ? JSON.stringify(value, null, 2) : String(value);
  const long = text.length > 140 || text.includes('\n');
  if (!long)
    return <code className={cn('font-mono text-xs break-all whitespace-pre-wrap', className)}>{text}</code>;
  const summary = Array.isArray(value)
    ? t('items', { count: value.length })
    : isRecord(value)
      ? t('fields', { count: Object.keys(value).length })
      : t('chars', { count: text.length });
  return (
    <details className={cn('group min-w-0', className)}>
      <summary className="w-fit cursor-pointer rounded-sm text-xs font-medium text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50">
        {t('show', { summary })}
      </summary>
      <pre
        tabIndex={0}
        className="mt-1.5 max-h-80 overflow-auto rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 bg-muted/60 p-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all"
      >
        {text}
      </pre>
    </details>
  );
}

const KIND_META = {
  added: { icon: PlusIcon, row: 'bg-success/6', text: 'text-success' },
  removed: { icon: MinusIcon, row: 'bg-destructive/6', text: 'text-destructive' },
  changed: { icon: ArrowRightIcon, row: 'bg-info/6', text: 'text-info' },
  reordered: { icon: ArrowDownUpIcon, row: 'bg-info/6', text: 'text-info' },
} as const;

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)] items-baseline gap-2">
      <span className="text-xs font-medium">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * The differences between `before` and `after` as a list (one row per changed leaf). `labels` names the two sides
 * ("Current" → "Proposed", or "Before" → "After" once applied).
 */
export function JsonDiff({
  before,
  after,
  labels,
}: {
  before: unknown;
  after: unknown;
  labels: { before: string; after: string };
}) {
  const t = useTranslations('assistant.diff');
  const entries = diffValues(before, after);
  if (!entries.length) return <p className="text-sm text-muted-foreground">{t('none')}</p>;
  const shown = entries.slice(0, MAX_ENTRIES);
  return (
    <div className="grid gap-2">
      <ul className="grid gap-1.5" aria-label={t('label', { before: labels.before, after: labels.after })}>
        {shown.map((e, i) => {
          const meta = KIND_META[e.kind];
          const Icon = meta.icon;
          const path = formatPath(e.path) || t('root');
          return (
            <li
              key={`${path}-${e.kind}-${i}`}
              className={cn('grid min-w-0 gap-1.5 rounded-md px-3 py-2', meta.row)}
            >
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className={cn('inline-flex items-center gap-1 text-xs font-medium', meta.text)}>
                  <Icon className="size-3.5 shrink-0" aria-hidden />
                  {t(e.kind)}
                </span>
                <code className="min-w-0 font-mono text-xs font-medium break-all">{path}</code>
              </div>
              {e.kind === 'reordered' ? (
                <>
                  <Labelled label={labels.before}>
                    <code className="font-mono text-xs break-all">{(e.before as string[]).join(', ')}</code>
                  </Labelled>
                  <Labelled label={labels.after}>
                    <code className="font-mono text-xs break-all">{(e.after as string[]).join(', ')}</code>
                  </Labelled>
                </>
              ) : (
                <>
                  {e.kind !== 'added' && (
                    <Labelled label={labels.before}>
                      <ValueView
                        value={e.before}
                        className={e.kind === 'removed' ? 'line-through' : undefined}
                      />
                    </Labelled>
                  )}
                  {e.kind !== 'removed' && (
                    <Labelled label={labels.after}>
                      <ValueView value={e.after} />
                    </Labelled>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
      {entries.length > shown.length && (
        <p className="text-xs text-muted-foreground">{t('more', { count: entries.length - shown.length })}</p>
      )}
    </div>
  );
}

/** A whole value (a proposed create) as its top-level fields. */
export function ValueFields({ value }: { value: unknown }) {
  const t = useTranslations('assistant.diff');
  if (!isRecord(value)) return <ValueView value={value} />;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined);
  if (!keys.length) return <p className="text-sm text-muted-foreground">{t('emptyValue')}</p>;
  return (
    <dl className="grid gap-1.5">
      {keys.map((k) => (
        <div
          key={k}
          className="grid min-w-0 grid-cols-1 gap-1 rounded-md bg-success/6 px-3 py-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)] sm:gap-3"
        >
          <dt className="min-w-0 font-mono text-xs font-medium break-all">{k}</dt>
          <dd className="min-w-0">
            <ValueView value={value[k]} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
