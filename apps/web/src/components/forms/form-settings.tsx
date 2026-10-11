'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid } from '@astryxdesign/core/Grid';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Switch } from '@astryxdesign/core/Switch';
import { Heading, Text } from '@astryxdesign/core/Text';
import type { FormDetail, FormSummary } from '@isbp/contracts';
import { useCan } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { LocalizedInput } from '@isbp/ui/localized-input';
import { CircleCheckIcon, GlobeIcon, PencilLineIcon, UsersRoundIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useId, useMemo } from 'react';
import { ActivityFeed } from '@/components/audit/activity-feed';
import { hasText } from '@/components/fields/field-utils';
import { DateTime } from '@/components/relative-time';
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
  const nameError = issues.includes('nameRequired')
    ? ({ type: 'error', message: t('issues.nameRequired') } as const)
    : undefined;
  const groupsError = issues.includes('groupsRequired')
    ? ({ type: 'error', message: t('issues.groupsRequired') } as const)
    : undefined;

  return (
    <Grid columns={{ minWidth: 380, max: 2 }} gap={4} align="start">
      <Card>
        <CardHeader>
          <CardTitle>{t('detailsTitle')}</CardTitle>
          <CardDescription>{t('detailsDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <FormLayout defaultOptionality="optional">
            <Field label={t('name')} inputID={`${uid}-name`} isRequired status={nameError}>
              <LocalizedInput
                id={`${uid}-name`}
                value={state.name}
                invalid={Boolean(nameError)}
                onChange={(name) => set({ name }, 'settings:name')}
              />
            </Field>
            <Field label={t('description')} inputID={`${uid}-description`}>
              <LocalizedInput
                id={`${uid}-description`}
                multiline
                value={state.description}
                onChange={(description) => set({ description }, 'settings:description')}
              />
            </Field>
            <IconPicker label={t('icon')} value={state.icon} onChange={(icon) => set({ icon })} />
            <CategoryInput
              label={t('category')}
              description={t('categoryHint')}
              value={state.category}
              suggestions={categories}
              onChange={(category) => set({ category }, 'settings:category')}
            />
          </FormLayout>
        </CardContent>
      </Card>

      <VStack gap={4}>
        <Card>
          <CardHeader>
            <CardTitle>{t('availabilityTitle')}</CardTitle>
            <CardDescription>{t('availabilityDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <VStack gap={5}>
              <Switch
                label={t('active')}
                description={state.active ? t('activeOn') : t('activeOff')}
                value={state.active}
                onChange={(active) => set({ active })}
                labelPosition="start"
                labelSpacing="spread"
                width="100%"
              />
              <Field label={t('audience')} isGroupLabel inputID={`${uid}-audience`}>
                <VStack gap={2} id={`${uid}-audience`}>
                  <SegmentedControl
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
                  >
                    <SegmentedControlItem
                      value="everyone"
                      label={t('audienceEveryone')}
                      icon={<Icon icon={GlobeIcon} />}
                    />
                    <SegmentedControlItem
                      value="groups"
                      label={t('audienceGroups')}
                      icon={<Icon icon={UsersRoundIcon} />}
                    />
                  </SegmentedControl>
                  <AnimatePresence initial={false}>
                    {state.audience.type === 'groups' && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <GroupMultiPicker
                          label={t('selectedGroups')}
                          description={t('audienceGroupsHint')}
                          value={state.audience.groupKeys}
                          status={groupsError}
                          onChange={(groupKeys) => set({ audience: { type: 'groups', groupKeys } })}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </VStack>
              </Field>
            </VStack>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('versionsTitle')}</CardTitle>
            <CardDescription>{t('versionsDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            {form.versions.length === 0 ? (
              <HStack gap={2} vAlign="center">
                <Icon icon={PencilLineIcon} color="secondary" />
                <Text color="secondary">{t('neverPublished')}</Text>
              </HStack>
            ) : (
              <VStack as="ol" gap={3}>
                {form.versions.map((v) => (
                  <HStack as="li" key={v.version} gap={3} vAlign="center">
                    <Badge
                      variant={v.version === form.publishedVersion ? 'success' : 'neutral'}
                      label={`v${v.version}`}
                      icon={
                        v.version === form.publishedVersion ? (
                          <Icon icon={CircleCheckIcon} size="xsm" />
                        ) : undefined
                      }
                    />
                    <StackItem size="fill">
                      {v.publishedBy ? (
                        <HStack gap={1.5} vAlign="center">
                          <UserAvatar
                            name={v.publishedBy.displayName}
                            src={v.publishedBy.avatarUrl}
                            className="size-5 text-[9px]"
                          />
                          <Text maxLines={1}>{v.publishedBy.displayName}</Text>
                        </HStack>
                      ) : (
                        <Text>—</Text>
                      )}
                    </StackItem>
                    <Text type="supporting">
                      <DateTime date={v.publishedAt} />
                    </Text>
                  </HStack>
                ))}
              </VStack>
            )}
          </CardContent>
        </Card>

        {canAudit && (
          <VStack as="section" gap={2} aria-labelledby={`${uid}-activity`}>
            <Heading level={2} id={`${uid}-activity`}>
              {t('activityTitle')}
            </Heading>
            <ActivityFeed subject={{ type: 'form', id: form.id }} description={t('activityDescription')} />
          </VStack>
        )}
      </VStack>
    </Grid>
  );
}
