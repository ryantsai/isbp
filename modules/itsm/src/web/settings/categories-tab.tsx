'use client';

import { type Condition, localize, type LocalizedText } from '@isbp/sdk';
import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { EmptyState, ErrorState } from '@isbp/ui/empty-state';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { LocalizedInput } from '@isbp/ui/localized-input';
import { AnimatedItem, AnimatedList } from '@isbp/ui/motion';
import { OptionalFields } from '@isbp/ui/optional-fields';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetForm,
  SheetHeader,
  SheetTitle,
} from '@isbp/ui/sheet';
import { Skeleton } from '@isbp/ui/skeleton';
import { Switch } from '@isbp/ui/switch';
import { FolderTreeIcon, PencilIcon, PlusIcon, TimerIcon } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useId, useRef, useState } from 'react';
import type { z } from 'zod';
import {
  type Category,
  DEFAULT_PAUSE_STATUSES,
  type SlaPolicy,
  type TicketType,
  ticketTypeSchema,
  type upsertCategorySchema,
  type upsertSlaPolicySchema,
} from '../../contracts';
import {
  categoryPolicies,
  type CoverageContext,
  type CoveragePolicy,
  placementFor,
  PRIORITIES,
  readsCategory,
} from '../../sla-coverage';
import { CategorySelect } from '../components/pickers';
import { INVALIDATE, useCategories } from '../lib';
import type { CalendarDto } from '../types';
import {
  CheckGroup,
  DefaultGroupSelect,
  DeleteButton,
  MoveButtons,
  refocus,
  TypeChecks,
  usePolicies,
  useSheetParam,
} from './shared';
import { moved, ownPolicyOf } from './logic';
import { allSame, TargetsEditor, type TargetTexts, targetsOf, textsOf, useFormatTarget } from './targets';

type CategoryInput = z.input<typeof upsertCategorySchema>;
type PolicyInput = z.input<typeof upsertSlaPolicySchema>;
type Policies = ReturnType<typeof usePolicies>;
type SlaMode = 'standard' | 'own';

const KEY_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
const ALL_PRIORITIES = [...PRIORITIES];
const NO_CALENDARS: CalendarDto[] = [];
const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);

/** The coverage context with this (possibly new or moved) category in place. */
function withCategory(
  ctx: CoverageContext,
  c: { id: string; key: string; parentId: string | null },
): CoverageContext {
  return { categories: [...ctx.categories.filter((x) => x.id !== c.id && x.key !== c.key), c] };
}

/** "SLA: Hardware incidents" when the category has policies of its own, "Standard SLA" otherwise. */
function useCategorySla(policies: Policies) {
  const t = useTranslations('itsm.settingsPage.categories');
  const format = useFormatter();
  const { ordered, asCoverage, coverage, nameOf } = policies;
  return (c: Category) => {
    const won = categoryPolicies({ key: c.key, ticketTypes: c.ticketTypes }, asCoverage, coverage);
    if (!won.length) return null;
    const own = [...new Set(won.flatMap((w) => w.policyIds))].filter((id) =>
      readsCategory(ordered.find((p) => p.id === id)?.condition),
    );
    return own.length
      ? { own: true, text: t('slaOwn', { names: format.list(own.map(nameOf), { type: 'conjunction' }) }) }
      : { own: false, text: t('slaStandard') };
  };
}

