'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CodeBlock } from '@astryxdesign/core/CodeBlock';
import { Icon } from '@astryxdesign/core/Icon';
import { proportional, Table } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import type { AuditLog } from '@isbp/contracts';
import { cn } from '@isbp/ui';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@isbp/ui/sheet';
import { FingerprintIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import { AuditIcon, useActionLabel } from '@/components/audit-action';
import { DateTime, RelativeTime } from '@/components/relative-time';
import { useApiMutation } from '@/lib/api';
import { ActorCell, CategoryBadge, CopyButton, OutcomeBadge, TargetCell } from './audit-parts';
import { useAuditText } from './audit-text';

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="m-0">
          <Text type="label" color="secondary">
            {title}
          </Text>
        </h3>
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

/** Before/after cell: arrays of primitives highlight the items that were removed/added; ids show as names. */
function ValueCell({
  log,
  field,
  value,
  other,
  side,
}: {
  log: AuditLog;
  field: string;
  value: unknown;
  other: unknown;
  side: 'before' | 'after';
}) {
  const t = useTranslations('audit.detail');
  const text = useAuditText();
  if (value === null || value === undefined || value === '')
    return <span className="text-muted-foreground">—</span>;
  if (isPrimitiveArray(value) && (isPrimitiveArray(other) || other === null || other === undefined)) {
    const others = new Set((other ?? []).map(compact));
    return (
      <span className="flex flex-wrap gap-1">
        {value.length === 0 && <span className="text-muted-foreground italic">{t('emptyList')}</span>}
        {value.map((item, i) => {
          const changed = !others.has(compact(item));
          const shown = text.valueText(log, field, item);
          const named = shown !== null && shown !== compact(item);
          return (
            <span
              key={i}
              className={cn(
                'rounded px-1 py-0.5 text-[11px] break-all',
                !named && 'font-mono',
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
              {shown ?? compact(item)}
            </span>
          );
        })}
      </span>
    );
  }
  const shown = text.valueText(log, field, value);
  return (
    <span
      className={cn(
        'rounded px-1 py-0.5 break-words',
        shown === null && 'font-mono text-[11px]',
        side === 'before' ? 'bg-destructive/10 text-destructive' : 'bg-success/12 text-success',
      )}
    >
      {shown ?? compact(value)}
    </span>
  );
}

function ChangesTable({ log }: { log: AuditLog }) {
  const t = useTranslations('audit.detail');
  const text = useAuditText();
  const rows = Object.entries(log.changes ?? {}).map(([field, [before, after]]) => ({
    field,
    before,
    after,
  }));
  if (!rows.length)
    return (
      <Text as="p" display="block" color="secondary">
        {t('empty')}
      </Text>
    );
  return (
    <Table
      aria-label={t('changes')}
      density="compact"
      idKey="field"
      data={rows}
      columns={[
        {
          key: 'field',
          header: t('field'),
          width: proportional(3, { minWidth: 100 }),
          renderCell: (r) => {
            const label = text.fieldLabel(r.field);
            return label ? (
              <Text weight="medium">{label}</Text>
            ) : (
              <Text type="code" wordBreak="break-all">
                {r.field}
              </Text>
            );
          },
        },
        {
          key: 'before',
          header: t('before'),
          width: proportional(5, { minWidth: 120 }),
          renderCell: (r) => (
            <ValueCell log={log} field={r.field} value={r.before} other={r.after} side="before" />
          ),
        },
        {
          key: 'after',
          header: t('after'),
          width: proportional(5, { minWidth: 120 }),
          renderCell: (r) => (
            <ValueCell log={log} field={r.field} value={r.after} other={r.before} side="after" />
          ),
        },
      ]}
    />
  );
}

/** Details that name things (groups joined, roles removed, people added), as names. The JSON follows. */
function NamedDetails({ log }: { log: AuditLog }) {
  const text = useAuditText();
  const rows = Object.entries(log.metadata ?? {}).flatMap(([key, value]) => {
    const label = text.fieldLabel(key);
    const items = Array.isArray(value) ? value : [value];
    if (!label || !items.length) return [];
    const names = items.map((v) => text.refName(log, v)).filter((n): n is string => Boolean(n));
    return names.length === items.length ? [{ key, label, names }] : [];
  });
  if (!rows.length) return null;
  return (
    <dl className="divide-y rounded-lg border px-3 text-sm">
      {rows.map((r) => (
        <div key={r.key} className="grid grid-cols-[minmax(0,8rem)_1fr] gap-2 py-1.5">
          <dt className="text-muted-foreground">{r.label}</dt>
          <dd className="min-w-0 wrap-break-word">{r.names.join(', ')}</dd>
        </div>
      ))}
    </dl>
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
      <Text as="p" display="block" color="secondary">
        {t('integrityHint')}
      </Text>
      <div>
        <Button
          label={t('verify')}
          variant="secondary"
          size="sm"
          icon={<Icon icon={FingerprintIcon} />}
          onClick={() => verify.mutate(undefined)}
          isLoading={verify.isPending}
        />
      </div>
      <div aria-live="polite">
        <AnimatePresence mode="wait">
          {result && (
            <motion.div
              key={`${result.valid}-${verify.submittedAt}`}
              initial={{ opacity: 0, y: 6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            >
              <Banner
                status={result.valid ? 'success' : 'error'}
                title={result.valid ? t('verified') : t('tampered')}
                description={
                  <>
                    {t('hash')}{' '}
                    <Text type="code" wordBreak="break-all">
                      {result.hash}
                    </Text>
                  </>
                }
                collapsible={false}
              />
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
  const tr = useTranslations();
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
              {/* The actor holds an avatar (a block), which can't sit inside the description's paragraph. */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <ActorCell log={shown} className="text-foreground" />
                <span aria-hidden>·</span>
                <SheetDescription>
                  <DateTime date={shown.occurredAt} />{' '}
                  <span className="text-xs">
                    (<RelativeTime date={shown.occurredAt} />)
                  </span>
                </SheetDescription>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <OutcomeBadge outcome={shown.outcome} />
                <CategoryBadge category={shown.category} />
                <Badge variant="neutral" label={t('detail.seq', { seq: shown.seq })} />
              </div>
            </SheetHeader>
            <SheetBody className="space-y-5 pb-6">
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
                <ChangesTable log={shown} />
              </Section>

              {shown.metadata && Object.keys(shown.metadata).length > 0 && (
                <Section title={t('detail.metadata')}>
                  <NamedDetails log={shown} />
                  <CodeBlock
                    code={JSON.stringify(shown.metadata, null, 2)}
                    language="json"
                    size="sm"
                    width="100%"
                    maxHeight={256}
                    isWrapped
                  />
                </Section>
              )}

              <Section title={t('detail.context')}>
                <dl className="divide-y rounded-lg border px-3">
                  <ContextRow label={t('detail.eventId')} value={shown.eventId} />
                  <ContextRow label={t('detail.requestId')} value={shown.requestId} />
                  <ContextRow label={t('detail.ip')} value={shown.ip} />
                  <ContextRow label={t('detail.userAgent')} value={shown.userAgent} mono={false} />
                  <ContextRow
                    label={t('columns.module')}
                    value={
                      shown.moduleId && tr.has(`${shown.moduleId}.meta.name`)
                        ? tr(`${shown.moduleId}.meta.name`)
                        : shown.moduleId
                    }
                    mono={false}
                  />
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
