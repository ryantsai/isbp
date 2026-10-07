'use client';

import type {
  RecordLinkDto,
  RecordPanelSlotProps,
  RecordTypeInfo,
  ResolvedRecordInfo,
} from '@isbp/contracts';
import { formatRecordRef } from '@isbp/sdk';
import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@isbp/ui/dialog';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { SearchInput } from '@isbp/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Skeleton } from '@isbp/ui/skeleton';
import { CheckIcon, EyeOffIcon, LinkIcon, PlugZapIcon, PlusIcon, XIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId, useState } from 'react';
import { NavIcon } from '../nav-icon';
import { ModuleStatus } from '../requests/request-status';

interface LinksResponse {
  record: ResolvedRecordInfo;
  links: RecordLinkDto[];
}

const ALL = '__all__';

const linksPath = (record: { type: string; id: string }) => `/records/${record.type}/${record.id}/links`;

/** One record as a row: type icon, reference, title (link) and status. */
export function RecordRow({ record, action }: { record: ResolvedRecordInfo; action?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-3 py-2">
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
        <NavIcon name={record.icon ?? undefined} className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <Link
          href={record.href}
          className="block truncate text-sm font-medium hover:underline focus-visible:underline focus-visible:outline-none"
        >
          {record.reference && (
            <span className="mr-1.5 font-mono text-xs text-muted-foreground">{record.reference}</span>
          )}{' '}
          {record.title}
        </Link>
        {record.subtitle && <p className="truncate text-xs text-muted-foreground">{record.subtitle}</p>}
      </div>
      {record.status && <ModuleStatus statusKey={record.status.key} tone={record.status.tone} />}
      {action}
    </div>
  );
}

function TypeName({ type, name }: { type: string; name?: string }) {
  const t = useTranslations();
  const key = name ?? type;
  return <>{t.has(key) ? t(key) : type}</>;
}

