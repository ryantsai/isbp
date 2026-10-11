'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack, Layout, LayoutContent, LayoutFooter, VStack } from '@astryxdesign/core/Layout';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { LocalizedText } from '@isbp/sdk';
import { LocalizedInput } from '@isbp/ui/localized-input';
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import { type PersonOption, PersonPicker } from '@isbp/ui/person-picker';
import { useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import {
  type CreateRoleInput,
  durationPolicyProblem,
  type GroupOption,
  type Inventory,
  type RequestableRole,
  type Risk,
  RISKS,
  type Server,
} from '../contracts';
import { INVALIDATE } from './lib';

const SERVER_LEVEL = '__server__';
const DEFAULT_DAYS = 30;
const DEFAULT_MAX_DAYS = 90;
/** Lists longer than this get a search box in the dropdown. */
const SEARCH_FROM = 8;

type Target = { kind: 'create'; server: Server } | { kind: 'edit'; server: Server; role: RequestableRole };

/** Make an inventory role requestable (create), or change one (edit): owner, risk and durations. */
export function RoleFormDialog({ target, onClose }: { target: Target | null; onClose: () => void }) {
  const t = useTranslations('dbaccess.roleForm');
  // The form (and its header) mounts after the dialog opens, so name the dialog here: Astryx reads the title at mount.
  return (
    <Dialog
      isOpen={Boolean(target)}
      onOpenChange={(o) => !o && onClose()}
      width={672}
      purpose="form"
      aria-label={
        target?.kind === 'edit'
          ? t('editTitle', { role: target.role.roleName })
          : target
            ? t('createTitle')
            : undefined
      }
    >
      {target && (
        <RoleForm key={target.kind === 'edit' ? target.role.id : 'new'} target={target} onDone={onClose} />
      )}
    </Dialog>
  );
}

function RoleForm({ target, onDone }: { target: Target; onDone: () => void }) {
  const t = useTranslations('dbaccess.roleForm');
  const tr = useTranslations('dbaccess.risk');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const list = useFieldList();
  const formId = useId();
  const ids = { name: useId(), desc: useId(), owner: useId() };
  const role = target.kind === 'edit' ? target.role : null;
  const mssql = target.server.engine === 'mssql';
  const inventory = useApiQuery<Inventory>(
    target.kind === 'create' ? `/dbaccess/servers/${target.server.id}/inventory` : null,
  );
  const groups = useApiQuery<{ items: GroupOption[] }>('/dbaccess/lookups/groups');
  const [v, setV] = useState({
    database: role?.database ?? null,
    roleName: role?.roleName ?? '',
    name: (role?.name ?? {}) as LocalizedText,
    description: (role?.description ?? null) as LocalizedText | null,
    ownerKind: (role?.owner?.kind ?? 'group') as 'user' | 'group',
    owner: (role?.owner?.kind === 'user'
      ? { id: role.owner.id, displayName: role.owner.name }
      : null) as PersonOption | null,
    ownerGroupId: role?.owner?.kind === 'group' ? role.owner.id : null,
    risk: (role?.risk ?? 'medium') as Risk,
    defaultDays: role ? role.defaultDays : DEFAULT_DAYS,
    maxDays: role ? role.maxDays : DEFAULT_MAX_DAYS,
    allowPermanent: role?.allowPermanent ?? false,
    justificationRequired: role?.justificationRequired ?? true,
    active: role?.active ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const patch = (p: Partial<typeof v>) => setV((x) => ({ ...x, ...p }));
  const detailsFilled = countFilled(
    v.defaultDays !== DEFAULT_DAYS,
    v.maxDays !== DEFAULT_MAX_DAYS,
    v.allowPermanent,
    !v.justificationRequired,
  );
  const save = useApiMutation(
    (api, body: Partial<CreateRoleInput>) =>
      target.kind === 'edit'
        ? api.patch<RequestableRole>(`/dbaccess/roles/${target.role.id}`, body)
        : api.post<RequestableRole>(`/dbaccess/servers/${target.server.id}/roles`, body),
    { invalidate: INVALIDATE, success: t('saved'), silent: true, onSuccess: onDone },
  );
  const databases = inventory.data?.databases ?? [];
  const candidates = (inventory.data?.roles ?? []).filter(
    (r) => (r.database ?? null) === (v.database ?? null) && !r.requestableRoleId,
  );
  const days = (n: number | null) => (n === null ? null : Math.max(1, Math.floor(n) || 1));
  const groupItems = groups.data?.items ?? [];

  return (
    <Layout
      header={
        <DialogHeader
          title={role ? t('editTitle', { role: role.roleName }) : t('createTitle')}
          subtitle={t('description')}
          onOpenChange={(o) => !o && onDone()}
        />
      }
      content={
        <LayoutContent padding={4}>
          <form
            id={formId}
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!role && !v.roleName) return setError(t('roleRequired'));
              if (!Object.values(v.name).some(Boolean)) return setError(t('nameRequired'));
              const ownerUserId = v.ownerKind === 'user' ? (v.owner?.id ?? null) : null;
              const ownerGroupId = v.ownerKind === 'group' ? v.ownerGroupId : null;
              if (!ownerUserId && !ownerGroupId) return setError(t('ownerRequired'));
              const problem = durationPolicyProblem(v);
              if (problem) {
                setMoreOpen(true);
                return setError(t(`problems.${problem}`));
              }
              setError(null);
              const common = {
                name: v.name,
                description:
                  v.description && Object.values(v.description).some(Boolean) ? v.description : null,
                ownerUserId,
                ownerGroupId,
                risk: v.risk,
                defaultDays: v.defaultDays,
                maxDays: v.maxDays,
                allowPermanent: v.allowPermanent,
                justificationRequired: v.justificationRequired,
                active: v.active,
              };
              save.mutate(role ? common : { ...common, database: v.database, roleName: v.roleName }, {
                onError: (err) => setError(errorText(err)),
              });
            }}
          >
            <FormLayout defaultOptionality="optional">
              {role ? (
                <TextInput
                  label={t('role')}
                  isReadOnly
                  value={`${role.database ? `${role.database}.` : ''}${role.roleName}`}
                  onChange={() => {}}
                />
              ) : (
                <Grid columns={{ minWidth: 240 }} gap={4}>
                  {mssql && (
                    <Selector
                      label={t('database')}
                      value={v.database ?? SERVER_LEVEL}
                      hasSearch={databases.length > SEARCH_FROM}
                      onChange={(x) => patch({ database: x === SERVER_LEVEL ? null : x, roleName: '' })}
                      options={[
                        { value: SERVER_LEVEL, label: t('serverLevel') },
                        ...databases.map((d) => ({ value: d, label: d })),
                      ]}
                    />
                  )}
                  {/* A searchable Selector is a button: aria-required is not allowed on it, so only a plain one is marked required. */}
                  <Selector
                    label={t('role')}
                    isRequired={candidates.length <= SEARCH_FROM}
                    value={v.roleName || undefined}
                    placeholder={t('rolePlaceholder')}
                    description={t('roleHint')}
                    hasSearch={candidates.length > SEARCH_FROM}
                    onChange={(x) =>
                      patch({ roleName: x, name: Object.values(v.name).some(Boolean) ? v.name : { en: x } })
                    }
                    options={candidates.map((r) => ({
                      value: r.name,
                      label: `${r.name} (${t('members', { count: r.members })})`,
                    }))}
                  />
                </Grid>
              )}
              <Field label={t('name')} inputID={ids.name} isRequired>
                <LocalizedInput id={ids.name} value={v.name} onChange={(name) => patch({ name })} />
              </Field>
              <Field label={t('roleDescription')} inputID={ids.desc} isOptional>
                <LocalizedInput
                  id={ids.desc}
                  multiline
                  value={v.description}
                  onChange={(description) => patch({ description })}
                />
              </Field>
              <Grid columns={{ minWidth: 240 }} gap={4}>
                <Selector
                  label={t('ownerKind')}
                  value={v.ownerKind}
                  onChange={(x) => patch({ ownerKind: x as 'user' | 'group' })}
                  options={[
                    { value: 'group', label: t('ownerGroup') },
                    { value: 'user', label: t('ownerPerson') },
                  ]}
                />
                {v.ownerKind === 'user' ? (
                  <Field label={t('owner')} inputID={ids.owner} isRequired>
                    <PersonPicker id={ids.owner} value={v.owner} onChange={(owner) => patch({ owner })} />
                  </Field>
                ) : (
                  <Selector
                    label={t('owner')}
                    isRequired={groupItems.length <= SEARCH_FROM}
                    value={v.ownerGroupId ?? undefined}
                    placeholder={t('groupPlaceholder')}
                    hasSearch={groupItems.length > SEARCH_FROM}
                    onChange={(x) => patch({ ownerGroupId: x })}
                    options={groupItems.map((g) => ({ value: g.id, label: g.name }))}
                  />
                )}
                <Selector
                  label={t('risk')}
                  value={v.risk}
                  description={t('riskHint')}
                  onChange={(x) => patch({ risk: x as Risk })}
                  options={RISKS.map((r) => ({ value: r, label: tr(r) }))}
                />
              </Grid>
              {role && (
                <Switch label={t('active')} value={v.active} onChange={(active) => patch({ active })} />
              )}
              <OptionalFields
                hint={list([t('duration'), t('justificationRequired')])}
                filled={detailsFilled}
                open={moreOpen}
                onOpenChange={setMoreOpen}
              >
                <VStack gap={4}>
                  <VStack gap={3}>
                    <Text type="label">{t('duration')}</Text>
                    <Grid columns={{ minWidth: 240 }} gap={4}>
                      <NumberInput
                        label={t('defaultDays')}
                        min={1}
                        hasClear
                        isIntegerOnly
                        value={v.defaultDays}
                        placeholder={v.allowPermanent ? t('permanentPlaceholder') : ''}
                        onChange={(n) => patch({ defaultDays: days(n) })}
                      />
                      <NumberInput
                        label={t('maxDays')}
                        min={1}
                        hasClear
                        isIntegerOnly
                        value={v.maxDays}
                        placeholder={v.allowPermanent ? t('noLimitPlaceholder') : ''}
                        onChange={(n) => patch({ maxDays: days(n) })}
                      />
                    </Grid>
                    <Switch
                      label={t('allowPermanent')}
                      value={v.allowPermanent}
                      onChange={(allowPermanent) => patch({ allowPermanent })}
                    />
                  </VStack>
                  <Switch
                    label={t('justificationRequired')}
                    value={v.justificationRequired}
                    onChange={(justificationRequired) => patch({ justificationRequired })}
                  />
                </VStack>
              </OptionalFields>
              {error && <Banner status="error" title={error} collapsible={false} />}
            </FormLayout>
          </form>
        </LayoutContent>
      }
      footer={
        <LayoutFooter hasDivider padding={3}>
          <HStack gap={2} hAlign="end">
            <Button label={tc('cancel')} variant="ghost" type="button" onClick={onDone} />
            <Button
              label={role ? tc('saveChanges') : t('create')}
              variant="primary"
              isLoading={save.isPending}
              type="submit"
              form={formId}
            />
          </HStack>
        </LayoutFooter>
      }
    />
  );
}
