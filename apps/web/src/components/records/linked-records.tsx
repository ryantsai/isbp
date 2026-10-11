'use client';

import type {
  RecordLinkDto,
  RecordPanelSlotProps,
  RecordTypeInfo,
  ResolvedRecordInfo,
} from '@isbp/contracts';
import { formatRecordRef } from '@isbp/sdk';
import { usePageRecord } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { IconTile } from '@isbp/ui/icon-tile';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { SearchInput } from '@isbp/ui/search-input';
import { Skeleton } from '@isbp/ui/skeleton';
import { StatusBadge } from '@isbp/ui/status';
import { CheckIcon, EyeOffIcon, LinkIcon, PlugZapIcon, PlusIcon, XIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId, useState } from 'react';
import { NavIcon } from '../nav-icon';
import { ModuleStatus } from '../requests/request-status';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, Layout, LayoutContent, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';

interface LinksResponse {
  record: ResolvedRecordInfo;
  links: RecordLinkDto[];
}

const ALL = '__all__';

const linksPath = (record: { type: string; id: string }) => `/records/${record.type}/${record.id}/links`;

/** One record as a row: type icon, reference, title (link) and status. */
export function RecordRow({ record, action }: { record: ResolvedRecordInfo; action?: ReactNode }) {
  return (
    <HStack gap={3} vAlign="center" className="min-w-0 py-2">
      <IconTile variant="outline" size="sm" aria-hidden>
        <NavIcon name={record.icon ?? undefined} />
      </IconTile>
      <div className="min-w-0 flex-1">
        <VStack gap={0.5}>
          <Link href={record.href} color="primary" weight="medium" maxLines={1}>
            {record.reference && (
              <>
                <Text type="code" color="secondary">
                  {record.reference}
                </Text>{' '}
              </>
            )}
            {record.title}
          </Link>
          {record.subtitle && (
            <Text type="supporting" maxLines={1}>
              {record.subtitle}
            </Text>
          )}
        </VStack>
      </div>
      {record.status && <ModuleStatus statusKey={record.status.key} tone={record.status.tone} />}
      {action}
    </HStack>
  );
}

/** The translated name of a record type (its manifest key), or the raw type when it has none. */
function useTypeName() {
  const t = useTranslations();
  return (type: string, name?: string) => {
    const key = name ?? type;
    return t.has(key) ? t(key) : type;
  };
}

function TypeName({ type, name }: { type: string; name?: string }) {
  return <>{useTypeName()(type, name)}</>;
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
  const typeName = useTypeName();
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
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={576}>
      <Layout
        header={
          <DialogHeader
            title={t('picker.title')}
            subtitle={t('picker.description')}
            onOpenChange={onOpenChange}
          />
        }
        content={
          <LayoutContent padding={4}>
            <VStack gap={3}>
              <div className="grid gap-2 sm:grid-cols-[12rem_minmax(0,1fr)]">
                <Selector
                  label={t('picker.type')}
                  isLabelHidden
                  value={type}
                  onChange={setType}
                  options={[
                    { value: ALL, label: t('picker.allTypes') },
                    ...(types.data?.items ?? []).map((ti) => ({
                      value: ti.type,
                      label: typeName(ti.type, ti.name),
                    })),
                  ]}
                />
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
                  <p className="p-5 text-center text-sm text-muted-foreground">{t('picker.noResults')}</p>
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
                                <span className="text-xs text-muted-foreground">
                                  {t('picker.thisRecord')}
                                </span>
                              ) : isLinked ? (
                                <StatusBadge
                                  tone="success"
                                  icon={CheckIcon}
                                  label={t('picker.alreadyLinked')}
                                />
                              ) : (
                                <Button
                                  label={t('picker.link')}
                                  aria-label={t('picker.linkAria', {
                                    name: `${r.reference ? `${r.reference} ` : ''}${r.title}`,
                                  })}
                                  variant="secondary"
                                  size="sm"
                                  icon={<Icon icon={LinkIcon} />}
                                  isLoading={link.isPending && link.variables?.id === r.id}
                                  onClick={() => link.mutate(r)}
                                />
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
            </VStack>
          </LayoutContent>
        }
      />
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
  // Every record page hosts this panel: it tells the shell (and the assistant) which record is open.
  const shown = data?.record;
  usePageRecord({
    type: ref.type,
    id: ref.id,
    label: shown ? `${shown.reference ? `${shown.reference} ` : ''}${shown.title}`.trim() : undefined,
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
    <Button
      label={t('links.add')}
      variant="secondary"
      size="sm"
      icon={<Icon icon={PlusIcon} />}
      onClick={() => setOpen(true)}
    />
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
                          <IconButton
                            label={t('links.remove', {
                              name: `${l.record.reference ? `${l.record.reference} ` : ''}${l.record.title}`,
                            })}
                            variant="ghost"
                            size="sm"
                            icon={<Icon icon={XIcon} />}
                            isDisabled={unlink.isPending}
                            onClick={() => unlink.mutate(l.id)}
                          />
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
        <CardTitle id={headingId}>
          <HStack gap={2} vAlign="center">
            <Icon icon={LinkIcon} color="secondary" />
            {t('links.title')}
            {data.links.length > 0 && <Badge variant="neutral" label={data.links.length} />}
          </HStack>
        </CardTitle>
        {addButton && <CardAction>{addButton}</CardAction>}
      </CardHeader>
      <CardContent className="min-w-0">{body}</CardContent>
    </Card>
  );
}
