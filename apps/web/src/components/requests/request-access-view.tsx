'use client';

import type { AccessRequest, ApprovalPreview, RequestableRole } from '@isbp/contracts';
import { ApiError, usePlatform } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { UserAvatar } from '@isbp/ui/avatar';
import { Disclosure, StepTransition } from '@isbp/ui/motion';
import { EmptyState } from '@isbp/ui/empty-state';
import { PageHeader } from '@isbp/ui/page-header';
import { type PersonOption, PersonPicker } from '@isbp/ui/person-picker';
import { SearchInput } from '@isbp/ui/search-input';
import { Skeleton } from '@isbp/ui/skeleton';
import { Stepper } from '@isbp/ui/stepper';
import { toast } from '@isbp/ui/toast';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  ClockIcon,
  KeyRoundIcon,
  SearchXIcon,
  SendIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { useApiMutation, useApiQuery, useErrorText } from '@/lib/api';
import { useRoleText } from '../roles/role-utils';
import { RiskBadge } from '../workflows/subject-details';
import { ApprovalPathList, ApprovalPathSkeleton, previewSteps } from './approval-path';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack } from '@astryxdesign/core/Layout';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { TextArea } from '@astryxdesign/core/TextArea';
import { ToggleButton } from '@astryxdesign/core/ToggleButton';

type Step = 0 | 1 | 2;
const PRESETS = [7, 30, 90] as const;

type RoleItem = RequestableRole & { name: string; description: string | null };

