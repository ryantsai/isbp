'use client';

import type { AccessRequest, ApprovalPreview, RequestableRole } from '@isbp/contracts';
import { localize } from '@isbp/sdk';
import { ApiError, usePlatform } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { EmptyState } from '@isbp/ui/empty-state';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { PageHeader } from '@isbp/ui/page-header';
import { type PersonOption, PersonPicker } from '@isbp/ui/person-picker';
import { SearchInput } from '@isbp/ui/search-input';
import { Skeleton } from '@isbp/ui/skeleton';
import { Textarea } from '@isbp/ui/textarea';
import { toast } from '@isbp/ui/sonner';
import { cn } from '@isbp/ui';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  CheckIcon,
  ClockIcon,
  KeyRoundIcon,
  SearchXIcon,
  SendIcon,
  SkipForwardIcon,
  UserCheckIcon,
  XCircleIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { useApiMutation, useApiQuery, useErrorText } from '@/lib/api';
import { useRoleText } from '../roles/role-utils';
import { RiskBadge } from '../workflows/subject-details';

type Step = 0 | 1 | 2;
const PRESETS = [7, 30, 90] as const;

function Stepper({ step }: { step: Step }) {
  const t = useTranslations('requests.access.steps');
  const labels = [t('role'), t('details'), t('review')];
  return (
    <ol className="flex items-center gap-2 text-sm" aria-label={t('label')}>
      {labels.map((label, i) => (
        <li key={label} className="flex items-center gap-2" aria-current={i === step ? 'step' : undefined}>
          <span
            className={cn(
              'grid size-7 place-items-center rounded-full border text-xs font-semibold transition-colors',
              i < step && 'border-primary bg-primary text-primary-foreground',
              i === step && 'border-primary text-primary',
              i > step && 'text-muted-foreground',
            )}
          >
            {i < step ? <CheckIcon className="size-3.5" aria-hidden /> : i + 1}
          </span>
          <span className={cn('hidden sm:inline', i === step ? 'font-medium' : 'text-muted-foreground')}>
            {label}
          </span>
          {i < labels.length - 1 && <span aria-hidden className="mx-1 h-px w-6 bg-border sm:w-10" />}
        </li>
      ))}
    </ol>
  );
}

