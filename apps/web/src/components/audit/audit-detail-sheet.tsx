'use client';

import type { AuditLog } from '@isbp/contracts';
import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@isbp/ui/sheet';
import { FingerprintIcon, ShieldAlertIcon, ShieldCheckIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import { AuditIcon, useActionLabel } from '@/components/audit-action';
import { DateTime, RelativeTime } from '@/components/relative-time';
import { useApiMutation } from '@/lib/api';
import { ActorCell, CategoryBadge, CopyButton, OutcomeBadge, TargetCell } from './audit-parts';

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Compact one-line rendering of a JSON value. */
function compact(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

const isPrimitiveArray = (v: unknown): v is (string | number | boolean | null)[] =>
  Array.isArray(v) && v.every((x) => x === null || ['string', 'number', 'boolean'].includes(typeof x));

/** Before/after cell: arrays of primitives highlight the items that were removed/added. */
function ValueCell({ value, other, side }: { value: unknown; other: unknown; side: 'before' | 'after' }) {
  const t = useTranslations('audit.detail');
  if (value === null || value === undefined || value === '')
    return <span className="text-muted-foreground italic">{t('emptyValue')}</span>;
  if (isPrimitiveArray(value) && (isPrimitiveArray(other) || other === null || other === undefined)) {
    const others = new Set((other ?? []).map(compact));
    return (
      <span className="flex flex-wrap gap-1">
        {value.length === 0 && <span className="text-muted-foreground italic">{t('emptyList')}</span>}
        {value.map((item, i) => {
          const changed = !others.has(compact(item));
          return (
            <code
              key={i}
              className={cn(
                'rounded px-1 py-0.5 font-mono text-[11px] break-all',
                !changed && 'bg-muted text-muted-foreground',
                changed &&
                  side === 'before' &&
                  'bg-destructive/10 text-destructive line-through decoration-destructive/40',
                changed && side === 'after' && 'bg-success/12 text-success',
              )}
            >
              {changed && (
                <span className="sr-only">{side === 'before' ? t('removedItem') : t('addedItem')} </span>
              )}
              {compact(item)}
            </code>
          );
        })}
      </span>
    );
  }
  return (
    <span
      className={cn(
        'rounded px-1 py-0.5 break-words',
        typeof value === 'object' && 'font-mono text-[11px]',
        side === 'before' ? 'bg-destructive/10 text-destructive' : 'bg-success/12 text-success',
      )}
    >
      {compact(value)}
    </span>
  );
}

function ChangesTable({ changes }: { changes: NonNullable<AuditLog['changes']> }) {
  const t = useTranslations('audit.detail');
  const rows = Object.entries(changes);
  if (!rows.length) return <p className="text-sm text-muted-foreground">{t('empty')}</p>;
  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full table-fixed text-sm">
        <caption className="sr-only">{t('changes')}</caption>
        <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="w-[28%] px-3 py-2 font-medium">
              {t('field')}
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              {t('before')}
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              {t('after')}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map(([field, [before, after]]) => (
            <tr key={field} className="align-top">
              <th scope="row" className="px-3 py-2 text-left font-mono text-xs font-medium break-all">
                {field}
              </th>
              <td className="px-3 py-2">
                <ValueCell value={before} other={after} side="before" />
              </td>
              <td className="px-3 py-2">
                <ValueCell value={after} other={before} side="after" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ContextRow({ label, value, mono = true }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('min-w-0 break-all', mono && 'font-mono text-xs', !value && 'text-muted-foreground')}>
        {value || '—'}
      </dd>
      <dd>{value ? <CopyButton value={value} label={label} /> : <span className="block size-7" />}</dd>
    </div>
  );
}

function Integrity({ seq }: { seq: number }) {
  const t = useTranslations('audit.detail');
  const verify = useApiMutation((api) =>
    api.get<{ seq: number; valid: boolean; hash: string }>(`/audit-logs/${seq}/verify`),
  );
  const result = verify.data;
  return (
    <Section title={t('integrity')}>
      <p className="text-sm text-muted-foreground">{t('integrityHint')}</p>
      <Button variant="outline" size="sm" onClick={() => verify.mutate(undefined)} loading={verify.isPending}>
        {!verify.isPending && <FingerprintIcon />} {t('verify')}
      </Button>
      <div aria-live="polite">
        <AnimatePresence mode="wait">
          {result && (
            <motion.div
              key={`${result.valid}-${verify.submittedAt}`}
              role="status"
              initial={{ opacity: 0, y: 6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className={cn(
                'mt-1 flex items-start gap-3 rounded-lg border px-3 py-2.5',
                result.valid ? 'border-success/30 bg-success/10' : 'border-destructive/40 bg-destructive/10',
              )}
            >
              <motion.span
                initial={{ scale: 0.4, rotate: -20, opacity: 0 }}
                animate={{ scale: 1, rotate: 0, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 520, damping: 18, delay: 0.08 }}
                className={cn('mt-0.5 shrink-0', result.valid ? 'text-success' : 'text-destructive')}
              >
                {result.valid ? (
                  <ShieldCheckIcon className="size-5" />
                ) : (
                  <ShieldAlertIcon className="size-5" />
                )}
              </motion.span>
              <div className="min-w-0 space-y-1">
                <p className={cn('text-sm font-medium', result.valid ? 'text-success' : 'text-destructive')}>
                  {result.valid ? t('verified') : t('tampered')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('hash')} <code className="font-mono break-all">{result.hash}</code>
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Section>
  );
}

/** Right-hand sheet for one audit record: summary, field changes, metadata, request context, integrity. */
export function AuditDetailSheet({
  log,
  onOpenChange,
}: {
  log: AuditLog | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('audit');
  const tc = useTranslations('common');
  const actionLabel = useActionLabel();
  // Keep the last record so the content doesn't blank out while the sheet slides away.
  const [last, setLast] = useState(log);
  if (log && log !== last) setLast(log);
  const shown = log ?? last;

  return (
    <Sheet open={log !== null} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl" closeLabel={tc('close')}>
        {shown && (
          <>
            <SheetHeader className="gap-3 border-b pb-4">
              <div className="flex items-start gap-3 pr-8">
                <AuditIcon log={shown} className="size-10 [&_svg]:size-5" />
                <div className="min-w-0 space-y-0.5">
                  <SheetTitle className="leading-tight">{actionLabel(shown.action)}</SheetTitle>
                  <code className="block truncate font-mono text-xs text-muted-foreground">
                    {shown.action}
                  </code>
                </div>
              </div>
              <SheetDescription asChild>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <ActorCell log={shown} className="text-foreground" />
                  <span aria-hidden>·</span>
                  <DateTime date={shown.occurredAt} />
                  <span className="text-xs">
                    (<RelativeTime date={shown.occurredAt} />)
                  </span>
                </div>
              </SheetDescription>
              <div className="flex flex-wrap items-center gap-1.5">
                <OutcomeBadge outcome={shown.outcome} />
                <CategoryBadge category={shown.category} />
                <Badge variant="outline" className="font-mono font-normal text-muted-foreground">
                  {t('detail.seq', { seq: shown.seq })}
                </Badge>
              </div>
            </SheetHeader>
            <SheetBody className="space-y-6 pb-6">
              {(shown.entityType || shown.entityLabel) && (
                <Section title={t('columns.target')}>
                  <div className="rounded-lg border px-3 py-2 text-sm">
                    <TargetCell log={shown} />
                    {shown.entityLabel && shown.entityId && (
                      <code className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                        {shown.entityId}
                      </code>
                    )}
                  </div>
                </Section>
              )}

              <Section title={t('detail.changes')}>
                <ChangesTable changes={shown.changes ?? {}} />
              </Section>

              {shown.metadata && Object.keys(shown.metadata).length > 0 && (
                <Section
                  title={t('detail.metadata')}
                  aside={
                    <CopyButton
                      value={JSON.stringify(shown.metadata, null, 2)}
                      label={t('detail.metadata')}
                    />
                  }
                >
                  <pre
                    tabIndex={0}
                    aria-label={t('detail.metadata')}
                    className="max-h-64 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {JSON.stringify(shown.metadata, null, 2)}
                  </pre>
                </Section>
              )}

              <Section title={t('detail.context')}>
                <dl className="divide-y rounded-lg border px-3">
                  <ContextRow label={t('detail.eventId')} value={shown.eventId} />
                  <ContextRow label={t('detail.requestId')} value={shown.requestId} />
                  <ContextRow label={t('detail.ip')} value={shown.ip} />
                  <ContextRow label={t('detail.userAgent')} value={shown.userAgent} mono={false} />
                  <ContextRow label={t('columns.module')} value={shown.moduleId} />
                </dl>
              </Section>

              <Integrity key={shown.seq} seq={shown.seq} />
            </SheetBody>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