function CategoryForm({
  category,
  policies,
  calendars,
  onDone,
}: {
  category: Category | null;
  policies: Policies;
  calendars: CalendarDto[];
  onDone: () => void;
}) {
  const t = useTranslations('itsm.settingsPage.categories');
  const ts = useTranslations('itsm.settingsPage');
  const tt = useTranslations('itsm');
  const tc = useTranslations('common');
  const locale = useLocale();
  const format = useFormatter();
  const formatTarget = useFormatTarget();
  const id = useId();
  const { ordered, asCoverage, coverage, nameOf } = policies;
  const own = category ? ownPolicyOf(category.key, ordered) : null;

  const [key, setKey] = useState(category?.key ?? '');
  const [keyTouched, setKeyTouched] = useState(Boolean(category));
  const [name, setName] = useState<LocalizedText>(category?.name ?? {});
  const [parentId, setParentId] = useState<string | null>(category?.parentId ?? null);
  const [types, setTypes] = useState<TicketType[]>(category?.ticketTypes ?? ['incident', 'service_request']);
  const [groupId, setGroupId] = useState<string | null>(category?.defaultGroup?.id ?? null);
  const [active, setActive] = useState(category?.active ?? true);
  const [mode, setMode] = useState<SlaMode>(own?.active ? 'own' : 'standard');
  const [slaTypes, setSlaTypes] = useState<TicketType[] | null>(own ? [...own.ticketTypes] : null);
  const [texts, setTexts] = useState<TargetTexts | null>(own ? textsOf(own.targets, formatTarget) : null);
  const [same, setSame] = useState<boolean | null>(null);
  const [calendarId, setCalendarId] = useState(own?.calendar.id ?? '');
  const [touched, setTouched] = useState(false);
  /** The category once saved: a retry after the SLA step failed must not create it twice. */
  const saved = useRef<Category | null>(category);

  // What the SLA section works out: the category in the tree as it is being edited.
  const selfId = category?.id ?? '__new__';
  const ctx = withCategory(coverage, { id: selfId, key, parentId });
  const others = asCoverage.filter((p) => p.id !== own?.id);
  const withSla = types.filter((ty) => others.some((p) => p.active && p.ticketTypes.includes(ty)));
  const shownSlaTypes = (slaTypes ?? withSla.slice(0, 1)).filter((ty) => types.includes(ty));
  const condition: Condition = { fact: 'ticket.categoryKeys', op: 'eq', value: key };
  const placement = placementFor({ ticketTypes: shownSlaTypes, condition }, others, ctx);
  const source = ordered.find((p) => p.id === placement) ?? null;
  const shownTexts = texts ?? textsOf(source?.targets, formatTarget);
  const shownSame = same ?? allSame(shownTexts, ALL_PRIORITIES);
  const shownCalendar = calendarId || source?.calendar.id || calendars[0]?.id || '';
  const targets = targetsOf(shownTexts, ALL_PRIORITIES, shownSame);
  const standard = categoryPolicies({ key, ticketTypes: types }, others as CoveragePolicy[], ctx).flatMap(
    (w) => w.policyIds,
  );
  /** Other policies that name this category (more than one rule): edited on the SLA policies tab. */
  const related = ordered.filter(
    (p) => p.id !== own?.id && category && readsCategory(p.condition) && standard.includes(p.id),
  );

  /** An existing own policy that sits after the place it needs moves there when saved. */
  const ownIndex = own ? ordered.findIndex((p) => p.id === own.id) : -1;
  const moveOwn = Boolean(own && placement && ordered.findIndex((p) => p.id === placement) < ownIndex);

  const errors = {
    name: !Object.values(name).some((v) => v?.trim()),
    key: !KEY_RE.test(key),
    types: !types.length,
    slaTypes: mode === 'own' && !shownSlaTypes.length,
    targets: mode === 'own' && !targets,
  };
  const invalid = Object.values(errors).some(Boolean);
  const snapshot = JSON.stringify([
    key,
    name,
    parentId,
    types,
    groupId,
    active,
    mode,
    slaTypes,
    texts,
    same,
    calendarId,
  ]);
  const [initial] = useState(snapshot);
  const dirty = snapshot !== initial;

  const save = useApiMutation(
    async (api, body: CategoryInput) => {
      const cat = saved.current
        ? await api.patch<Category>(`/itsm/categories/${saved.current.id}`, body)
        : await api.post<Category>('/itsm/categories', body);
      saved.current = cat;
      const keyChanged = own && (own.condition as { value?: unknown } | null)?.value !== cat.key;
      const ownCondition = own ? { ...(own.condition as object), value: cat.key } : condition;
      if (mode === 'own' && targets) {
        const sla = { ticketTypes: shownSlaTypes, targets, calendarId: shownCalendar, active: true };
        if (own)
          await api.patch(`/itsm/sla-policies/${own.id}`, {
            ...sla,
            ...(keyChanged ? { condition: ownCondition } : {}),
            ...(moveOwn && placement ? { placeBefore: placement } : {}),
          });
        else
          await api.post<SlaPolicy>('/itsm/sla-policies', {
            ...sla,
            name: cat.name,
            description: null,
            condition: { ...condition, value: cat.key },
            pauseStatuses: source?.pauseStatuses ?? [...DEFAULT_PAUSE_STATUSES],
            warnAt: source?.warnAt ?? 0.75,
          } satisfies PolicyInput);
      } else if (own && (own.active || keyChanged))
        await api.patch(`/itsm/sla-policies/${own.id}`, {
          active: false,
          ...(keyChanged ? { condition: ownCondition } : {}),
        });
      return cat;
    },
    { invalidate: INVALIDATE, success: tc('saved'), onSuccess: onDone },
  );
  const remove = useApiMutation((api) => api.delete(`/itsm/categories/${category!.id}`), {
    invalidate: INVALIDATE,
    success: tc('deleted'),
    onSuccess: onDone,
  });

  return (
    <SheetContent className="sm:max-w-xl" closeLabel={tc('close')} dirty={dirty && !save.isSuccess}>
      <SheetForm
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (invalid) return;
          save.mutate({ key, name, parentId, ticketTypes: types, defaultGroupId: groupId, active });
        }}
      >
        <SheetHeader>
          <SheetTitle>{category ? t('editTitle') : t('createTitle')}</SheetTitle>
          <SheetDescription>{t('sheetHint')}</SheetDescription>
        </SheetHeader>
        <SheetBody className="grid content-start gap-5 pb-6">
          <div className="grid gap-2">
            <Label htmlFor={`${id}-name`}>{t('name')}</Label>
            <LocalizedInput
              id={`${id}-name`}
              value={name}
              onChange={(v) => {
                setName(v);
                if (!keyTouched) setKey(slug(v.en ?? ''));
              }}
              invalid={touched && errors.name}
              aria-describedby={`${id}-name-hint`}
            />
            <p
              id={`${id}-name-hint`}
              className={cn(
                'text-xs',
                touched && errors.name ? 'text-sm text-destructive' : 'text-muted-foreground',
              )}
            >
              {touched && errors.name ? t('nameRequired') : t('nameHint')}
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-parent`}>{t('parent')}</Label>
            <CategorySelect
              id={`${id}-parent`}
              value={parentId}
              onChange={setParentId}
              includeInactive
              excludeId={category?.id}
              noneLabel={t('topLevel')}
            />
          </div>
          <TypeChecks
            label={t('types')}
            value={types}
            onChange={setTypes}
            invalid={touched && errors.types}
            describedBy={touched && errors.types ? `${id}-types-error` : undefined}
          />
          {touched && errors.types && (
            <p id={`${id}-types-error`} className="-mt-3 text-sm text-destructive">
              {t('typesRequired')}
            </p>
          )}
          <div className="grid gap-2">
            <Label htmlFor={`${id}-group`}>{t('defaultGroup')}</Label>
            <DefaultGroupSelect
              id={`${id}-group`}
              value={groupId}
              onChange={setGroupId}
              aria-describedby={`${id}-group-hint`}
            />
            <p id={`${id}-group-hint`} className="text-xs text-muted-foreground">
              {t('defaultGroupHint')}
            </p>
          </div>

          <fieldset className="grid gap-3">
            <legend className="mb-1 text-sm font-medium">{t('sla.title')}</legend>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t('sla.title')}>
              {(['standard', 'own'] as const).map((m) => (
                <label
                  key={m}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors motion-reduce:transition-none has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
                    mode === m ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
                  )}
                >
                  <input
                    type="radio"
                    name={`${id}-sla`}
                    value={m}
                    checked={mode === m}
                    onChange={() => setMode(m)}
                    className="mt-0.5 accent-primary"
                  />
                  <span className="grid min-w-0 gap-0.5">
                    <span className="text-sm font-medium">{t(`sla.${m}`)}</span>
                    <span className="text-xs text-muted-foreground">
                      {m === 'standard'
                        ? standard.length
                          ? t('sla.standardHint', {
                              names: format.list(standard.filter((p) => p !== own?.id).map(nameOf), {
                                type: 'conjunction',
                              }),
                            })
                          : t('sla.noStandard')
                        : t('sla.ownHint')}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {mode === 'own' && (
              <div className="grid gap-4 rounded-lg border p-3">
                <CheckGroup
                  label={t('sla.types')}
                  options={types}
                  value={shownSlaTypes}
                  onChange={setSlaTypes}
                  invalid={touched && errors.slaTypes}
                  render={(ty) => tt(`typesPlural.${ty}`)}
                />
                <TargetsEditor
                  value={shownTexts}
                  onChange={setTexts}
                  visible={ALL_PRIORITIES}
                  same={shownSame}
                  onSameChange={setSame}
                  showErrors={touched}
                  copiedFrom={!texts && source ? localize(source.name, locale) : null}
                />
                <div className="grid gap-2">
                  <Label htmlFor={`${id}-calendar`}>{t('sla.calendar')}</Label>
                  <Select value={shownCalendar || undefined} onValueChange={setCalendarId}>
                    <SelectTrigger id={`${id}-calendar`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {calendars.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.alwaysOpen && !/24\s*[×x]\s*7/i.test(c.name)
                            ? ts('sla.calendarAlwaysOpen', { name: c.name })
                            : c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground">
                  {placement && (!own || moveOwn)
                    ? t('sla.placed', { name: nameOf(placement) })
                    : t('sla.subcategories')}
                </p>
              </div>
            )}
            {(own || related.length > 0) && (
              <p className="text-xs text-muted-foreground">
                <Link
                  href={own ? `/itsm/settings?tab=sla&edit=${own.id}` : '/itsm/settings?tab=sla'}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  {own ? t('sla.editPolicy') : t('sla.related', { count: related.length })}
                </Link>
              </p>
            )}
          </fieldset>

          {category && (
            <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
              <Label htmlFor={`${id}-active`} className="flex-col items-start gap-0.5">
                <span>{t('active')}</span>
                <span className="text-xs font-normal text-muted-foreground">{t('activeHint')}</span>
              </Label>
              <Switch id={`${id}-active`} checked={active} onCheckedChange={setActive} />
            </div>
          )}

          <OptionalFields label={ts('advanced')} hint={t('key')}>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-key`}>{t('key')}</Label>
              <Input
                id={`${id}-key`}
                value={key}
                onChange={(e) => {
                  setKey(e.target.value.toLowerCase());
                  setKeyTouched(true);
                }}
                className="font-mono"
                aria-invalid={touched && errors.key ? true : undefined}
                aria-describedby={`${id}-key-hint`}
              />
              <p
                id={`${id}-key-hint`}
                className={cn(
                  'text-xs',
                  touched && errors.key ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                {category ? t('keyHintEdit') : t('keyHint')}
              </p>
            </div>
          </OptionalFields>
          {touched && invalid && (
            <p role="alert" className="text-sm text-destructive">
              {errors.key && !errors.name ? t('keyInvalid') : ts('sla.fixErrors')}
            </p>
          )}
        </SheetBody>
        <SheetFooter>
          {category && (
            <DeleteButton
              title={t('deleteTitle')}
              description={t('deleteBody')}
              onConfirm={() => remove.mutate(undefined)}
              pending={remove.isPending}
            />
          )}
          <Button type="button" variant="outline" onClick={onDone}>
            {tc('cancel')}
          </Button>
          <Button type="submit" loading={save.isPending}>
            {tc('save')}
          </Button>
        </SheetFooter>
      </SheetForm>
    </SheetContent>
  );
}

