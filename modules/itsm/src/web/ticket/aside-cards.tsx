'use client';

import { useCan, usePlatform } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
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
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { PersonPicker } from '@isbp/ui/person-picker';
import { useApiMutation } from '@isbp/ui/query';
import { DateTime } from '@isbp/ui/relative-time';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Switch } from '@isbp/ui/switch';
import { LinkIcon, PencilIcon, PlusIcon, ServerIcon, SirenIcon, Trash2Icon } from 'lucide-react';
import Link from 'next/link';
import { useNow, useTranslations } from 'next-intl';
import { type ReactNode, useId, useState } from 'react';
import {
  type LinkType,
  linkTypeSchema,
  priorityFor,
  type TicketDetail,
  type UpdateTicketInput,
} from '../../contracts';
import {
  PersonChip,
  PriorityBadge,
  SlaChip,
  slaState,
  TicketStatusBadge,
  TypeIcon,
} from '../components/badges';
import { LevelSelect } from '../components/new-ticket-dialog';
import { AssigneeSelect, CategorySelect, CiPicker, GroupSelect, ciReference } from '../components/pickers';
import { ciHref, INVALIDATE, ticketApi, ticketHref, useCategoryLabel } from '../lib';
import type { CmdbCiOption, TicketLink } from '../types';

export function useTicketPatch(ticket: TicketDetail) {
  const tc = useTranslations('common');
  return useApiMutation(
    (api, body: UpdateTicketInput) => api.patch<TicketDetail>(ticketApi(ticket.reference), body),
    { invalidate: INVALIDATE, success: tc('saved') },
  );
}

function Row({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1.5">
      {htmlFor ? (
        <Label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
          {label}
        </Label>
      ) : (
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      )}
      <div className="min-w-0 text-sm">{children}</div>
    </div>
  );
}

