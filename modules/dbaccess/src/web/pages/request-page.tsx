'use client';

import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { Checkbox } from '@isbp/ui/checkbox';
import { EmptyState } from '@isbp/ui/empty-state';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import { SearchInput } from '@isbp/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Skeleton } from '@isbp/ui/skeleton';
import { Textarea } from '@isbp/ui/textarea';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  SearchXIcon,
  SendIcon,
  ShieldAlertIcon,
  UserCheckIcon,
  UsersIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import {
  type AccessRequest,
  addDays,
  type CatalogItem,
  checkDuration,
  defaultDateFor,
  type MyAccess,
  maxDateFor,
  RISKS,
  type ServerOption,
} from '../../contracts';
import { EngineLabel, RiskBadge } from '../badges';
import { INVALIDATE, requestHref, useDay, useLocalized, useToday } from '../lib';

const ALL = '__all__';
const STEPS = ['choose', 'details', 'review'] as const;
type Step = (typeof STEPS)[number];

interface Choice {
  expiresOn: string | null;
}

function Steps({ step }: { step: Step }) {
  const t = useTranslations('dbaccess.wizard');
  const current = STEPS.indexOf(step);
  return (
    <ol className="flex flex-wrap items-center gap-2 text-sm" aria-label={t('steps')}>
      {STEPS.map((s, i) => (
        <li
          key={s}
          aria-current={i === current ? 'step' : undefined}
          className={cn(
            'flex items-center gap-2 rounded-full border px-3 py-1',
            i === current ? 'border-primary bg-primary/10 font-medium text-primary' : 'text-muted-foreground',
          )}
        >
          <span
            className={cn(
              'flex size-5 items-center justify-center rounded-full text-xs',
              i < current ? 'bg-primary text-primary-foreground' : 'border bg-background',
            )}
            aria-hidden
          >
            {i < current ? <CheckIcon className="size-3" /> : i + 1}
          </span>
          {t(`step.${s}`)}
        </li>
      ))}
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
  const id = useId();
  const unavailable = Boolean(item.heldGrantId || item.pendingRequest);
  return (
    <li className={cn('flex min-w-0 gap-3 px-4 py-3', checked && 'bg-primary/5')}>
      <Checkbox
        id={id}
        checked={checked}
        disabled={unavailable}
        onCheckedChange={(v) => onChange(v === true)}
        aria-describedby={`${id}-desc`}
        className="mt-1"
      />
      <div className="grid min-w-0 flex-1 gap-1">
        <Label htmlFor={id} className={cn('min-w-0 font-medium', unavailable && 'text-muted-foreground')}>
          <span className="truncate">{l(item.name)}</span>
        </Label>
        <div id={`${id}-desc`} className="grid min-w-0 gap-1 text-sm text-muted-foreground">
          {item.description && <p className="line-clamp-2">{l(item.description)}</p>}
          <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <span className="truncate">{item.server.displayName}</span>
            <EngineLabel engine={item.server.engine} />
            <span className="truncate font-mono text-xs">
              {item.database ? `${item.database}.` : ''}
              {item.roleName}
            </span>
          </p>
          <p className="flex flex-wrap items-center gap-2">
            <RiskBadge risk={item.risk} />
            <span className="text-xs">
              {item.maxDays
                ? t('maxDays', { days: item.maxDays })
                : item.allowPermanent
                  ? t('permanentAllowed')
                  : ''}
            </span>
            {item.owner && <span className="text-xs">{t('approvedBy', { owner: item.owner.name })}</span>}
          </p>
          {item.heldGrantId && (
            <p className="text-xs font-medium text-success">
              {item.heldUntil ? t('heldUntil', { date: day(item.heldUntil) }) : t('held')}
            </p>
          )}
          {item.pendingRequest && (
            <p className="text-xs">
              <Link
                href={requestHref(item.pendingRequest.reference)}
                className="font-medium text-primary hover:underline"
              >
                {t('pending', { reference: item.pendingRequest.reference })}
              </Link>
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

/** The request wizard: choose roles → end date and justification → review the approval path → send. */
export default function RequestPage() {
  const t = useTranslations('dbaccess.wizard');
  const tr = useTranslations('dbaccess.risk');
  const tc = useTranslations('common');
  const l = useLocalized();
  const day = useDay();
  const today = useToday();
  const router = useRouter();
  const params = useSearchParams();
  const errorText = useErrorText();
  const ids = { justification: useId(), server: useId(), risk: useId() };
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
  const highRisk = chosen.some((c) => c.item.risk === 'high');

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
    }
    setStep(next);
  };

  return (
    <>
      <PageHeader
        title={extend ? t('extendTitle') : t('title')}
        description={extend ? t('extendDescription') : t('description')}
        actions={
          <Button variant="outline" asChild>
            <Link href="/dbaccess">{t('myAccess')}</Link>
          </Button>
        }
      />
      <div className="grid min-w-0 grid-cols-1 gap-6">
        <Steps step={step} />

        {step === 'choose' && (
          <section aria-labelledby="dbaccess-choose" className="grid min-w-0 gap-4">
            <h2 id="dbaccess-choose" className="sr-only">
              {t('step.choose')}
            </h2>
            <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3 shadow-xs">
              <SearchInput value={q} onChange={setQ} placeholder={t('search')} className="sm:w-72" />
              <Select value={serverId} onValueChange={setServerId}>
                <SelectTrigger className="w-full sm:w-56" aria-label={t('server')} id={ids.server}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t('allServers')}</SelectItem>
                  {(servers.data?.items ?? [])
                    .filter((s) => s.roles > 0)
                    .map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.displayName}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {databases.length > 0 && (
                <Select value={database} onValueChange={setDatabase}>
                  <SelectTrigger className="w-full sm:w-44" aria-label={t('database')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{t('allDatabases')}</SelectItem>
                    {databases.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Select value={risk} onValueChange={setRisk}>
                <SelectTrigger className="w-full sm:w-40" aria-label={t('risk')} id={ids.risk}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t('allRisks')}</SelectItem>
                  {RISKS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {tr(r)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 overflow-hidden rounded-xl border bg-card shadow-xs">
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
              <Button disabled={!chosen.length} onClick={() => go('details')}>
                {t('continue')} <ArrowRightIcon />
              </Button>
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
            <div className="grid gap-2 rounded-xl border bg-card p-4 shadow-xs">
              <Label htmlFor={ids.justification}>
                {t('justification')}
                {!needsJustification && (
                  <span className="font-normal text-muted-foreground"> ({tc('optional')})</span>
                )}
              </Label>
              <Textarea
                id={ids.justification}
                rows={4}
                maxLength={2_000}
                value={justification}
                placeholder={t('justificationPlaceholder')}
                onChange={(e) => setJustification(e.target.value)}
                aria-describedby={`${ids.justification}-hint`}
              />
              <p id={`${ids.justification}-hint`} className="text-xs text-muted-foreground">
                {t('justificationHint')}
              </p>
            </div>
            {problem && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {problem}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              {extend ? (
                <span />
              ) : (
                <Button variant="outline" onClick={() => go('choose')}>
                  <ArrowLeftIcon /> {t('back')}
                </Button>
              )}
              <Button disabled={!chosen.length} onClick={() => go('review')}>
                {t('reviewStep')} <ArrowRightIcon />
              </Button>
            </div>
          </section>
        )}

        {step === 'review' && (
          <section aria-labelledby="dbaccess-review" className="grid min-w-0 gap-4">
            <h2 id="dbaccess-review" className="text-lg font-semibold">
              {t('step.review')}
            </h2>
            <ul className="divide-y rounded-xl border bg-card text-sm shadow-xs">
              {chosen.map(({ item, choice }) => (
                <li
                  key={item.id}
                  className="flex min-w-0 flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{l(item.name)}</span>
                    <span className="block truncate text-muted-foreground">{item.server.displayName}</span>
                  </span>
                  <RiskBadge risk={item.risk} />
                  <span className="shrink-0">
                    {choice.expiresOn ? t('until', { date: day(choice.expiresOn) }) : t('noEndDate')}
                  </span>
                </li>
              ))}
            </ul>
            <div className="grid gap-3 rounded-xl border bg-card p-4 shadow-xs">
              <h3 className="text-sm font-semibold">{t('whoApproves')}</h3>
              <ol className="grid gap-2 text-sm">
                <li className="flex items-center gap-2">
                  <UserCheckIcon className="size-4 text-muted-foreground" aria-hidden />
                  {t('approver.manager')}
                </li>
                <li className="flex items-start gap-2">
                  <UsersIcon className="mt-0.5 size-4 text-muted-foreground" aria-hidden />
                  <span>
                    {t('approver.owner', {
                      owners:
                        [...new Set(chosen.map((c) => c.item.owner?.name).filter(Boolean))].join(', ') || '—',
                    })}
                  </span>
                </li>
                {highRisk && (
                  <li className="flex items-center gap-2">
                    <ShieldAlertIcon className="size-4 text-destructive" aria-hidden />
                    {t('approver.security')}
                  </li>
                )}
              </ol>
              <p className="text-xs text-muted-foreground">{t('afterApproval')}</p>
            </div>
            {submit.error && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {errorText(submit.error)}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button variant="outline" onClick={() => go('details')}>
                <ArrowLeftIcon /> {t('back')}
              </Button>
              <Button loading={submit.isPending} onClick={() => submit.mutate(undefined)}>
                <SendIcon /> {t('send')}
              </Button>
            </div>
          </section>
        )}
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
    <li className="grid min-w-0 gap-3 rounded-xl border bg-card p-4 shadow-xs sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <div className="grid min-w-0 gap-1">
        <p className="truncate font-medium">{l(item.name)}</p>
        <p className="truncate text-sm text-muted-foreground">{item.server.displayName}</p>
        <p className="text-xs text-muted-foreground" id={`${id}-max`}>
          {max ? t('maxUntil', { days: item.maxDays ?? 0, date: day(max) }) : t('permanentAllowed')}
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <Label htmlFor={id}>{t('accessUntil')}</Label>
          <Input
            id={id}
            type="date"
            className="w-44"
            min={addDays(today, 1)}
            max={max ?? undefined}
            disabled={permanent}
            value={choice.expiresOn ?? ''}
            aria-describedby={`${id}-max`}
            onChange={(e) => onChange({ expiresOn: e.target.value || (item.allowPermanent ? null : '') })}
          />
        </div>
        {item.allowPermanent && (
          <div className="flex items-center gap-2 pb-2">
            <Checkbox
              id={`${id}-permanent`}
              checked={permanent}
              onCheckedChange={(v) =>
                onChange({
                  expiresOn:
                    v === true
                      ? null
                      : (defaultDateFor({ ...item, defaultDays: item.defaultDays ?? 90 }, today) ??
                        addDays(today, 90)),
                })
              }
            />
            <Label htmlFor={`${id}-permanent`} className="font-normal">
              {t('noEndDate')}
            </Label>
          </div>
        )}
      </div>
    </li>
  );
}