function RoleCard({
  role,
  selected,
  onSelect,
}: {
  role: RequestableRole;
  selected: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations('requests.access');
  const disabled = role.held || Boolean(role.pendingRequest);
  return (
    <div
      className={cn(
        'relative flex h-full flex-col gap-2 rounded-xl border bg-card p-4 text-left transition-all',
        !disabled && 'cursor-pointer hover:border-ring/40 hover:shadow-md',
        selected && 'border-primary ring-2 ring-primary/30',
        disabled && 'opacity-75',
      )}
    >
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        disabled={disabled}
        onClick={onSelect}
        className="absolute inset-0 rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed"
      >
        <span className="sr-only">{role.name}</span>
      </button>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium">{role.name}</div>
          <div className="text-xs text-muted-foreground">
            {role.application.isPlatform ? t('platform') : role.application.name}
          </div>
        </div>
        <RiskBadge level={role.riskLevel} />
      </div>
      {role.description && <p className="line-clamp-2 text-sm text-muted-foreground">{role.description}</p>}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
        {role.maxDurationDays ? (
          <span className="inline-flex items-center gap-1">
            <ClockIcon className="size-3.5" aria-hidden />
            {t('upTo', { count: role.maxDurationDays })}
          </span>
        ) : null}
        {role.owner && <span>{t('owner', { name: role.owner.displayName })}</span>}
        {role.held && (
          <Badge variant="success" className="relative z-10">
            <CheckCircle2Icon aria-hidden />
            {t('held')}
          </Badge>
        )}
        {role.pendingRequest && (
          <Link
            href={`/requests/${role.pendingRequest.reference}`}
            className="relative z-10 rounded-sm text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {t('pending', { reference: role.pendingRequest.reference })}
          </Link>
        )}
      </div>
    </div>
  );
}

/** "Who will approve it": the approval steps of a dry run with the people each would ask (also on request forms). */
export function ApprovalPath({ preview }: { preview: ApprovalPreview | undefined }) {
  const t = useTranslations('requests.access.path');
  const locale = useLocale();
  if (!preview) return <Skeleton className="h-32 w-full rounded-xl" />;
  const steps = preview.steps.filter((s) => s.type === 'approval');
  return (
    <ol className="relative grid gap-3 before:absolute before:top-3 before:bottom-3 before:left-[15px] before:w-px before:bg-border">
      {steps.map((s) => {
        const skipped = s.outcome !== 'ask';
        return (
          <li key={s.id} className="relative flex gap-3">
            <span
              className={cn(
                'relative z-10 grid size-8 shrink-0 place-items-center rounded-full ring-4 ring-background [&_svg]:size-4',
                skipped ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary',
                s.outcome === 'reject' && 'bg-destructive/10 text-destructive',
              )}
            >
              {s.outcome === 'reject' ? <XCircleIcon /> : skipped ? <SkipForwardIcon /> : <UserCheckIcon />}
            </span>
            <div className="min-w-0 pt-1">
              <div className={cn('text-sm font-medium', skipped && 'text-muted-foreground')}>
                {localize(s.name, locale)}
              </div>
              {s.outcome === 'ask' ? (
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {s.people.slice(0, 4).map((p) => (
                    <span
                      key={p.id}
                      className="inline-flex items-center gap-1 rounded-full border py-0.5 pr-2 pl-0.5 text-xs"
                    >
                      <UserAvatar name={p.displayName} src={p.avatarUrl} className="size-4 text-[8px]" />
                      {p.displayName}
                    </span>
                  ))}
                  {s.people.length > 4 && (
                    <span className="text-xs text-muted-foreground">
                      {t('more', { count: s.people.length - 4 })}
                    </span>
                  )}
                  {s.people.length > 1 && <span className="text-xs text-muted-foreground">{t('anyOf')}</span>}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">{t(s.outcome)}</div>
              )}
            </div>
          </li>
        );
      })}
      {!steps.length && <li className="text-sm text-muted-foreground">{t('none')}</li>}
    </ol>
  );
}

/** Three steps: choose the access, say why and for how long, review who will approve it. */
export function RequestAccessView() {
  const t = useTranslations('requests.access');
  const router = useRouter();
  const sp = useSearchParams();
  const { user } = usePlatform();
  const errorText = useErrorText();
  const id = useId();
  const [step, setStep] = useState<Step>(0);
  const [q, setQ] = useState('');
  const [app, setApp] = useState<string>('all');
  const [roleId, setRoleId] = useState<string | null>(sp.get('role'));
  const [forOther, setForOther] = useState(false);
  const [person, setPerson] = useState<PersonOption | null>(null);
  const [duration, setDuration] = useState<number | null>(30);
  const [custom, setCustom] = useState('');
  const [justification, setJustification] = useState('');
  const [touched, setTouched] = useState(false);

  const beneficiaryId = forOther ? (person?.id ?? null) : null;
  const roles = useApiQuery<{ items: RequestableRole[] }>('/requestable-roles', {
    for: beneficiaryId ?? undefined,
  });
  const roleText = useRoleText();
  // Module roles in the reader's language (search matches what they see).
  const items = useMemo(
    () => (roles.data?.items ?? []).map((r) => ({ ...r, ...roleText(r) })),
    [roles.data, roleText],
  );
  const role = items.find((r) => r.id === roleId) ?? null;
  const apps = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; isPlatform: boolean }>();
    for (const r of items) seen.set(r.application.id, r.application);
    return [...seen.values()];
  }, [items]);
  const visible = items.filter(
    (r) =>
      (app === 'all' || r.application.id === app) &&
      (!q ||
        `${r.name} ${r.description ?? ''} ${r.application.name}`.toLowerCase().includes(q.toLowerCase())),
  );
  const max = role?.maxDurationDays ?? null;
  const days = duration === -1 ? Number(custom) || null : duration;
  const durationValid = days === null ? !max : days >= 1 && (!max || days <= max);
  const justificationValid = justification.trim().length >= 10;
  const previewQuery = useApiMutation(
    (api, body: object) => api.post<ApprovalPreview>('/access-requests/preview', body),
    {
      silent: true,
    },
  );
  const submit = useApiMutation((api, body: object) => api.post<AccessRequest>('/access-requests', body), {
    silent: true,
    invalidate: ['/me/requests', '/requestable-roles', '/me/badges'],
    onSuccess: (r) => {
      toast.success(t('submitted', { reference: r.reference }));
      router.push(`/requests/${r.reference}`);
    },
  });

  const body = () => ({
    roleId: role!.id,
    beneficiaryId,
    durationDays: days,
    justification: justification.trim(),
  });
  const goReview = () => {
    setTouched(true);
    if (!durationValid || !justificationValid || (forOther && !person)) return;
    previewQuery.mutate({ roleId: role!.id, beneficiaryId, durationDays: days });
    setStep(2);
  };
  const submitError = submit.error instanceof ApiError ? submit.error : null;
  const existing =
    submitError?.code === 'DUPLICATE_REQUEST'
      ? (submitError.details as { reference?: string } | undefined)?.reference
      : null;

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <PageHeader
        eyebrow={
          <Link href="/requests" className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeftIcon className="size-3.5" aria-hidden />
            {t('back')}
          </Link>
        }
        title={t('title')}
        description={t('description')}
        actions={<Stepper step={step} />}
      />

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16 }}
          transition={{ duration: 0.18 }}
        >
          {step === 0 && (
            <div className="grid gap-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <SearchInput value={q} onChange={setQ} placeholder={t('search')} className="sm:w-80" />
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('applications')}>
                  {[{ id: 'all', name: t('allApplications'), isPlatform: false }, ...apps].map((a) => (
                    <Button
                      key={a.id}
                      size="sm"
                      variant={app === a.id ? 'secondary' : 'ghost'}
                      aria-pressed={app === a.id}
                      onClick={() => setApp(a.id)}
                    >
                      {a.isPlatform ? t('platform') : a.name}
                    </Button>
                  ))}
                </div>
              </div>
              {roles.isLoading ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-36 rounded-xl" />
                  ))}
                </div>
              ) : !visible.length ? (
                <EmptyState
                  icon={<SearchXIcon />}
                  title={t('noRoles')}
                  className="rounded-xl border border-dashed"
                />
              ) : (
                <div
                  role="radiogroup"
                  aria-label={t('steps.role')}
                  className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
                >
                  {visible.map((r) => (
                    <RoleCard
                      key={r.id}
                      role={r}
                      selected={r.id === roleId}
                      onSelect={() => setRoleId(r.id)}
                    />
                  ))}
                </div>
              )}
              <div className="sticky bottom-4 z-10 flex items-center justify-end gap-3 rounded-xl border bg-background/90 p-3 shadow-lg backdrop-blur">
                <span className="mr-auto truncate text-sm text-muted-foreground" aria-live="polite">
                  {role ? t('selected', { name: role.name }) : t('selectHint')}
                </span>
                <Button
                  disabled={!role || role.held || Boolean(role.pendingRequest)}
                  onClick={() => {
                    if (max && (duration === null || (duration !== -1 && duration > max)))
                      setDuration(PRESETS.find((p) => p <= max) ?? max);
                    setStep(1);
                  }}
                >
                  {t('continue')}
                  <ArrowRightIcon />
                </Button>
              </div>
            </div>
          )}

          {step === 1 && role && (
            <div className="grid gap-6 rounded-xl border bg-card p-5 sm:p-6">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                  <KeyRoundIcon className="size-5" />
                </span>
                <div>
                  <div className="font-medium">{role.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {role.application.isPlatform ? t('platform') : role.application.name}
                  </div>
                </div>
                <RiskBadge level={role.riskLevel} />
              </div>

              <fieldset className="grid gap-2">
                <legend className="mb-2 text-sm font-medium">{t('who')}</legend>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={!forOther ? 'secondary' : 'outline'}
                    aria-pressed={!forOther}
                    onClick={() => setForOther(false)}
                  >
                    <UserAvatar name={user.displayName} src={user.avatarUrl} className="size-5 text-[9px]" />
                    {t('forMe')}
                  </Button>
                  <Button
                    type="button"
                    variant={forOther ? 'secondary' : 'outline'}
                    aria-pressed={forOther}
                    onClick={() => setForOther(true)}
                  >
                    {t('forSomeoneElse')}
                  </Button>
                </div>
                {forOther && (
                  <div className="grid max-w-md gap-1.5">
                    <PersonPicker
                      value={person}
                      onChange={setPerson}
                      excludeIds={[user.id]}
                      includePreboarded
                      invalid={touched && !person}
                      aria-describedby={`${id}-for-hint`}
                    />
                    <p id={`${id}-for-hint`} className="text-xs text-muted-foreground">
                      {person?.status === 'pending'
                        ? t('preboardedHint', { name: person.displayName })
                        : t('forHint')}
                    </p>
                  </div>
                )}
              </fieldset>

              <fieldset className="grid gap-2">
                <legend className="mb-2 text-sm font-medium">{t('howLong')}</legend>
                <div className="flex flex-wrap items-center gap-2">
                  {PRESETS.filter((p) => !max || p <= max).map((p) => (
                    <Button
                      key={p}
                      type="button"
                      variant={duration === p ? 'secondary' : 'outline'}
                      aria-pressed={duration === p}
                      onClick={() => setDuration(p)}
                    >
                      {t('days', { count: p })}
                    </Button>
                  ))}
                  <Button
                    type="button"
                    variant={duration === -1 ? 'secondary' : 'outline'}
                    aria-pressed={duration === -1}
                    onClick={() => setDuration(-1)}
                  >
                    {t('custom')}
                  </Button>
                  {!max && (
                    <Button
                      type="button"
                      variant={duration === null ? 'secondary' : 'outline'}
                      aria-pressed={duration === null}
                      onClick={() => setDuration(null)}
                    >
                      {t('permanent')}
                    </Button>
                  )}
                  {duration === -1 && (
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={1}
                        max={max ?? 3650}
                        className="w-24"
                        aria-label={t('customDays')}
                        value={custom}
                        aria-invalid={touched && !durationValid}
                        onChange={(e) => setCustom(e.target.value)}
                      />
                      <span className="text-sm text-muted-foreground">{t('daysUnit')}</span>
                    </div>
                  )}
                </div>
                <p
                  className={cn(
                    'text-xs',
                    touched && !durationValid ? 'text-destructive' : 'text-muted-foreground',
                  )}
                >
                  {max ? t('maxHint', { count: max }) : t('expiryHint')}
                </p>
              </fieldset>

              <div className="grid gap-2">
                <Label htmlFor={`${id}-why`}>{t('why')}</Label>
                <Textarea
                  id={`${id}-why`}
                  rows={4}
                  maxLength={2000}
                  value={justification}
                  aria-invalid={touched && !justificationValid}
                  aria-describedby={`${id}-why-hint`}
                  placeholder={t('whyPlaceholder')}
                  onChange={(e) => setJustification(e.target.value)}
                />
                <p
                  id={`${id}-why-hint`}
                  className={cn(
                    'flex justify-between text-xs',
                    touched && !justificationValid ? 'text-destructive' : 'text-muted-foreground',
                  )}
                >
                  <span>{t('whyHint')}</span>
                  <span className="tabular-nums">{justification.trim().length}/2000</span>
                </p>
              </div>

              <div className="flex justify-between gap-2">
                <Button variant="ghost" onClick={() => setStep(0)}>
                  <ArrowLeftIcon />
                  {t('back')}
                </Button>
                <Button onClick={goReview}>
                  {t('review')}
                  <ArrowRightIcon />
                </Button>
              </div>
            </div>
          )}

          {step === 2 && role && (
            <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,22rem)]">
              <div className="grid content-start gap-5 rounded-xl border bg-card p-5 sm:p-6">
                <h2 className="text-base font-semibold">{t('summary')}</h2>
                <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('steps.role')}</dt>
                    <dd className="font-medium">{role.name}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('who')}</dt>
                    <dd>{forOther ? person?.displayName : user.displayName}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('howLong')}</dt>
                    <dd>{days ? t('days', { count: days }) : t('permanent')}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-muted-foreground">{t('why')}</dt>
                    <dd className="mt-0.5 whitespace-pre-line">{justification.trim()}</dd>
                  </div>
                </dl>
                {submitError && (
                  <p
                    role="alert"
                    className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                  >
                    {errorText(submitError)}{' '}
                    {existing && (
                      <Link className="font-medium underline" href={`/requests/${existing}`}>
                        {existing}
                      </Link>
                    )}
                  </p>
                )}
                <div className="flex justify-between gap-2">
                  <Button variant="ghost" onClick={() => setStep(1)}>
                    <ArrowLeftIcon />
                    {t('back')}
                  </Button>
                  <Button onClick={() => submit.mutate(body())} disabled={submit.isPending}>
                    <SendIcon />
                    {t('submit')}
                  </Button>
                </div>
              </div>
              <aside
                className="grid content-start gap-3 rounded-xl border bg-muted/30 p-5"
                aria-live="polite"
              >
                <h2 className="text-base font-semibold">{t('path.title')}</h2>
                <p className="text-sm text-muted-foreground">{t('path.description')}</p>
                {previewQuery.isError ? (
                  <p className="text-sm text-destructive">{errorText(previewQuery.error)}</p>
                ) : (
                  <ApprovalPath preview={previewQuery.data} />
                )}
              </aside>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