/** Ticket categories as a tree in their order, with what each is offered for, its group and its SLA. */
export function CategoriesTab() {
  const t = useTranslations('itsm.settingsPage.categories');
  const ts = useTranslations('itsm.settingsPage');
  const tt = useTranslations('itsm');
  const format = useFormatter();
  const { tree, isLoading, error, categories } = useCategories(undefined, true);
  const policies = usePolicies();
  const calendars = useApiQuery<{ items: CalendarDto[] }>('/itsm/calendars');
  const slaOf = useCategorySla(policies);
  const sheet = useSheetParam();
  const target = sheet.editing ?? (sheet.creating ? 'new' : null);
  const [session, setSession] = useState({ target, last: target, n: 0 });
  if (target !== session.target)
    setSession({ target, last: target ?? session.last, n: target !== null ? session.n + 1 : session.n });
  const editing = categories.find((c) => c.id === session.last) ?? null;
  const ready = !policies.query.isLoading && !calendars.isLoading;
  const open = ready && (sheet.creating || (sheet.editing !== null && Boolean(editing)));

  const reorder = useApiMutation(
    (api, v: { parentId: string | null; ids: string[]; focus: { id: string; direction: -1 | 1 } }) =>
      api.put('/itsm/categories/order', { parentId: v.parentId, ids: v.ids }),
    { invalidate: INVALIDATE, onSuccess: (_r, v) => refocus(`cat-${v.focus.id}`, v.focus.direction) },
  );
  const siblingsOf = (c: Category) =>
    tree.filter((n) => (n.category.parentId ?? null) === (c.parentId ?? null));
  const typesText = (c: Category) =>
    c.ticketTypes.length === ticketTypeSchema.options.length
      ? t('allTypes')
      : format.list(
          c.ticketTypes.map((ty) => tt(`typesPlural.${ty}`)),
          { type: 'conjunction' },
        );

  return (
    <section className="grid gap-4" aria-labelledby="itsm-categories-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="itsm-categories-title" className="text-lg font-semibold">
            {t('title')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
        <Button onClick={sheet.openCreate}>
          <PlusIcon />
          {t('new')}
        </Button>
      </div>
      {error ? (
        <ErrorState error={error} kind="list" className="rounded-xl border" />
      ) : isLoading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : !tree.length ? (
        <EmptyState
          icon={<FolderTreeIcon />}
          title={t('empty')}
          className="rounded-xl border border-dashed"
        />
      ) : (
        <AnimatedList className="divide-y overflow-hidden rounded-xl border bg-card" aria-label={t('title')}>
          {tree.map((n) => {
            const c = n.category;
            const siblings = siblingsOf(c);
            const index = siblings.findIndex((s) => s.category.id === c.id);
            const sla = slaOf(c);
            return (
              <AnimatedItem
                key={c.id}
                className={cn('flex min-w-0 items-center gap-3 px-4 py-2.5', !c.active && 'bg-muted/30')}
              >
                <div
                  className="flex min-w-0 flex-1 items-start gap-2"
                  style={{ paddingInlineStart: `${n.depth * 1.25}rem` }}
                >
                  {n.depth > 0 && (
                    <span className="text-muted-foreground" aria-hidden>
                      └
                    </span>
                  )}
                  <div className="grid min-w-0 gap-0.5">
                    <p className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className={cn('truncate font-medium', !c.active && 'text-muted-foreground')}>
                        {n.name}
                      </span>
                      {!c.active && <Badge variant="muted">{t('inactive')}</Badge>}
                    </p>
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      <span className="hidden sm:inline">{typesText(c)}</span>
                      {c.defaultGroup && <span>{c.defaultGroup.name}</span>}
                      {sla && (
                        <span
                          className={cn(
                            'items-center gap-1',
                            sla.own ? 'inline-flex text-foreground' : 'hidden sm:inline-flex',
                          )}
                        >
                          <TimerIcon className="size-3" aria-hidden />
                          {sla.text}
                        </span>
                      )}
                      <span className="tabular-nums">{t('tickets', { count: c.ticketCount })}</span>
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {siblings.length > 1 && (
                    <MoveButtons
                      name={n.path}
                      first={index === 0}
                      last={index === siblings.length - 1}
                      pending={reorder.isPending}
                      idPrefix={`cat-${c.id}`}
                      onMove={(direction) =>
                        reorder.mutate({
                          parentId: c.parentId ?? null,
                          ids: moved(
                            siblings.map((s) => s.category.id),
                            index,
                            direction,
                          ),
                          focus: { id: c.id, direction },
                        })
                      }
                    />
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => sheet.openEdit(c.id)}
                    aria-label={ts('editItem', { name: n.path })}
                  >
                    <PencilIcon />
                  </Button>
                </div>
              </AnimatedItem>
            );
          })}
        </AnimatedList>
      )}
      <Sheet open={open} onOpenChange={(o) => !o && sheet.close()}>
        {(open || session.n > 0) && (
          <CategoryForm
            key={session.n}
            category={editing}
            policies={policies}
            calendars={calendars.data?.items ?? NO_CALENDARS}
            onDone={sheet.close}
          />
        )}
      </Sheet>
    </section>
  );
}