/** "Link a record": choose a type (optional), search, link. */
function LinkDialog({
  record,
  open,
  onOpenChange,
  linked,
}: {
  record: ResolvedRecordInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  linked: Set<string>;
}) {
  const t = useTranslations('records');
  const id = useId();
  const [q, setQ] = useState('');
  const [type, setType] = useState(ALL);
  const types = useApiQuery<{ items: RecordTypeInfo[] }>(open ? '/records/types' : null);
  const results = useApiQuery<{ items: ResolvedRecordInfo[] }>(open ? '/records/search' : null, {
    q,
    limit: 15,
    types: type === ALL ? undefined : type,
  });
  const link = useApiMutation(
    (api, to: ResolvedRecordInfo) => api.post(`${linksPath(record)}`, { to: { type: to.type, id: to.id } }),
    { invalidate: ['/records/'], success: t('links.linked') },
  );
  const self = formatRecordRef(record);
  const typeNames = new Map((types.data?.items ?? []).map((ti) => [ti.type, ti.name]));
  const items = results.data?.items ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('picker.title')}</DialogTitle>
          <DialogDescription>{t('picker.description')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <Select value={type} onValueChange={setType}>
            <SelectTrigger aria-label={t('picker.type')} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('picker.allTypes')}</SelectItem>
              {(types.data?.items ?? []).map((ti) => (
                <SelectItem key={ti.type} value={ti.type}>
                  <TypeName type={ti.type} name={ti.name} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <SearchInput
            value={q}
            onChange={setQ}
            placeholder={t('picker.searchPlaceholder')}
            className="sm:w-full"
          />
        </div>
        <div
          className="max-h-[50vh] min-h-40 overflow-y-auto rounded-lg border"
          aria-busy={results.isFetching}
          aria-labelledby={`${id}-results`}
          role="region"
        >
          <h3 id={`${id}-results`} className="sr-only">
            {t('picker.results')}
          </h3>
          {results.isPending ? (
            <div className="grid gap-2 p-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">{t('picker.noResults')}</p>
          ) : (
            <ul className="divide-y px-3">
              {items.map((r) => {
                const key = formatRecordRef(r);
                const isSelf = key === self;
                const isLinked = linked.has(key);
                return (
                  <li key={key}>
                    <RecordRow
                      record={r}
                      action={
                        isSelf ? (
                          <span className="text-xs text-muted-foreground">{t('picker.thisRecord')}</span>
                        ) : isLinked ? (
                          <span className="inline-flex items-center gap-1 text-xs text-success">
                            <CheckIcon className="size-3.5" aria-hidden />
                            {t('picker.alreadyLinked')}
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            loading={link.isPending && link.variables?.id === r.id}
                            onClick={() => link.mutate(r)}
                            aria-label={t('picker.linkAria', {
                              name: `${r.reference ? `${r.reference} ` : ''}${r.title}`,
                            })}
                          >
                            <LinkIcon />
                            {t('picker.link')}
                          </Button>
                        )
                      }
                    />
                    <p className="sr-only">
                      <TypeName type={r.type} name={typeNames.get(r.type)} />
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Core panel for `<Slot name="core.record.links" props={{ record }} />`: the record's links to records of
 * any module, grouped by type, with a picker to add more (when the module says the viewer may edit).
 */
export default function LinkedRecords({ record: ref, bare }: RecordPanelSlotProps) {
  const t = useTranslations('records');
  const headingId = useId();
  const [open, setOpen] = useState(false);
  const { data, isPending } = useApiQuery<LinksResponse>(linksPath(ref));
  const types = useApiQuery<{ items: RecordTypeInfo[] }>('/records/types');
  const unlink = useApiMutation((api, linkId: string) => api.delete(`${linksPath(ref)}/${linkId}`), {
    invalidate: ['/records/'],
    success: t('links.removed'),
  });
  if (isPending || !data) return bare ? null : <Skeleton className="h-28 w-full" />;

  const editable = data.record.editable;
  const visible = data.links.filter((l): l is RecordLinkDto & { record: ResolvedRecordInfo } => !!l.record);
  const forbidden = data.links.filter((l) => l.hidden === 'forbidden').length;
  const unavailable = data.links.filter((l) => l.hidden === 'unavailable').length;
  const typeNames = new Map((types.data?.items ?? []).map((ti) => [ti.type, ti.name]));
  const groups = new Map<string, typeof visible>();
  for (const l of visible) groups.set(l.record.type, [...(groups.get(l.record.type) ?? []), l]);
  const linkedKeys = new Set(data.links.map((l) => formatRecordRef(l.ref)));

  const addButton = editable && (
    <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
      <PlusIcon />
      {t('links.add')}
    </Button>
  );

  const body = (
    <div className="grid gap-3">
      {visible.length === 0 && !forbidden && !unavailable ? (
        <p className="text-sm text-muted-foreground">{t('links.empty')}</p>
      ) : (
        [...groups].map(([type, links]) => (
          <section key={type} className="min-w-0">
            <h3 className="mb-0.5 text-xs font-medium text-muted-foreground">
              <TypeName type={type} name={typeNames.get(type)} /> · {links.length}
            </h3>
            <ul className="divide-y">
              <AnimatePresence initial={false}>
                {links.map((l) => (
                  <motion.li
                    key={l.id}
                    layout
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <RecordRow
                      record={l.record}
                      action={
                        editable && (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            className="text-muted-foreground"
                            disabled={unlink.isPending}
                            onClick={() => unlink.mutate(l.id)}
                            aria-label={t('links.remove', {
                              name: `${l.record.reference ? `${l.record.reference} ` : ''}${l.record.title}`,
                            })}
                          >
                            <XIcon />
                          </Button>
                        )
                      }
                    />
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </section>
        ))
      )}
      {(forbidden > 0 || unavailable > 0) && (
        <div className="grid gap-1 text-xs text-muted-foreground">
          {forbidden > 0 && (
            <p className="flex items-center gap-1.5">
              <EyeOffIcon className="size-3.5 shrink-0" aria-hidden />
              {t('links.hiddenForbidden', { count: forbidden })}
            </p>
          )}
          {unavailable > 0 && (
            <p className="flex items-center gap-1.5">
              <PlugZapIcon className="size-3.5 shrink-0" aria-hidden />
              {t('links.hiddenUnavailable', { count: unavailable })}
            </p>
          )}
        </div>
      )}
      {editable && <LinkDialog record={data.record} open={open} onOpenChange={setOpen} linked={linkedKeys} />}
    </div>
  );

  if (bare)
    return (
      <div className="grid gap-2">
        {addButton && <div className="flex justify-end">{addButton}</div>}
        {body}
      </div>
    );
  return (
    <Card role="region" aria-labelledby={headingId} className={cn('min-w-0')}>
      <CardHeader>
        <CardTitle id={headingId} className="flex items-center gap-2">
          <LinkIcon className="size-4 text-muted-foreground" aria-hidden />
          {t('links.title')}
          {data.links.length > 0 && (
            <span className="text-sm font-normal text-muted-foreground">({data.links.length})</span>
          )}
        </CardTitle>
        {addButton && <CardAction>{addButton}</CardAction>}
      </CardHeader>
      <CardContent className="min-w-0">{body}</CardContent>
    </Card>
  );
}
