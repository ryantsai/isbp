'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { DateInput } from '@astryxdesign/core/DateInput';
import { Icon as AstryxIcon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { cn } from '@isbp/ui';
import { UserAvatar } from '@isbp/ui/avatar';
import { EmptyState } from '@isbp/ui/empty-state';
import { StepTransition } from '@isbp/ui/motion';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import { SearchInput } from '@isbp/ui/search-input';
import { Skeleton } from '@isbp/ui/skeleton';
import { Stepper } from '@isbp/ui/stepper';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CircleDashedIcon,
  SearchXIcon,
  SendIcon,
  SkipForwardIcon,
  XCircleIcon,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import {
  type AccessRequest,
  type ApprovalStepPreview,
  addDays,
  type CatalogItem,
  checkDuration,
  defaultDateFor,
  type MyAccess,
  maxDateFor,
  RISKS,
  type RequestPreview,
  type ServerOption,
} from '../../contracts';
import { EngineLabel, RiskBadge } from '../badges';
import { asDay, INVALIDATE, requestHref, useDay, useLocalized, useToday } from '../lib';

const ALL = '__all__';
const STEPS = ['choose', 'details', 'review'] as const;
type Step = (typeof STEPS)[number];

interface Choice {
  expiresOn: string | null;
}

/**
 * The approval steps of the dry run, as the access request wizard shows them: who would be asked at each step,
 * steps a condition leaves out, and steps nobody could approve. The wording is the platform's (`requests.path`).
 */
function PreviewPath({ steps }: { steps: readonly ApprovalStepPreview[] }) {
  const t = useTranslations('requests.path');
  const l = useLocalized();
  const approvals = steps.filter((s) => s.type === 'approval');
  if (!approvals.length) return <p className="text-sm text-muted-foreground">{t('none')}</p>;
  return (
    <ol className="grid gap-5">
      {approvals.map((s, i) => {
        const nobody = s.outcome === 'no-approver' || s.outcome === 'reject';
        const Icon = s.outcome === 'skipped' ? SkipForwardIcon : nobody ? XCircleIcon : CircleDashedIcon;
        return (
          <li key={`${s.id}-${i}`} className="relative flex min-w-0 gap-3">
            {i < approvals.length - 1 && (
              <span aria-hidden className="absolute top-8 -bottom-5 left-[15px] w-px bg-border" />
            )}
            <span
              className={cn(
                'relative z-10 grid size-8 shrink-0 place-items-center rounded-full ring-4 ring-background [&_svg]:size-4',
                nobody ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground',
              )}
            >
              <Icon aria-hidden />
            </span>
            <div className="grid min-w-0 flex-1 content-start gap-1 pt-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-sm font-medium text-foreground/80 [overflow-wrap:anywhere]">
                  {l(s.name)}
                </span>
                <span className="text-xs font-medium text-muted-foreground">
                  {s.outcome === 'skipped' ? t('state.skipped') : t('state.preview')}
                </span>
              </div>
              {s.outcome === 'skipped' && (
                <p className="text-sm text-muted-foreground">{t('skippedCondition')}</p>
              )}
              {nobody && <p className="text-sm text-destructive">{t('noApprover')}</p>}
              {s.people.length > 0 && (
                <ul className="mt-0.5 flex flex-wrap gap-1.5" aria-label={t('peopleLabel')}>
                  {s.people.slice(0, 4).map((p) => (
                    <li
                      key={p.id}
                      className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border py-0.5 pr-2.5 pl-0.5 text-xs"
                    >
                      <UserAvatar name={p.displayName} className="size-5 text-[9px]" />
                      <span className="truncate">{p.displayName}</span>
                    </li>
                  ))}
                  {s.people.length > 4 && (
                    <li className="self-center text-xs text-muted-foreground">
                      {t('more', { count: s.people.length - 4 })}
                    </li>
                  )}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function RoleRow({
  item,
  checked,
  onChange,
}: {
  item: CatalogItem;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const t = useTranslations('dbaccess.wizard');
  const l = useLocalized();
  const day = useDay();
  const unavailable = Boolean(item.heldGrantId || item.pendingRequest);
  return (
    <li className={cn('grid min-w-0 gap-1 px-4 py-3', checked && 'bg-primary/5')}>
      <CheckboxInput label={l(item.name)} value={checked} isDisabled={unavailable} onChange={onChange} />
      <VStack gap={1} className="min-w-0 pl-7">
        {item.description && (
          <Text type="supporting" maxLines={2}>
            {l(item.description)}
          </Text>
        )}
        <HStack gap={3} wrap="wrap" vAlign="center" className="min-w-0">
          <Text type="supporting" maxLines={1}>
            {item.server.displayName}
          </Text>
          <EngineLabel engine={item.server.engine} />
          <Text type="code" color="secondary" maxLines={1}>
            {item.database ? `${item.database}.` : ''}
            {item.roleName}
          </Text>
        </HStack>
        <HStack gap={2} wrap="wrap" vAlign="center">
          <RiskBadge risk={item.risk} />
          <Text type="supporting">
            {item.maxDays
              ? t('maxDays', { days: item.maxDays })
              : item.allowPermanent
                ? t('permanentAllowed')
                : ''}
          </Text>
          {item.owner && <Text type="supporting">{t('approvedBy', { owner: item.owner.name })}</Text>}
        </HStack>
        {item.heldGrantId && (
          <HStack>
            <Badge
              variant="success"
              label={item.heldUntil ? t('heldUntil', { date: day(item.heldUntil) }) : t('held')}
            />
          </HStack>
        )}
        {item.pendingRequest && (
          <Link href={requestHref(item.pendingRequest.reference)}>
            {t('pending', { reference: item.pendingRequest.reference })}
          </Link>
        )}
      </VStack>
    </li>
  );
}

/** The request wizard: choose roles → end date and justification → review the approval path → send. */
export default function RequestPage() {
  const t = useTranslations('dbaccess.wizard');
  const tr = useTranslations('dbaccess.risk');
  const ta = useTranslations('requests.access');
  const l = useLocalized();
  const day = useDay();
  const today = useToday();
  const router = useRouter();
  const params = useSearchParams();
  const errorText = useErrorText();
  const extend = params.get('extend');
  const preselected = params.get('role');

  const [q, setQ] = useState('');
  const [serverId, setServerId] = useState<string>(ALL);
  const [risk, setRisk] = useState<string>(ALL);
  const [database, setDatabase] = useState<string>(ALL);
  const [step, setStep] = useState<Step>(extend ? 'details' : 'choose');
  const [picked, setPicked] = useState<Record<string, Choice>>({});
  const [touched, setTouched] = useState(false);
  const [justification, setJustification] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const catalog = useApiQuery<{ items: CatalogItem[] }>('/dbaccess/catalog', {
    q: q || undefined,
    serverId: serverId === ALL ? undefined : serverId,
    risk: risk === ALL ? undefined : risk,
    database: database === ALL ? undefined : database,
  });
  const all = useApiQuery<{ items: CatalogItem[] }>('/dbaccess/catalog');
  const servers = useApiQuery<{ items: ServerOption[] }>('/dbaccess/lookups/servers');
  const mine = useApiQuery<MyAccess>(extend ? '/dbaccess/me/access' : null);
  const extended = extend ? mine.data?.grants.find((g) => g.id === extend) : undefined;

  const byId = useMemo(() => new Map((all.data?.items ?? []).map((i) => [i.id, i])), [all.data]);
  const databases = useMemo(
    () =>
      [
        ...new Set((all.data?.items ?? []).map((i) => i.database).filter((d): d is string => Boolean(d))),
      ].sort(),
    [all.data],
  );
  // Pre-fill from the URL (extension of a grant, or a role link) once the catalog is there.
  const seeded = extend ? (extended ? extended.role.id : null) : preselected;
  const effective = useMemo(() => {
    if (touched || !seeded) return picked;
    const item = byId.get(seeded);
    if (!item) return picked;
    const base = extended?.expiresAt ? extended.expiresAt.slice(0, 10) : today;
    const proposed = defaultDateFor(item, base > today ? base : today);
    const max = maxDateFor(item, today);
    return { [seeded]: { expiresOn: proposed && max && proposed > max ? max : proposed } };
  }, [touched, picked, seeded, byId, extended, today]);
  const chosen = Object.entries(effective)
    .map(([id, c]) => ({ item: byId.get(id), choice: c }))
    .filter((x): x is { item: CatalogItem; choice: Choice } => Boolean(x.item));
  const needsJustification = chosen.some((c) => c.item.justificationRequired);

  const setChoice = (id: string, c: Choice | null) => {
    const next = { ...effective };
    if (c) next[id] = c;
    else delete next[id];
    setTouched(true);
    setPicked(next);
  };

  const submit = useApiMutation(
    (api) =>
      api.post<{ items: AccessRequest[] }>('/dbaccess/requests', {
        items: chosen.map((c) => ({ roleId: c.item.id, expiresOn: c.choice.expiresOn })),
        justification: justification.trim(),
        extensionOf: extend && extended ? extend : null,
      }),
    {
      invalidate: INVALIDATE,
      silent: true,
      success: (r) => t('sent', { count: r.items.length }),
      onSuccess: (r) => router.push(r.items.length === 1 ? requestHref(r.items[0]!.reference) : '/dbaccess'),
    },
  );

  // "Who will approve it": a dry run of each role's approval workflow, asked for when the review step opens.
  const preview = useApiMutation(
    (api, items: { roleId: string; expiresOn: string | null }[]) =>
      api.post<RequestPreview>('/dbaccess/requests/preview', { items }),
    { silent: true },
  );
  const pathOf = new Map((preview.data?.items ?? []).map((i) => [i.roleId, i.steps]));

  const detailsProblem = (): string | null => {
    for (const c of chosen) {
      const check = checkDuration(c.item, c.choice.expiresOn, today);
      if (check === 'past') return t('errors.past', { role: l(c.item.name) });
      if (check === 'too_long')
        return t('errors.tooLong', { role: l(c.item.name), days: c.item.maxDays ?? 0 });
      if (check === 'permanent_not_allowed') return t('errors.dateRequired', { role: l(c.item.name) });
    }
    if (needsJustification && justification.trim().length < 10) return t('errors.justification');
    return null;
  };

  const go = (next: Step) => {
    setProblem(null);
    if (next === 'review') {
      const p = detailsProblem();
      if (p) {
        setProblem(p);
        return;
      }
      preview.mutate(chosen.map((c) => ({ roleId: c.item.id, expiresOn: c.choice.expiresOn })));
    }
    setStep(next);
  };

  return (
    <>
      <PageHeader
        back={
          extend
            ? { href: '/dbaccess', label: t('myAccess') }
            : { href: '/requests', label: ta('backToRequests') }
        }
        title={extend ? t('extendTitle') : t('title')}
        description={extend ? t('extendDescription') : t('description')}
      />
      <div className="grid min-w-0 grid-cols-1 gap-4">
        <Stepper
          steps={STEPS.map((s) => ({ id: s, label: t(`step.${s}`) }))}
          current={STEPS.indexOf(step)}
          label={t('steps')}
        />
        <StepTransition step={STEPS.indexOf(step)}>
          {step === 'choose' && (
            <section aria-labelledby="dbaccess-choose" className="grid min-w-0 gap-4">
              <h2 id="dbaccess-choose" className="sr-only">
                {t('step.choose')}
              </h2>
              <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3">
                <SearchInput value={q} onChange={setQ} placeholder={t('search')} className="sm:w-72" />
                <Selector
                  label={t('server')}
                  isLabelHidden
                  width={224}
                  value={serverId}
                  onChange={setServerId}
                  options={[
                    { value: ALL, label: t('allServers') },
                    ...(servers.data?.items ?? [])
                      .filter((s) => s.roles > 0)
                      .map((s) => ({ value: s.id, label: s.displayName })),
                  ]}
                />
                {databases.length > 0 && (
                  <Selector
                    label={t('database')}
                    isLabelHidden
                    width={176}
                    value={database}
                    onChange={setDatabase}
                    options={[
                      { value: ALL, label: t('allDatabases') },
                      ...databases.map((d) => ({ value: d, label: d })),
                    ]}
                  />
                )}
                <Selector
                  label={t('risk')}
                  isLabelHidden
                  width={160}
                  value={risk}
                  onChange={setRisk}
                  options={[
                    { value: ALL, label: t('allRisks') },
                    ...RISKS.map((r) => ({ value: r, label: tr(r) })),
                  ]}
                />
              </div>
              <div className="min-w-0 overflow-hidden rounded-xl border bg-card">
                {catalog.isLoading ? (
                  <Skeleton className="h-64 w-full" />
                ) : !catalog.data?.items.length ? (
                  <EmptyState icon={<SearchXIcon />} title={t('noRoles')} description={t('noRolesHint')} />
                ) : (
                  <ul className="divide-y" aria-label={t('roles')}>
                    {catalog.data.items.map((item) => (
                      <RoleRow
                        key={item.id}
                        item={item}
                        checked={Boolean(effective[item.id])}
                        onChange={(v) =>
                          setChoice(item.id, v ? { expiresOn: defaultDateFor(item, today) } : null)
                        }
                      />
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  {t('selected', { count: chosen.length })}
                </p>
                <Button
                  label={t('continue')}
                  variant="primary"
                  endContent={<AstryxIcon icon={ArrowRightIcon} />}
                  isDisabled={!chosen.length}
                  onClick={() => go('details')}
                />
              </div>
            </section>
          )}

          {step === 'details' && (
            <section aria-labelledby="dbaccess-details" className="grid min-w-0 gap-4">
              <h2 id="dbaccess-details" className="text-lg font-semibold">
                {t('step.details')}
              </h2>
              {extend && !extended && (mine.isLoading || all.isLoading) ? (
                <Skeleton className="h-40 w-full rounded-xl" />
              ) : (
                <ul className="grid gap-3">
                  {chosen.map(({ item, choice }) => (
                    <DurationRow
                      key={item.id}
                      item={item}
                      choice={choice}
                      today={today}
                      onChange={(c) => setChoice(item.id, c)}
                    />
                  ))}
                </ul>
              )}
              <div className="rounded-xl border bg-card p-4">
                <TextArea
                  label={t('justification')}
                  isRequired={needsJustification}
                  isOptional={!needsJustification}
                  rows={4}
                  maxLength={2_000}
                  value={justification}
                  placeholder={t('justificationPlaceholder')}
                  description={t('justificationHint')}
                  onChange={(value) => setJustification(value.slice(0, 2_000))}
                />
              </div>
              {problem && <Banner status="error" title={problem} collapsible={false} />}
              <div className="flex flex-wrap items-center justify-between gap-3">
                {extend ? (
                  <span />
                ) : (
                  <Button
                    label={t('back')}
                    variant="secondary"
                    icon={<AstryxIcon icon={ArrowLeftIcon} />}
                    onClick={() => go('choose')}
                  />
                )}
                <Button
                  label={t('reviewStep')}
                  variant="primary"
                  endContent={<AstryxIcon icon={ArrowRightIcon} />}
                  isDisabled={!chosen.length}
                  onClick={() => go('review')}
                />
              </div>
            </section>
          )}

          {step === 'review' && (
            <section
              aria-labelledby="dbaccess-review"
              className="grid min-w-0 gap-4 lg:grid-cols-[1fr_minmax(0,22rem)]"
            >
              <div className="grid min-w-0 content-start gap-5 rounded-xl border bg-card p-4 sm:p-5">
                <h2 id="dbaccess-review" className="text-base font-semibold">
                  {ta('summary')}
                </h2>
                <ul className="divide-y rounded-lg border text-sm">
                  {chosen.map(({ item, choice }) => (
                    <li
                      key={item.id}
                      className="flex min-w-0 flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{l(item.name)}</span>
                        <span className="block truncate text-muted-foreground">
                          {item.server.displayName}
                        </span>
                      </span>
                      <RiskBadge risk={item.risk} />
                      <span className="shrink-0">
                        {choice.expiresOn ? t('until', { date: day(choice.expiresOn) }) : t('noEndDate')}
                      </span>
                    </li>
                  ))}
                </ul>
                {justification.trim() && (
                  <dl className="text-sm">
                    <dt className="text-xs text-muted-foreground">{ta('why')}</dt>
                    <dd className="mt-0.5 whitespace-pre-line">{justification.trim()}</dd>
                  </dl>
                )}
                {submit.error && (
                  <Banner status="error" title={errorText(submit.error)} collapsible={false} />
                )}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Button
                    label={t('back')}
                    variant="ghost"
                    icon={<AstryxIcon icon={ArrowLeftIcon} />}
                    onClick={() => go('details')}
                  />
                  <Button
                    label={t('send')}
                    variant="primary"
                    icon={<AstryxIcon icon={SendIcon} />}
                    isLoading={submit.isPending}
                    onClick={() => submit.mutate(undefined)}
                  />
                </div>
              </div>
              <aside
                className="grid min-w-0 content-start gap-3 rounded-xl border bg-muted/30 p-4"
                aria-live="polite"
              >
                <h2 className="text-base font-semibold">{ta('path.title')}</h2>
                <p className="text-sm text-muted-foreground">{ta('path.description')}</p>
                {preview.isError ? (
                  <p className="text-sm text-destructive">{errorText(preview.error)}</p>
                ) : !preview.data ? (
                  <Skeleton className="h-32 w-full rounded-lg" />
                ) : chosen.length === 1 ? (
                  <PreviewPath steps={pathOf.get(chosen[0]!.item.id) ?? []} />
                ) : (
                  chosen.map(({ item }) => (
                    <section
                      key={item.id}
                      className="grid gap-3 border-t pt-3 first-of-type:border-t-0 first-of-type:pt-0"
                    >
                      <h3 className="text-sm font-semibold [overflow-wrap:anywhere]">{l(item.name)}</h3>
                      <PreviewPath steps={pathOf.get(item.id) ?? []} />
                    </section>
                  ))
                )}
                <p className="text-xs text-muted-foreground">{t('afterApproval')}</p>
              </aside>
            </section>
          )}
        </StepTransition>
      </div>
    </>
  );
}

function DurationRow({
  item,
  choice,
  today,
  onChange,
}: {
  item: CatalogItem;
  choice: Choice;
  today: string;
  onChange: (c: Choice) => void;
}) {
  const t = useTranslations('dbaccess.wizard');
  const l = useLocalized();
  const day = useDay();
  const id = useId();
  const max = maxDateFor(item, today);
  const permanent = choice.expiresOn === null;
  return (
    <li className="grid min-w-0 gap-3 rounded-xl border bg-card p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <VStack gap={1} className="min-w-0">
        <Text weight="medium" maxLines={1}>
          {l(item.name)}
        </Text>
        <Text type="supporting" maxLines={1}>
          {item.server.displayName}
        </Text>
        <Text type="supporting" id={`${id}-max`}>
          {max ? t('maxUntil', { days: item.maxDays ?? 0, date: day(max) }) : t('permanentAllowed')}
        </Text>
      </VStack>
      <HStack gap={3} wrap="wrap" vAlign="end">
        <DateInput
          label={t('accessUntil')}
          width={176}
          min={asDay(addDays(today, 1))}
          max={asDay(max)}
          isDisabled={permanent}
          value={asDay(choice.expiresOn)}
          onChange={(d) => onChange({ expiresOn: d || (item.allowPermanent ? null : '') })}
        />
        {item.allowPermanent && (
          <CheckboxInput
            label={t('noEndDate')}
            value={permanent}
            onChange={(v) =>
              onChange({
                expiresOn: v
                  ? null
                  : (defaultDateFor({ ...item, defaultDays: item.defaultDays ?? 90 }, today) ??
                    addDays(today, 90)),
              })
            }
          />
        )}
      </HStack>
    </li>
  );
}