/** Classification and assignment, each saved on change (agents with edit rights). */
export function DetailsCard({ ticket }: { ticket: TicketDetail }) {
  const t = useTranslations('itsm');
  const td = useTranslations('itsm.details');
  const id = useId();
  const patch = useTicketPatch(ticket);
  const categoryLabel = useCategoryLabel();
  const editable = ticket.viewer.canEdit;
  const matrix = priorityFor(ticket.impact, ticket.urgency);
  const overridden = ticket.priority !== matrix;
  const save = (body: UpdateTicketInput) => patch.mutate(body);

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>{td('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4" aria-busy={patch.isPending || undefined}>
          {/* Correcting who reported it; required, so it can be replaced but not cleared. */}
          <Row label={td('requester')} htmlFor={editable ? `${id}-requester` : undefined}>
            {editable ? (
              <PersonPicker
                id={`${id}-requester`}
                value={ticket.requester}
                clearable={false}
                onChange={(p) => {
                  if (p && p.id !== ticket.requester?.id) save({ requesterId: p.id });
                }}
              />
            ) : (
              <PersonChip person={ticket.requester} size="md" />
            )}
          </Row>
          <Row label={td('requestedFor')} htmlFor={editable ? `${id}-for` : undefined}>
            {editable ? (
              <PersonPicker
                id={`${id}-for`}
                value={ticket.requestedFor}
                placeholder={td('sameAsRequester')}
                onChange={(p) => save({ requestedForId: p?.id ?? null })}
              />
            ) : (
              (ticket.requestedFor?.displayName ?? td('sameAsRequester'))
            )}
          </Row>
          <Row label={td('category')} htmlFor={editable ? `${id}-category` : undefined}>
            {editable ? (
              <CategorySelect
                id={`${id}-category`}
                size="sm"
                type={ticket.type}
                value={ticket.category?.id ?? null}
                onChange={(categoryId) => save({ categoryId })}
              />
            ) : (
              (categoryLabel(ticket.category) ?? '—')
            )}
          </Row>
          <Row label={td('group')} htmlFor={editable ? `${id}-group` : undefined}>
            {editable ? (
              <GroupSelect
                id={`${id}-group`}
                size="sm"
                value={ticket.assignmentGroup?.id ?? null}
                onChange={(assignmentGroupId) => save({ assignmentGroupId })}
              />
            ) : (
              (ticket.assignmentGroup?.name ?? '—')
            )}
          </Row>
          <Row label={td('assignee')} htmlFor={editable ? `${id}-assignee` : undefined}>
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
              (ticket.assignee?.displayName ?? t('common.unassigned'))
            )}
          </Row>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <Row label={td('impact')} htmlFor={editable ? `${id}-impact` : undefined}>
              {editable ? (
                <LevelSelect
                  kind="impact"
                  id={`${id}-impact`}
                  value={String(ticket.impact)}
                  onChange={(v) => save({ impact: Number(v) })}
                />
              ) : (
                t(`impactShort.${ticket.impact}`)
              )}
            </Row>
            <Row label={td('urgency')} htmlFor={editable ? `${id}-urgency` : undefined}>
              {editable ? (
                <LevelSelect
                  kind="urgency"
                  id={`${id}-urgency`}
                  value={String(ticket.urgency)}
                  onChange={(v) => save({ urgency: Number(v) })}
                />
              ) : (
                t(`urgencyShort.${ticket.urgency}`)
              )}
            </Row>
          </div>
          <Row label={td('priority')} htmlFor={editable ? `${id}-priority` : undefined}>
            {editable ? (
              <div className="grid gap-1">
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
                <p id={`${id}-priority-hint`} className="text-xs text-muted-foreground">
                  {overridden ? td('priorityOverridden') : td('priorityMatrix')}
                </p>
              </div>
            ) : (
              <PriorityBadge priority={ticket.priority} long />
            )}
          </Row>
          {ticket.type === 'incident' && (
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor={`${id}-major`} className="inline-flex items-center gap-1.5 text-sm">
                <SirenIcon className="size-4 text-destructive" aria-hidden />
                {td('major')}
              </Label>
              <Switch
                id={`${id}-major`}
                checked={ticket.major}
                disabled={!editable}
                onCheckedChange={(major) => save({ major })}
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-4 border-t pt-4">
            <Row label={td('channel')}>{t(`channel.${ticket.channel}`)}</Row>
            <Row label={td('department')}>{ticket.department?.name ?? '—'}</Row>
            <Row label={td('created')}>
              <DateTime date={ticket.createdAt} />
            </Row>
            <Row label={td('firstResponse')}>
              <DateTime date={ticket.firstResponseAt} />
            </Row>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** Affected CIs, linking to the CMDB; editable by agents. */
export function CisCard({ ticket }: { ticket: TicketDetail }) {
  const t = useTranslations('itsm.cis');
  const tc = useTranslations('common');
  const { enabledModules } = usePlatform();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CmdbCiOption[]>([]);
  const patch = useTicketPatch(ticket);
  const cmdb = useCan('cmdb.cis.read') && enabledModules.includes('cmdb');
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        {ticket.viewer.canEdit && cmdb && !editing && (
          <CardAction>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft(
                  ticket.cis.map((c) => ({
                    id: c.id,
                    number: c.number,
                    reference: c.reference,
                    name: c.name,
                  })),
                );
                setEditing(true);
              }}
            >
              <PencilIcon />
              {tc('edit')}
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {editing ? (
          <div className="grid gap-3">
            <CiPicker value={draft} onChange={setDraft} aria-label={t('title')} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
                {tc('cancel')}
              </Button>
              <Button
                size="sm"
                loading={patch.isPending}
                onClick={() =>
                  patch.mutate({ ciIds: draft.map((c) => c.id) }, { onSuccess: () => setEditing(false) })
                }
              >
                {tc('save')}
              </Button>
            </div>
          </div>
        ) : ticket.cis.length ? (
          <ul className="grid gap-2">
            {ticket.cis.map((ci) => (
              <li key={ci.id} className="flex min-w-0 items-start gap-2.5">
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                  <ServerIcon className="size-3.5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  {cmdb ? (
                    <Link href={ciHref(ci)} className="block truncate text-sm font-medium hover:underline">
                      {ci.name}
                    </Link>
                  ) : (
                    <span className="block truncate text-sm font-medium">{ci.name}</span>
                  )}
                  <span className="block truncate font-mono text-xs text-muted-foreground">
                    {ciReference(ci)} · {ci.classKey}
                  </span>
                </div>
                {ci.criticality === 'critical' && <Badge variant="destructive">{t('critical')}</Badge>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('none')}</p>
        )}
      </CardContent>
    </Card>
  );
}

/* ───────────────────────────── links ───────────────────────────── */

function AddLinkDialog({
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
  const [type, setType] = useState<LinkType>('related');
  const [target, setTarget] = useState('');
  const [touched, setTouched] = useState(false);
  const add = useApiMutation(
    (api, body: { target: string; type: LinkType }) =>
      api.post<TicketDetail>(`${ticketApi(ticket.reference)}/links`, body),
    {
      invalidate: INVALIDATE,
      success: tl('added'),
      onSuccess: () => {
        onOpenChange(false);
        setTarget('');
        setTouched(false);
      },
    },
  );
  const invalid = !/^(INC|SR|PRB|CHG)-\d{1,12}$/i.test(target.trim());
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
            setTouched(true);
            if (!invalid) add.mutate({ target: target.trim().toUpperCase(), type });
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor={`${id}-type`}>{tl('relation')}</Label>
            <Select value={type} onValueChange={(v) => setType(v as LinkType)}>
              <SelectTrigger id={`${id}-type`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {linkTypeSchema.options.map((lt) => (
                  <SelectItem key={lt} value={lt}>
                    {t(`linkType.${lt}.outgoing`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-target`}>{tl('target')}</Label>
            <Input
              id={`${id}-target`}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="PRB-00012"
              className="font-mono"
              autoComplete="off"
              aria-invalid={touched && invalid ? true : undefined}
              aria-describedby={`${id}-target-hint`}
            />
            <p
              id={`${id}-target-hint`}
              className={cn('text-xs', touched && invalid ? 'text-destructive' : 'text-muted-foreground')}
            >
              {touched && invalid ? tl('targetInvalid') : tl('targetHint')}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" loading={add.isPending}>
              <LinkIcon />
              {tl('add')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Related tickets grouped by relation ("Caused by", "Duplicated by" …), with add and remove. */
export function LinksCard({ ticket }: { ticket: TicketDetail }) {
  const t = useTranslations('itsm');
  const tl = useTranslations('itsm.links');
  const [adding, setAdding] = useState(false);
  const remove = useApiMutation(
    (api, link: TicketLink) => api.delete<TicketDetail>(`${ticketApi(ticket.reference)}/links/${link.id}`),
    { invalidate: INVALIDATE, success: tl('removed') },
  );
  const groups = new Map<string, TicketLink[]>();
  for (const l of ticket.links) {
    const key = `${l.type}.${l.direction}`;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>{tl('title')}</CardTitle>
        {ticket.viewer.canEdit && (
          <CardAction>
            <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
              <PlusIcon />
              {tl('add')}
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {!ticket.links.length ? (
          <p className="text-sm text-muted-foreground">{tl('none')}</p>
        ) : (
          <div className="grid gap-4">
            {[...groups.entries()].map(([key, links]) => (
              <section key={key} className="grid gap-1.5">
                <h3 className="text-xs font-medium text-muted-foreground">{t(`linkType.${key}`)}</h3>
                <ul className="grid gap-1.5">
                  {links.map((l) => (
                    <li key={l.id} className="group flex min-w-0 items-center gap-2 text-sm">
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
                      {ticket.viewer.canEdit && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="size-7 text-muted-foreground"
                          aria-label={tl('remove', { reference: l.ticket.reference })}
                          onClick={() => remove.mutate(l)}
                          disabled={remove.isPending && remove.variables?.id === l.id}
                        >
                          <Trash2Icon />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </CardContent>
      <AddLinkDialog ticket={ticket} open={adding} onOpenChange={setAdding} />
    </Card>
  );
}

/* ───────────────────────────── SLAs ───────────────────────────── */

/** Every SLA target of the ticket with its policy, due time and progress. */
export function SlasCard({ ticket }: { ticket: TicketDetail }) {
  const t = useTranslations('itsm');
  const ts = useTranslations('itsm.slas');
  const now = useNow({ updateInterval: 60_000 });
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>{ts('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {!ticket.slas.length ? (
          <p className="text-sm text-muted-foreground">{ts('none')}</p>
        ) : (
          <ul className="grid gap-4">
            {ticket.slas.map((s) => {
              const state = slaState(s, now);
              const pct = Math.min(100, Math.round(s.elapsedRatio * 100));
              return (
                <li key={s.id} className="grid gap-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">{t(`slaMetric.${s.metric}`)}</span>
                    <SlaChip sla={s} />
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <div
                      className={cn(
                        'h-full rounded-full',
                        state === 'breached'
                          ? 'bg-destructive'
                          : state === 'at_risk'
                            ? 'bg-warning'
                            : state === 'met'
                              ? 'bg-success'
                              : 'bg-primary/60',
                      )}
                      style={{ width: `${state === 'breached' ? 100 : pct}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {s.stoppedAt ? ts('stopped') : ts('due')} <DateTime date={s.stoppedAt ?? s.dueAt} />
                    {' · '}
                    {s.policy.name}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
