'use client';

import type { RecordLinkDto, RecordPanelSlotProps, ResolvedRecordInfo } from '@isbp/contracts';
import { Slot, useCan, usePageRecord, usePlatform } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@isbp/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@isbp/ui/dropdown-menu';
import { Label } from '@isbp/ui/label';
import { AnimatedItem, AnimatedList, Disclosure } from '@isbp/ui/motion';
import { PersonPicker } from '@isbp/ui/person-picker';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { RecordPicker } from '@isbp/ui/record-picker';
import { DateTime } from '@isbp/ui/relative-time';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { StatusBadge, type StatusTone } from '@isbp/ui/status';
import { Switch } from '@isbp/ui/switch';
import {
  EyeOffIcon,
  LinkIcon,
  PlusIcon,
  ServerIcon,
  SirenIcon,
  TicketIcon,
  Trash2Icon,
  TriangleAlertIcon,
  XIcon,
} from 'lucide-react';
import { DynamicIcon, type IconName } from 'lucide-react/dynamic';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId, useState } from 'react';
import {
  type LinkType,
  linkTypeSchema,
  priorityFor,
  type TicketDetail,
  type UpdateTicketInput,
} from '../../contracts';
import { PersonChip, PriorityBadge, TicketStatusBadge, TypeIcon } from '../components/badges';
import { LevelSelect } from '../components/new-ticket-dialog';
import {
  AssigneeSelect,
  CategorySelect,
  CiPicker,
  ciReference,
  GroupSelect,
  TicketPicker,
  type TicketOption,
} from '../components/pickers';
import { ciHref, INVALIDATE, recordRef, ticketApi, ticketHref, useCategoryLabel } from '../lib';
import { isDone } from '../statuses';
import type { CmdbCiOption, TicketLink } from '../types';

export function useTicketPatch(ticket: TicketDetail) {
  const tc = useTranslations('common');
  return useApiMutation(
    (api, body: UpdateTicketInput) => api.patch<TicketDetail>(ticketApi(ticket.reference), body),
    { invalidate: INVALIDATE, success: tc('saved') },
  );
}

/** The fields a change can flash: what an AI suggestion, a colleague or a rule may change while you look. */
const WATCHED = [
  'requester',
  'requestedFor',
  'category',
  'group',
  'assignee',
  'impact',
  'urgency',
  'priority',
  'major',
] as const;
type Watched = (typeof WATCHED)[number];

const valueOf = (t: TicketDetail, f: Watched): unknown =>
  ({
    requester: t.requester?.id,
    requestedFor: t.requestedFor?.id,
    category: t.category?.id,
    group: t.assignmentGroup?.id,
    assignee: t.assignee?.id,
    impact: t.impact,
    urgency: t.urgency,
    priority: t.priority,
    major: t.major,
  })[f];

/**
 * Which fields just changed (after a save, an AI "Apply" or a refetch): the row flashes once so the person sees
 * what moved. Derived while rendering from the previous ticket (no effect, no extra render pass).
 */
function useChangedFields(ticket: TicketDetail) {
  const [prev, setPrev] = useState(ticket);
  const [flash, setFlash] = useState<{ fields: readonly Watched[]; n: number }>({ fields: [], n: 0 });
  if (prev !== ticket) {
    const fields =
      prev.id === ticket.id ? WATCHED.filter((f) => valueOf(prev, f) !== valueOf(ticket, f)) : [];
    setPrev(ticket);
    if (fields.length) setFlash({ fields, n: flash.n + 1 });
  }
  return flash;
}

function Row({
  label,
  htmlFor,
  flash,
  children,
}: {
  label: string;
  htmlFor?: string;
  /** Restarts the highlight when it changes (the control itself never remounts, so focus stays). */
  flash?: number;
  children: ReactNode;
}) {
  return (
    <div className="relative -mx-1.5 grid min-w-0 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-3 rounded-md px-1.5 py-0.5">
      {flash ? (
        <span
          key={flash}
          aria-hidden
          className="highlight-flash pointer-events-none absolute inset-0 rounded-md"
        />
      ) : null}
      {htmlFor ? (
        <Label htmlFor={htmlFor} className="text-xs leading-tight font-medium text-muted-foreground">
          {label}
        </Label>
      ) : (
        <span className="text-xs leading-tight font-medium text-muted-foreground">{label}</span>
      )}
      <div className="min-w-0 text-sm">{children}</div>
    </div>
  );
}

