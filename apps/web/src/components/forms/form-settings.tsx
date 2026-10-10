'use client';

import type { FormDetail, FormSummary } from '@isbp/contracts';
import { useCan } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Badge } from '@isbp/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { Label } from '@isbp/ui/label';
import { LocalizedInput } from '@isbp/ui/localized-input';
import { Switch } from '@isbp/ui/switch';
import { CircleCheckIcon, GlobeIcon, PencilLineIcon, UsersRoundIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId, useMemo } from 'react';
import { ActivityFeed } from '@/components/audit/activity-feed';
import { hasText } from '@/components/fields/field-utils';
import { DateTime } from '@/components/relative-time';
import { Segmented } from '@/components/roles/segmented';
import { useApiQuery } from '@/lib/api';
import { CategoryInput, IconPicker } from './form-inputs';
import { GroupMultiPicker } from './group-multi-picker';
import type { BuilderState } from './use-builder';

export type SettingsIssue = 'nameRequired' | 'groupsRequired';

export function settingsIssues(s: BuilderState): SettingsIssue[] {
  const out: SettingsIssue[] = [];
  if (!hasText(s.name)) out.push('nameRequired');
  if (s.audience.type === 'groups' && !s.audience.groupKeys.length) out.push('groupsRequired');
  return out;
}

function Field({
  label,
  htmlFor,
  labelId,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  labelId?: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={htmlFor} id={labelId}>
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs font-medium text-destructive">{error}</p>}
    </div>
  );
}

/** Name, look, availability and audience of a form (saved with the draft); who approves is the Approval tab. */
export function FormSettings({
  form,
  state,
  onChange,
}: {
  form: FormDetail;
  state: BuilderState;
  onChange: (fn: (s: BuilderState) => BuilderState, tag?: string) => void;
}) {
  const t = useTranslations('forms.settings');
  const uid = useId();
  const canAudit = useCan('core.audit.read');
  const issues = settingsIssues(state);
  const all = useApiQuery<{ items: FormSummary[] }>('/forms', { includeArchived: true });
  const categories = useMemo(
    () =>
      [
        ...new Set((all.data?.items ?? []).map((f) => f.category).filter((c): c is string => Boolean(c))),
      ].sort(),
    [all.data],
  );
  const set = (patch: Partial<BuilderState>, tag?: string) => onChange((s) => ({ ...s, ...patch }), tag);

  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{t('detailsTitle')}</CardTitle>
          <CardDescription>{t('detailsDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <Field
            label={t('name')}
            htmlFor={`${uid}-name`}
            error={issues.includes('nameRequired') ? t('issues.nameRequired') : undefined}
          >
            <LocalizedInput
              id={`${uid}-name`}
              value={state.name}
              invalid={issues.includes('nameRequired')}
              onChange={(name) => set({ name }, 'settings:name')}
            />
          </Field>
          <Field label={t('description')} htmlFor={`${uid}-description`}>
            <LocalizedInput
              id={`${uid}-description`}
              multiline
              value={state.description}
              onChange={(description) => set({ description }, 'settings:description')}
            />
          </Field>
          <Field label={t('icon')} labelId={`${uid}-icon`}>
            <IconPicker value={state.icon} onChange={(icon) => set({ icon })} labelledBy={`${uid}-icon`} />
          </Field>
          <Field label={t('category')} htmlFor={`${uid}-category`} hint={t('categoryHint')}>
            <CategoryInput
              id={`${uid}-category`}
              value={state.category}
              suggestions={categories}
              onChange={(category) => set({ category }, 'settings:category')}
            />
          </Field>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>{t('availabilityTitle')}</CardTitle>
            <CardDescription>{t('availabilityDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <label
              htmlFor={`${uid}-active`}
              className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border p-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50"
            >
              <span className="grid gap-0.5">
                <span className="text-sm font-medium">{t('active')}</span>
                <span className="text-xs text-muted-foreground">
                  {state.active ? t('activeOn') : t('activeOff')}
                </span>
              </span>
              <Switch
                id={`${uid}-active`}
                checked={state.active}
                onCheckedChange={(active) => set({ active })}
              />
            </label>
            <div className="grid gap-2">
              <span className="text-sm font-medium">{t('audience')}</span>
              <Segmented
                label={t('audience')}
                value={state.audience.type}
                onChange={(type) =>
                  set({
                    audience:
                      type === 'everyone'
                        ? { type: 'everyone' }
                        : {
                            type: 'groups',
                            groupKeys: state.audience.type === 'groups' ? state.audience.groupKeys : [],
                          },
                  })
                }
                options={[
                  { value: 'everyone', label: t('audienceEveryone'), icon: <GlobeIcon aria-hidden /> },
                  { value: 'groups', label: t('audienceGroups'), icon: <UsersRoundIcon aria-hidden /> },
                ]}
              />
              <AnimatePresence initial={false}>
                {state.audience.type === 'groups' && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="grid gap-2 pt-2">
                      <p id={`${uid}-groups-hint`} className="text-xs text-muted-foreground">
                        {t('audienceGroupsHint')}
                      </p>
                      <GroupMultiPicker
                        value={state.audience.groupKeys}
                        invalid={issues.includes('groupsRequired')}
                        describedBy={`${uid}-groups-hint`}
                        onChange={(groupKeys) => set({ audience: { type: 'groups', groupKeys } })}
                      />
                      {issues.includes('groupsRequired') && (
                        <p className="text-xs font-medium text-destructive">{t('issues.groupsRequired')}</p>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('versionsTitle')}</CardTitle>
            <CardDescription>{t('versionsDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            {form.versions.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <PencilLineIcon className="size-4" aria-hidden /> {t('neverPublished')}
              </p>
            ) : (
              <ol className="grid gap-3">
                {form.versions.map((v) => (
                  <li key={v.version} className="flex items-center gap-3 text-sm">
                    <Badge
                      variant={v.version === form.publishedVersion ? 'success' : 'muted'}
                      className="tabular-nums"
                    >
                      {v.version === form.publishedVersion && <CircleCheckIcon aria-hidden />}v{v.version}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate">
                      {v.publishedBy ? (
                        <span className="inline-flex items-center gap-1.5">
                          <UserAvatar
                            name={v.publishedBy.displayName}
                            src={v.publishedBy.avatarUrl}
                            className="size-5 text-[9px]"
                          />
                          {v.publishedBy.displayName}
                        </span>
                      ) : (
                        '—'
                      )}
                    </span>
                    <DateTime date={v.publishedAt} className="shrink-0 text-xs text-muted-foreground" />
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        {canAudit && (
          <section aria-labelledby={`${uid}-activity`} className="grid gap-2">
            <h2 id={`${uid}-activity`} className="text-base font-semibold">
              {t('activityTitle')}
            </h2>
            <ActivityFeed subject={{ type: 'form', id: form.id }} description={t('activityDescription')} />
          </section>
        )}
      </div>
    </div>
  );
}
