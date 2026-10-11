'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { type Condition, localize, type LocalizedText } from '@isbp/sdk';
import { Card } from '@isbp/ui/card';
import { EmptyState, ErrorState } from '@isbp/ui/empty-state';
import { LocalizedInput } from '@isbp/ui/localized-input';
import { AnimatedItem, AnimatedList } from '@isbp/ui/motion';
import { OptionalFields } from '@isbp/ui/optional-fields';
import { useApiMutation, useApiQuery } from '@isbp/ui/query';
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
import { FolderTreeIcon, PencilIcon, PlusIcon, TimerIcon } from 'lucide-react';
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
  SettingsSection,
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
/** Indent step (spacing scale) of a category per depth in the tree. */
const INDENT = [3, 6, 8, 10] as const;
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
        <SheetBody className="pb-6">
          <FormLayout defaultOptionality="optional">
            <Field
              label={t('name')}
              isRequired
              inputID={`${id}-name`}
              description={touched && errors.name ? undefined : t('nameHint')}
              status={touched && errors.name ? { type: 'error', message: t('nameRequired') } : undefined}
              statusVariant="detached"
            >
              <LocalizedInput
                id={`${id}-name`}
                value={name}
                onChange={(v) => {
                  setName(v);
                  if (!keyTouched) setKey(slug(v.en ?? ''));
                }}
                invalid={touched && errors.name}
              />
            </Field>
            <CategorySelect
              label={t('parent')}
              value={parentId}
              onChange={setParentId}
              includeInactive
              excludeId={category?.id}
              noneLabel={t('topLevel')}
            />
            <TypeChecks
              label={t('types')}
              value={types}
              onChange={setTypes}
              invalid={touched && errors.types}
            />
            <DefaultGroupSelect
              label={t('defaultGroup')}
              description={t('defaultGroupHint')}
              value={groupId}
              onChange={setGroupId}
            />

            <VStack gap={3}>
              <RadioList label={t('sla.title')} value={mode} onChange={(m) => setMode(m as SlaMode)}>
                {(['standard', 'own'] as const).map((m) => (
                  <RadioListItem
                    key={m}
                    value={m}
                    label={t(`sla.${m}`)}
                    description={
                      m === 'standard'
                        ? standard.length
                          ? t('sla.standardHint', {
                              names: format.list(standard.filter((p) => p !== own?.id).map(nameOf), {
                                type: 'conjunction',
                              }),
                            })
                          : t('sla.noStandard')
                        : t('sla.ownHint')
                    }
                  />
                ))}
              </RadioList>
              {mode === 'own' && (
                <VStack gap={4}>
                  <CheckGroup
                    label={t('sla.types')}
                    options={types}
                    value={shownSlaTypes}
                    onChange={setSlaTypes}
                    error={touched && errors.slaTypes ? t('typesRequired') : undefined}
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
                  <Selector
                    label={t('sla.calendar')}
                    value={shownCalendar || undefined}
                    onChange={setCalendarId}
                    options={calendars.map((c) => ({
                      value: c.id,
                      label:
                        c.alwaysOpen && !/24\s*[×x]\s*7/i.test(c.name)
                          ? ts('sla.calendarAlwaysOpen', { name: c.name })
                          : c.name,
                    }))}
                  />
                  <Text as="p" type="supporting">
                    {placement && (!own || moveOwn)
                      ? t('sla.placed', { name: nameOf(placement) })
                      : t('sla.subcategories')}
                  </Text>
                </VStack>
              )}
              {(own || related.length > 0) && (
                <Text as="p" type="supporting">
                  <Link
                    href={own ? `/itsm/settings?tab=sla&edit=${own.id}` : '/itsm/settings?tab=sla'}
                    weight="medium"
                  >
                    {own ? t('sla.editPolicy') : t('sla.related', { count: related.length })}
                  </Link>
                </Text>
              )}
            </VStack>

            {category && (
              <Switch label={t('active')} description={t('activeHint')} value={active} onChange={setActive} />
            )}

            <OptionalFields label={ts('advanced')} hint={t('key')}>
              <TextInput
                label={t('key')}
                value={key}
                onChange={(v) => {
                  setKey(v.toLowerCase());
                  setKeyTouched(true);
                }}
                description={touched && errors.key ? undefined : category ? t('keyHintEdit') : t('keyHint')}
                status={
                  touched && errors.key
                    ? { type: 'error', message: category ? t('keyHintEdit') : t('keyHint') }
                    : undefined
                }
                statusVariant="detached"
              />
            </OptionalFields>
            {touched && invalid && (
              <Banner
                status="error"
                title={errors.key && !errors.name ? t('keyInvalid') : ts('sla.fixErrors')}
                collapsible={false}
              />
            )}
          </FormLayout>
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
          <Button label={tc('cancel')} variant="secondary" onClick={onDone} />
          <Button label={tc('save')} variant="primary" isLoading={save.isPending} type="submit" />
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
    <SettingsSection
      id="itsm-categories-title"
      title={t('title')}
      description={t('description')}
      action={
        <Button
          label={t('new')}
          variant="primary"
          icon={<Icon icon={PlusIcon} />}
          onClick={sheet.openCreate}
        />
      }
    >
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
        <Card className="gap-0 overflow-hidden py-0">
          <AnimatedList className="divide-y" aria-label={t('title')}>
            {tree.map((n) => {
              const c = n.category;
              const siblings = siblingsOf(c);
              const index = siblings.findIndex((s) => s.category.id === c.id);
              const sla = slaOf(c);
              return (
                <AnimatedItem key={c.id}>
                  <HStack
                    gap={3}
                    padding={3}
                    vAlign="center"
                    paddingInlineStart={INDENT[Math.min(n.depth, 3)]}
                  >
                    <StackItem size="fill">
                      <VStack gap={0.5}>
                        <HStack gap={2} wrap="wrap" vAlign="center">
                          <Text weight="medium" color={c.active ? 'primary' : 'secondary'}>
                            {n.name}
                          </Text>
                          {!c.active && <Badge variant="neutral" label={t('inactive')} />}
                        </HStack>
                        <HStack gap={3} wrap="wrap" vAlign="center">
                          <span className="hidden sm:inline">
                            <Text type="supporting">{typesText(c)}</Text>
                          </span>
                          {c.defaultGroup && <Text type="supporting">{c.defaultGroup.name}</Text>}
                          {sla && (
                            <span className={sla.own ? 'inline-flex' : 'hidden sm:inline-flex'}>
                              <HStack gap={1} vAlign="center">
                                <Icon icon={TimerIcon} size="xsm" color="secondary" />
                                <Text type="supporting" color={sla.own ? 'primary' : 'secondary'}>
                                  {sla.text}
                                </Text>
                              </HStack>
                            </span>
                          )}
                          <Text type="supporting" hasTabularNumbers>
                            {t('tickets', { count: c.ticketCount })}
                          </Text>
                        </HStack>
                      </VStack>
                    </StackItem>
                    <HStack gap={1} vAlign="center">
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
                      <IconButton
                        label={ts('editItem', { name: n.path })}
                        variant="ghost"
                        size="sm"
                        icon={<Icon icon={PencilIcon} />}
                        onClick={() => sheet.openEdit(c.id)}
                      />
                    </HStack>
                  </HStack>
                </AnimatedItem>
              );
            })}
          </AnimatedList>
        </Card>
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
    </SettingsSection>
  );
}