/**
 * Who works it and how it's classified, one line each, saved on change. Impact/urgency, the requester's details and
 * the dates sit under "More details". Finished tickets show the values only (reopen to change them).
 */
export function DetailsCard({ ticket }: { ticket: TicketDetail }) {
  const t = useTranslations('itsm');
  const td = useTranslations('itsm.details');
  const id = useId();
  const patch = useTicketPatch(ticket);
  const categoryLabel = useCategoryLabel();
  const flash = useChangedFields(ticket);
  const editable = ticket.viewer.canEdit && !isDone(ticket.status);
  const matrix = priorityFor(ticket.impact, ticket.urgency);
  const overridden = ticket.priority !== matrix;
  const save = (body: UpdateTicketInput) => patch.mutate(body);
  const f = (field: Watched) => (flash.fields.includes(field) ? flash.n : undefined);
  const htmlFor = (key: string) => (editable ? `${id}-${key}` : undefined);

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle>{td('title')}</CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        <div className="grid gap-1.5" aria-busy={patch.isPending || undefined}>
          <Row label={td('assignee')} htmlFor={htmlFor('assignee')} flash={f('assignee')}>
            {editable ? (
              <AssigneeSelect
                id={`${id}-assignee`}
                size="sm"
                groupId={ticket.assignmentGroup?.id}
                value={ticket.assignee?.id ?? null}
                current={ticket.assignee}
                onChange={(assigneeId) => save({ assigneeId })}
              />
            ) : (
              <PersonChip person={ticket.assignee} className="py-1" />
            )}
          </Row>
          <Row label={td('group')} htmlFor={htmlFor('group')} flash={f('group')}>
            {editable ? (
              <GroupSelect
                id={`${id}-group`}
                size="sm"
                value={ticket.assignmentGroup?.id ?? null}
                onChange={(assignmentGroupId) => save({ assignmentGroupId })}
              />
            ) : (
              <span className="block truncate py-1">{ticket.assignmentGroup?.name ?? '—'}</span>
            )}
          </Row>
          <Row label={td('priority')} htmlFor={htmlFor('priority')} flash={f('priority')}>
            {editable ? (
              <Select
                value={overridden ? String(ticket.priority) : 'auto'}
                onValueChange={(v) => save({ priority: v === 'auto' ? null : Number(v) })}
              >
                <SelectTrigger
                  id={`${id}-priority`}
                  size="sm"
                  className="w-full"
                  aria-describedby={`${id}-priority-hint`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">
                    {td('priorityAuto', { priority: t(`priorityShort.${matrix}`) })}
                  </SelectItem>
                  {[1, 2, 3, 4].map((p) => (
                    <SelectItem key={p} value={String(p)}>
                      {t(`priority.${p}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <PriorityBadge priority={ticket.priority} long />
            )}
          </Row>
          {editable && (
            <p id={`${id}-priority-hint`} className="pl-[7.25rem] text-xs text-muted-foreground">
              {overridden
                ? td('priorityOverridden')
                : td('priorityFrom', {
                    impact: t(`impactShort.${ticket.impact}`),
                    urgency: t(`urgencyShort.${ticket.urgency}`),
                  })}
            </p>
          )}
          <Row label={td('category')} htmlFor={htmlFor('category')} flash={f('category')}>
            {editable ? (
              <CategorySelect
                id={`${id}-category`}
                size="sm"
                type={ticket.type}
                value={ticket.category?.id ?? null}
                onChange={(categoryId) => save({ categoryId })}
              />
            ) : (
              <span className="block truncate py-1">{categoryLabel(ticket.category) ?? '—'}</span>
            )}
          </Row>
          <Row label={td('requester')} htmlFor={htmlFor('requester')} flash={f('requester')}>
            {editable ? (
              <PersonPicker
                id={`${id}-requester`}
                value={ticket.requester}
                clearable={false}
                className="h-8"
                onChange={(p) => {
                  if (p && p.id !== ticket.requester?.id) save({ requesterId: p.id });
                }}
              />
            ) : (
              <PersonChip person={ticket.requester} className="py-1" />
            )}
          </Row>
          {ticket.type === 'incident' && (
            <Row label={td('majorShort')} htmlFor={`${id}-major`} flash={f('major')}>
              <span className="flex items-center justify-between gap-2 py-1">
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <SirenIcon className="size-3.5 text-destructive" aria-hidden />
                  {ticket.major ? td('majorOn') : td('majorOff')}
                </span>
                <Switch
                  id={`${id}-major`}
                  checked={ticket.major}
                  disabled={!editable}
                  onCheckedChange={(major) => save({ major })}
                />
              </span>
            </Row>
          )}
          <Disclosure
            summary={<span className="text-xs text-muted-foreground">{td('more')}</span>}
            className="mt-1 border-t pt-1"
            contentClassName="grid gap-1.5"
          >
            <div className="grid gap-1.5 pb-1">
              <Row label={td('impact')} htmlFor={htmlFor('impact')} flash={f('impact')}>
                {editable ? (
                  <LevelSelect
                    kind="impact"
                    id={`${id}-impact`}
                    size="sm"
                    value={String(ticket.impact)}
                    onChange={(v) => save({ impact: Number(v) })}
                  />
                ) : (
                  <span className="py-1">{t(`impactShort.${ticket.impact}`)}</span>
                )}
              </Row>
              <Row label={td('urgency')} htmlFor={htmlFor('urgency')} flash={f('urgency')}>
                {editable ? (
                  <LevelSelect
                    kind="urgency"
                    id={`${id}-urgency`}
                    size="sm"
                    value={String(ticket.urgency)}
                    onChange={(v) => save({ urgency: Number(v) })}
                  />
                ) : (
                  <span className="py-1">{t(`urgencyShort.${ticket.urgency}`)}</span>
                )}
              </Row>
              <Row label={td('requestedFor')} htmlFor={htmlFor('for')} flash={f('requestedFor')}>
                {editable ? (
                  <PersonPicker
                    id={`${id}-for`}
                    value={ticket.requestedFor}
                    placeholder={td('sameAsRequester')}
                    className="h-8"
                    onChange={(p) => save({ requestedForId: p?.id ?? null })}
                  />
                ) : (
                  <span className="block truncate py-1">
                    {ticket.requestedFor?.displayName ?? td('sameAsRequester')}
                  </span>
                )}
              </Row>
              <Row label={td('channel')}>
                <span className="py-1">{t(`channel.${ticket.channel}`)}</span>
              </Row>
              <Row label={td('department')}>
                <span className="block truncate py-1">{ticket.department?.name ?? '—'}</span>
              </Row>
              <Row label={td('created')}>
                <DateTime date={ticket.createdAt} />
              </Row>
              <Row label={td('firstResponse')}>
                <DateTime date={ticket.firstResponseAt} />
              </Row>
            </div>
          </Disclosure>
        </div>
      </CardContent>
    </Card>
  );
}

/* ───────────────────────────── related ───────────────────────────── */

const TONE: Record<string, StatusTone> = {
  neutral: 'muted',
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'destructive',
};

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="grid min-w-0 gap-1">
      <h3 className="text-xs font-medium text-muted-foreground">
        {title}
        {count !== undefined && <span className="tabular-nums"> · {count}</span>}
      </h3>
      {children}
    </section>
  );
}

/** "Affects: Finance ERP, HR Portal +5" — the business services that break if this CI fails (CMDB impact). */
function CiImpactLine({ reference }: { reference: string }) {
  const t = useTranslations('itsm.related');
  const { data } = useApiQuery<{ impacted: { ci: { name: string }; isService: boolean }[] }>(
    `/cmdb/cis/${encodeURIComponent(reference)}/impact`,
  );
  const services = [...new Set((data?.impacted ?? []).filter((n) => n.isService).map((n) => n.ci.name))];
  if (!services.length) return null;
  const shown = services.slice(0, 2);
  return (
    <p className="truncate text-xs text-muted-foreground" title={services.join(', ')}>
      {t('affects', { services: shown.join(', '), more: services.length - shown.length })}
    </p>
  );
}

function CiList({ ticket, canEdit, cmdb }: { ticket: TicketDetail; canEdit: boolean; cmdb: boolean }) {
  const t = useTranslations('itsm.cis');
  const patch = useTicketPatch(ticket);
  return (
    <AnimatedList className="min-w-0 divide-y">
      {ticket.cis.map((ci) => (
        <AnimatedItem key={ci.id} className="min-w-0">
          <div className="flex min-w-0 items-start gap-2.5 py-1.5">
            <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
              <ServerIcon className="size-3.5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                {cmdb ? (
                  <Link href={ciHref(ci)} className="truncate text-sm font-medium hover:underline">
                    {ci.name}
                  </Link>
                ) : (
                  <span className="truncate text-sm font-medium">{ci.name}</span>
                )}
                {ci.criticality === 'critical' && (
                  <StatusBadge tone="warning" icon={TriangleAlertIcon} label={t('critical')} />
                )}
              </div>
              {cmdb ? (
                <CiImpactLine reference={ci.reference || ciReference(ci)} />
              ) : (
                <p className="truncate text-xs text-muted-foreground">{ciReference(ci)}</p>
              )}
            </div>
            {canEdit && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-7 shrink-0 text-muted-foreground"
                aria-label={t('remove', { name: ci.name })}
                disabled={patch.isPending}
                onClick={() =>
                  patch.mutate({ ciIds: ticket.cis.filter((c) => c.id !== ci.id).map((c) => c.id) })
                }
              >
                <XIcon />
              </Button>
            )}
          </div>
        </AnimatedItem>
      ))}
    </AnimatedList>
  );
}

/** A problem lists the incidents it causes in its own card; the Related card shows the other links. */
function relatedLinks(ticket: TicketDetail) {
  return ticket.type === 'problem'
    ? ticket.links.filter((l) => !(l.type === 'caused_by' && l.direction === 'incoming'))
    : ticket.links;
}

function TicketLinks({ ticket, canEdit }: { ticket: TicketDetail; canEdit: boolean }) {
  const t = useTranslations('itsm');
  const tl = useTranslations('itsm.links');
  const remove = useApiMutation(
    (api, link: TicketLink) => api.delete<TicketDetail>(`${ticketApi(ticket.reference)}/links/${link.id}`),
    { invalidate: INVALIDATE, success: tl('removed') },
  );
  const groups = new Map<string, TicketLink[]>();
  for (const l of relatedLinks(ticket)) {
    const key = `${l.type}.${l.direction}`;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  return (
    <div className="grid min-w-0 gap-2">
      {[...groups.entries()].map(([key, links]) => (
        <div key={key} className="grid min-w-0 gap-0.5">
          <p className="text-xs text-muted-foreground">{t(`linkType.${key}`)}</p>
          <AnimatedList className="min-w-0">
            {links.map((l) => (
              <AnimatedItem key={l.id} className="min-w-0">
                <div className="flex min-w-0 items-center gap-2 py-1 text-sm">
                  <TypeIcon type={l.ticket.type} label className="text-muted-foreground" />
                  <Link
                    href={ticketHref(l.ticket.reference)}
                    className="shrink-0 font-mono text-xs font-medium hover:underline"
                  >
                    {l.ticket.reference}
                  </Link>
                  <span className="min-w-0 flex-1 truncate" title={l.ticket.title}>
                    {l.ticket.title}
                  </span>
                  <TicketStatusBadge
                    status={l.ticket.status}
                    className="hidden sm:inline-flex xl:hidden 2xl:inline-flex"
                  />
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="size-7 shrink-0 text-muted-foreground"
                      aria-label={tl('remove', { reference: l.ticket.reference })}
                      onClick={() => remove.mutate(l)}
                      disabled={remove.isPending && remove.variables?.id === l.id}
                    >
                      <Trash2Icon />
                    </Button>
                  )}
                </div>
              </AnimatedItem>
            ))}
          </AnimatedList>
        </div>
      ))}
    </div>
  );
}

function RecordRows({
  links,
  canEdit,
  onRemove,
  removing,
}: {
  links: (RecordLinkDto & { record: ResolvedRecordInfo })[];
  canEdit: boolean;
  onRemove: (id: string) => void;
  removing: boolean;
}) {
  const t = useTranslations('itsm.related');
  const root = useTranslations();
  return (
    <AnimatedList className="min-w-0 divide-y">
      {links.map((l) => {
        const status = l.record.status;
        return (
          <AnimatedItem key={l.id} className="min-w-0">
            <div className="flex min-w-0 items-center gap-2.5 py-1.5">
              <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                {l.record.icon ? (
                  <DynamicIcon name={l.record.icon as IconName} className="size-3.5" aria-hidden />
                ) : (
                  <LinkIcon className="size-3.5" aria-hidden />
                )}
              </span>
              <Link
                href={l.record.href}
                className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
              >
                {l.record.reference && (
                  <span className="mr-1.5 font-mono text-xs text-muted-foreground">{l.record.reference}</span>
                )}
                {l.record.title}
              </Link>
              {status && root.has(status.key) && (
                <StatusBadge
                  tone={TONE[status.tone] ?? 'muted'}
                  label={root(status.key)}
                  className="hidden sm:inline-flex xl:hidden 2xl:inline-flex"
                />
              )}
              {canEdit && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-7 shrink-0 text-muted-foreground"
                  aria-label={t('removeRecord', { name: l.record.reference ?? l.record.title })}
                  disabled={removing}
                  onClick={() => onRemove(l.id)}
                >
                  <XIcon />
                </Button>
              )}
            </div>
          </AnimatedItem>
        );
      })}
    </AnimatedList>
  );
}

type Adding = 'ci' | 'ticket' | 'record' | null;

/** Pick tickets by number or title (no typing references), with the relation from this ticket's point of view. */
function AddTicketDialog({
  ticket,
  open,
  onOpenChange,
}: {
  ticket: TicketDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('itsm');
  const tl = useTranslations('itsm.links');
  const tc = useTranslations('common');
  const id = useId();
  // On a problem the useful relation is "causes these incidents".
  const options = relationOptions(ticket);
  const [relation, setRelation] = useState(options[0]!.value);
  const [picked, setPicked] = useState<TicketOption[]>([]);
  const add = useApiMutation(
    async (api, items: TicketOption[]) => {
      const r = options.find((o) => o.value === relation)!;
      for (const it of items)
        await api.post(`${ticketApi(ticket.reference)}/links`, {
          target: it.reference,
          type: r.type,
          direction: r.direction,
        });
    },
    {
      invalidate: INVALIDATE,
      success: tl('added'),
      onSuccess: () => {
        onOpenChange(false);
        setPicked([]);
      },
    },
  );
  const linked = new Set(ticket.links.map((l) => l.ticket.id));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{tl('addTitle')}</DialogTitle>
          <DialogDescription>{tl('addHint', { reference: ticket.reference })}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (picked.length) add.mutate(picked);
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor={`${id}-type`}>{tl('relation')}</Label>
            <Select value={relation} onValueChange={setRelation}>
              <SelectTrigger id={`${id}-type`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {t(`linkType.${o.type}.${o.direction}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-target`}>{tl('targets')}</Label>
            <TicketPicker
              id={`${id}-target`}
              value={picked}
              onChange={setPicked}
              exclude={[ticket.id, ...linked]}
              types={ticket.type === 'problem' ? ['incident', 'service_request'] : undefined}
              aria-describedby={`${id}-target-hint`}
            />
            <p id={`${id}-target-hint`} className="text-xs text-muted-foreground">
              {tl('targetsHint')}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" loading={add.isPending} disabled={!picked.length}>
              <LinkIcon />
              {tl('addCount', { count: picked.length })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Relations offered when linking from this ticket, read from its side (outgoing and incoming). */
export function relationOptions(ticket: Pick<TicketDetail, 'type'>) {
  const all = linkTypeSchema.options.flatMap((type: LinkType) =>
    (['outgoing', 'incoming'] as const)
      .filter((direction) => !(type === 'related' && direction === 'incoming'))
      .map((direction) => ({ value: `${type}.${direction}`, type, direction })),
  );
  const first =
    ticket.type === 'problem'
      ? 'caused_by.incoming'
      : ticket.type === 'change'
        ? 'implements.outgoing'
        : 'related.outgoing';
  return [...all.filter((o) => o.value === first), ...all.filter((o) => o.value !== first)];
}

function AddCisDialog({
  ticket,
  open,
  onOpenChange,
}: {
  ticket: TicketDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('itsm.cis');
  const tc = useTranslations('common');
  const patch = useTicketPatch(ticket);
  const [draft, setDraft] = useState<CmdbCiOption[]>([]);
  const [opened, setOpened] = useState(false);
  if (open !== opened) {
    setOpened(open);
    if (open)
      setDraft(ticket.cis.map((c) => ({ id: c.id, number: c.number, reference: c.reference, name: c.name })));
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('editTitle')}</DialogTitle>
          <DialogDescription>{t('editHint')}</DialogDescription>
        </DialogHeader>
        <CiPicker value={draft} onChange={setDraft} aria-label={t('title')} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button
            loading={patch.isPending}
            onClick={() =>
              patch.mutate({ ciIds: draft.map((c) => c.id) }, { onSuccess: () => onOpenChange(false) })
            }
          >
            {tc('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddRecordDialog({
  ticket,
  open,
  onOpenChange,
  linked,
}: {
  ticket: TicketDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  linked: readonly string[];
}) {
  const t = useTranslations('itsm.related');
  const tc = useTranslations('common');
  const id = useId();
  const [picked, setPicked] = useState<string[]>([]);
  const record = recordRef(ticket);
  // Records of other kinds (tickets and CIs have their own entries in the Add menu).
  const typesQ = useApiQuery<{ items: { type: string }[] }>(open ? '/records/types' : null);
  const types = (typesQ.data?.items ?? [])
    .map((x) => x.type)
    .filter((type) => !type.startsWith('itsm.') && type !== 'cmdb.ci');
  const link = useApiMutation(
    async (api, refs: string[]) => {
      for (const ref of refs) {
        const at = ref.indexOf(':');
        await api.post(`/records/${record.type}/${record.id}/links`, {
          to: { type: ref.slice(0, at), id: ref.slice(at + 1) },
        });
      }
    },
    {
      invalidate: ['/records/'],
      success: t('recordLinked'),
      onSuccess: () => {
        setPicked([]);
        onOpenChange(false);
      },
    },
  );
  const already = new Set(linked);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('addRecordTitle')}</DialogTitle>
          <DialogDescription>{t('addRecordHint')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-record`}>{t('record')}</Label>
          <RecordPicker
            id={`${id}-record`}
            multiple
            types={types}
            value={picked}
            onChange={(refs) => setPicked(refs.filter((r) => !already.has(r)))}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button loading={link.isPending} disabled={!picked.length} onClick={() => link.mutate(picked)}>
            <LinkIcon />
            {t('linkRecord')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Everything related to the ticket in one card: affected CIs (with the services they affect), linked tickets, other
 * records (assets, articles, releases…) and the outside systems it syncs with. One "Add" menu; empty sections are
 * hidden (they are entries of the menu instead).
 */
export function RelatedCard({ ticket }: { ticket: TicketDetail }) {
  const t = useTranslations('itsm.related');
  const record = recordRef(ticket);
  const { enabledModules } = usePlatform();
  const cmdb = useCan('cmdb.cis.read') && enabledModules.includes('cmdb');
  const [adding, setAdding] = useState<Adding>(null);
  const links = useApiQuery<{ record: ResolvedRecordInfo; links: RecordLinkDto[] }>(
    `/records/${record.type}/${record.id}/links`,
  );
  const unlink = useApiMutation(
    (api, linkId: string) => api.delete(`/records/${record.type}/${record.id}/links/${linkId}`),
    { invalidate: ['/records/'], success: t('recordRemoved') },
  );
  // This page's record, for the shell and the assistant (the core links panel is not rendered here).
  usePageRecord({ type: record.type, id: record.id, label: `${ticket.reference} ${ticket.title}` });

  const canEdit = ticket.viewer.canEdit;
  const canLinkRecords = links.data?.record.editable ?? false;
  const ciIds = new Set(ticket.cis.map((c) => c.id));
  // CIs show once, in their own section (a change also links them as records so the CI page lists it).
  const others = (links.data?.links ?? []).filter(
    (l): l is RecordLinkDto & { record: ResolvedRecordInfo } =>
      Boolean(l.record) && !(l.ref.type === 'cmdb.ci' && ciIds.has(l.ref.id)),
  );
  const hidden = (links.data?.links ?? []).filter((l) => l.hidden).length;
  const tickets = relatedLinks(ticket);
  const empty = !ticket.cis.length && !tickets.length && !others.length && !hidden;

  return (
    <Card className="gap-3 py-4" role="region" aria-labelledby={`${record.id}-related`}>
      <CardHeader className="px-4">
        <CardTitle id={`${record.id}-related`}>{t('title')}</CardTitle>
        {(canEdit || canLinkRecords) && (
          <CardAction>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  <PlusIcon />
                  {t('add')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-52">
                {canEdit && cmdb && (
                  <DropdownMenuItem onSelect={() => setAdding('ci')}>
                    <ServerIcon aria-hidden />
                    {t('addCi')}
                  </DropdownMenuItem>
                )}
                {canEdit && (
                  <DropdownMenuItem onSelect={() => setAdding('ticket')}>
                    <TicketIcon aria-hidden />
                    {t('addTicket')}
                  </DropdownMenuItem>
                )}
                {canLinkRecords && (
                  <DropdownMenuItem onSelect={() => setAdding('record')}>
                    <LinkIcon aria-hidden />
                    {t('addRecord')}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="group/related grid gap-4 px-4">
        {empty && (
          // Hidden as well when the ticket syncs with an outside system (that section is filled by a slot).
          <p className="text-sm text-muted-foreground group-has-[[data-related-sync]_*]/related:hidden">
            {t('none')}
          </p>
        )}
        {ticket.cis.length > 0 && (
          <Section title={t('cis')} count={ticket.cis.length}>
            <CiList ticket={ticket} canEdit={canEdit && cmdb} cmdb={cmdb} />
          </Section>
        )}
        {tickets.length > 0 && (
          <Section title={t('tickets')} count={tickets.length}>
            <TicketLinks ticket={ticket} canEdit={canEdit} />
          </Section>
        )}
        {others.length > 0 && (
          <Section title={t('records')} count={others.length}>
            <RecordRows
              links={others}
              canEdit={canLinkRecords}
              removing={unlink.isPending}
              onRemove={(id) => unlink.mutate(id)}
            />
          </Section>
        )}
        {hidden > 0 && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <EyeOffIcon className="size-3.5 shrink-0" aria-hidden />
            {t('hidden', { count: hidden })}
          </p>
        )}
        {/* Outside systems this ticket syncs with (Integrations Hub), inside this card. */}
        <div data-related-sync className="-mt-4 empty:hidden">
          <Slot<RecordPanelSlotProps>
            name="core.record.links"
            props={{ record, bare: true }}
            wrap={(node, moduleId) => (moduleId === 'core' ? null : node)}
          />
        </div>
      </CardContent>
      <AddCisDialog ticket={ticket} open={adding === 'ci'} onOpenChange={(o) => setAdding(o ? 'ci' : null)} />
      <AddTicketDialog
        ticket={ticket}
        open={adding === 'ticket'}
        onOpenChange={(o) => setAdding(o ? 'ticket' : null)}
      />
      <AddRecordDialog
        ticket={ticket}
        open={adding === 'record'}
        onOpenChange={(o) => setAdding(o ? 'record' : null)}
        linked={(links.data?.links ?? []).map((l) => `${l.ref.type}:${l.ref.id}`)}
      />
    </Card>
  );
}