function RoleCard({ role, selected, onSelect }: { role: RoleItem; selected: boolean; onSelect: () => void }) {
  const t = useTranslations('requests.access');
  const disabled = role.held || Boolean(role.pendingRequest);
  return (
    <div
      className={cn(
        'relative flex h-full min-w-0 flex-col gap-2 rounded-xl border bg-card p-4 text-left transition-all',
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
          <div className="font-medium [overflow-wrap:anywhere]">{role.name}</div>
        </div>
        <RiskBadge level={role.riskLevel} />
      </div>
      {role.description ? (
        <p className="line-clamp-2 text-sm text-muted-foreground">{role.description}</p>
      ) : (
        <p className="text-sm text-muted-foreground italic">
          {role.owner ? t('noDescriptionOwner', { name: role.owner.displayName }) : t('noDescription')}
        </p>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
        {role.maxDurationDays ? (
          <span className="inline-flex items-center gap-1">
            <ClockIcon className="size-3.5" aria-hidden />
            {t('upTo', { count: role.maxDurationDays })}
          </span>
        ) : null}
        {role.owner && role.description && <span>{t('owner', { name: role.owner.displayName })}</span>}
        {role.held && (
          <Badge
            variant="success"
            label={t('held')}
            icon={<Icon icon={CheckCircle2Icon} size="xsm" />}
            className="relative z-10"
          />
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

/** "Who will approve it" for the access asked for (a dry run of its workflow). Also used by the forms builder. */
export function ApprovalPath({
  preview,
  waiting,
}: {
  preview: ApprovalPreview | undefined;
  /** Steps waiting for an answer that is still empty (step id → the answer's label). */
  waiting?: Map<string, string>;
}) {
  if (!preview) return <ApprovalPathSkeleton />;
  return <ApprovalPathList steps={previewSteps(preview, waiting)} mode="preview" />;
}

/**
 * Three steps: choose the access (grouped by application, the platform's own roles last), say why and for how long,
 * review who will approve it. The same stepper and wording as the database access request.
 */
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
    () => (roles.data?.items ?? []).map((r) => ({ ...r, ...roleText(r) }) as RoleItem),
    [roles.data, roleText],
  );
  const role = items.find((r) => r.id === roleId) ?? null;
  const apps = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; isPlatform: boolean }>();
    for (const r of items) seen.set(r.application.id, r.application);
    // Business applications alphabetically, the platform's own last.
    return [...seen.values()].sort(
      (a, b) => Number(a.isPlatform) - Number(b.isPlatform) || a.name.localeCompare(b.name),
    );
  }, [items]);
  const needle = q.trim().toLowerCase();
  const visible = useMemo(
    () =>
      items.filter(
        (r) =>
          (app === 'all' || r.application.id === app) &&
          (!needle ||
            `${r.name} ${r.description ?? ''} ${r.application.name}`.toLowerCase().includes(needle)),
      ),
    [items, app, needle],
  );
  // One group per application. When someone searches, the applications that match come first; the platform's own
  // roles always come last, collapsed, so they never push a business application down the list.
  const groups = useMemo(() => {
    const byApp = new Map<string, { id: string; name: string; isPlatform: boolean; roles: RoleItem[] }>();
    for (const r of visible) {
      const g = byApp.get(r.application.id) ?? { ...r.application, roles: [] };
      g.roles.push(r);
      byApp.set(r.application.id, g);
    }
    const matches = (g: { name: string }) => Boolean(needle) && g.name.toLowerCase().includes(needle);
    return [...byApp.values()]
      .map((g) => ({ ...g, roles: g.roles.sort((a, b) => a.name.localeCompare(b.name)) }))
      .sort(
        (a, b) =>
          Number(a.isPlatform) - Number(b.isPlatform) ||
          Number(matches(b)) - Number(matches(a)) ||
          a.name.localeCompare(b.name),
      );
  }, [visible, needle]);
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
  const steps = [
    { id: 'role', label: t('steps.role') },
    { id: 'details', label: t('steps.details') },
    { id: 'review', label: t('steps.review') },
  ];

  return (
    <div className="mx-auto grid max-w-5xl gap-4">
      <PageHeader
        eyebrow={
          <Link href="/requests" className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeftIcon className="size-3.5" aria-hidden />
            {t('backToRequests')}
          </Link>
        }
        title={t('title')}
        description={t('description')}
      />
      <Stepper steps={steps} current={step} label={t('steps.label')} />

      <StepTransition step={step}>
        {step === 0 && (
          <div className="grid gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <SearchInput value={q} onChange={setQ} placeholder={t('search')} className="sm:w-80" />
              <HStack gap={1.5} wrap="wrap" role="group" aria-label={t('applications')}>
                {[{ id: 'all', name: t('allApplications'), isPlatform: false }, ...apps].map((a) => (
                  <ToggleButton
                    key={a.id}
                    size="sm"
                    label={a.isPlatform ? t('platform') : a.name}
                    isPressed={app === a.id}
                    onPressedChange={() => setApp(a.id)}
                  />
                ))}
              </HStack>
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
              <div className="grid gap-4">
                {groups
                  .filter((g) => !g.isPlatform)
                  .map((g) => (
                    <section key={g.id} aria-labelledby={`${id}-app-${g.id}`} className="grid gap-3">
                      <h2 id={`${id}-app-${g.id}`} className="flex items-center gap-2 text-sm font-semibold">
                        <KeyRoundIcon className="size-4 text-muted-foreground" aria-hidden />
                        {g.name}
                        <span className="font-normal text-muted-foreground">({g.roles.length})</span>
                      </h2>
                      <div
                        role="radiogroup"
                        aria-labelledby={`${id}-app-${g.id}`}
                        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
                      >
                        {g.roles.map((r) => (
                          <RoleCard
                            key={r.id}
                            role={r}
                            selected={r.id === roleId}
                            onSelect={() => setRoleId(r.id)}
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                {groups
                  .filter((g) => g.isPlatform)
                  .map((g) => (
                    <Disclosure
                      key={`${g.id}-${needle ? 'search' : 'rest'}`}
                      summary={t('platformRoles', { count: g.roles.length })}
                      defaultOpen={Boolean(needle) || g.roles.some((r) => r.id === roleId)}
                      className="rounded-xl border"
                      triggerClassName="w-full justify-between rounded-xl px-4 py-3 text-sm font-semibold"
                      contentClassName="px-4 pb-4"
                    >
                      <div
                        role="radiogroup"
                        aria-label={t('platformRoles', { count: g.roles.length })}
                        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
                      >
                        {g.roles.map((r) => (
                          <RoleCard
                            key={r.id}
                            role={r}
                            selected={r.id === roleId}
                            onSelect={() => setRoleId(r.id)}
                          />
                        ))}
                      </div>
                    </Disclosure>
                  ))}
              </div>
            )}
            <div className="sticky bottom-4 z-10 flex items-center justify-end gap-3 rounded-xl border bg-background/90 p-3 shadow-lg backdrop-blur">
              <span className="mr-auto truncate text-sm text-muted-foreground" aria-live="polite">
                {role ? t('selected', { name: role.name }) : t('selectHint')}
              </span>
              <Button
                label={t('continue')}
                variant="primary"
                endContent={<Icon icon={ArrowRightIcon} />}
                isDisabled={!role || role.held || Boolean(role.pendingRequest)}
                onClick={() => {
                  if (max && (duration === null || (duration !== -1 && duration > max)))
                    setDuration(PRESETS.find((p) => p <= max) ?? max);
                  setStep(1);
                }}
              />
            </div>
          </div>
        )}

        {step === 1 && role && (
          <div className="grid gap-4 rounded-xl border bg-card p-4 sm:p-5">
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
              <HStack gap={2} wrap="wrap">
                <ToggleButton
                  label={t('forMe')}
                  icon={
                    <UserAvatar name={user.displayName} src={user.avatarUrl} className="size-5 text-[9px]" />
                  }
                  isPressed={!forOther}
                  onPressedChange={() => setForOther(false)}
                />
                <ToggleButton
                  label={t('forSomeoneElse')}
                  isPressed={forOther}
                  onPressedChange={() => setForOther(true)}
                />
              </HStack>
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
              <HStack gap={2} wrap="wrap" vAlign="center">
                {PRESETS.filter((p) => !max || p <= max).map((p) => (
                  <ToggleButton
                    key={p}
                    label={t('days', { count: p })}
                    isPressed={duration === p}
                    onPressedChange={() => setDuration(p)}
                  />
                ))}
                <ToggleButton
                  label={t('custom')}
                  isPressed={duration === -1}
                  onPressedChange={() => setDuration(-1)}
                />
                {!max && (
                  <ToggleButton
                    label={t('permanent')}
                    isPressed={duration === null}
                    onPressedChange={() => setDuration(null)}
                  />
                )}
                {duration === -1 && (
                  <NumberInput
                    label={t('customDays')}
                    isLabelHidden
                    min={1}
                    max={max ?? 3650}
                    isIntegerOnly
                    units={t('daysUnit')}
                    width={160}
                    value={custom === '' ? null : Number(custom)}
                    status={touched && !durationValid ? { type: 'error' } : undefined}
                    onChange={(v) => setCustom(v == null ? '' : String(v))}
                  />
                )}
              </HStack>
              <p
                className={cn(
                  'text-xs',
                  touched && !durationValid ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                {max ? t('maxHint', { count: max }) : t('expiryHint')}
              </p>
            </fieldset>

            <FormLayout defaultOptionality="required">
              <TextArea
                label={t('why')}
                description={t('whyHint')}
                rows={4}
                maxLength={2000}
                value={justification}
                placeholder={t('whyPlaceholder')}
                status={touched && !justificationValid ? { type: 'error' } : undefined}
                onChange={setJustification}
              />
            </FormLayout>

            <div className="flex justify-between gap-2">
              <Button
                label={t('back')}
                variant="ghost"
                icon={<Icon icon={ArrowLeftIcon} />}
                onClick={() => setStep(0)}
              />
              <Button
                label={t('review')}
                variant="primary"
                endContent={<Icon icon={ArrowRightIcon} />}
                onClick={goReview}
              />
            </div>
          </div>
        )}

        {step === 2 && role && (
          <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,22rem)]">
            <div className="grid content-start gap-5 rounded-xl border bg-card p-4 sm:p-5">
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
                <Banner
                  status="error"
                  collapsible={false}
                  title={
                    <>
                      {errorText(submitError)}{' '}
                      {existing && (
                        <Link className="font-medium underline" href={`/requests/${existing}`}>
                          {existing}
                        </Link>
                      )}
                    </>
                  }
                />
              )}
              <div className="flex justify-between gap-2">
                <Button
                  label={t('back')}
                  variant="ghost"
                  icon={<Icon icon={ArrowLeftIcon} />}
                  onClick={() => setStep(1)}
                />
                <Button
                  label={t('submit')}
                  variant="primary"
                  icon={<Icon icon={SendIcon} />}
                  isDisabled={submit.isPending}
                  onClick={() => submit.mutate(body())}
                />
              </div>
            </div>
            <aside className="grid content-start gap-3 rounded-xl border bg-muted/30 p-4" aria-live="polite">
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
      </StepTransition>
    </div>
  );
}
