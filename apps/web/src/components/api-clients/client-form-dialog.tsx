'use client';

import type { ApiClient, CreateApiClientInput, CreatedSecret, UpdateApiClientInput } from '@isbp/contracts';
import { isPermissionPattern } from '@isbp/sdk';
import { countFilled, OptionalFields } from '@isbp/ui/optional-fields';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { useAccessErrorText, useGrantable } from '@/components/roles/role-utils';
import { useApiMutation } from '@/lib/api';
import {
  ApplicationReachField,
  ChipsInput,
  expiryDays,
  isExpiryValid,
  type Reach,
  SECRET_EXPIRY,
  type SecretExpiry,
  SecretExpiryField,
} from './client-parts';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { HStack, Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';

const CIDR_RE = /^[0-9a-fA-F:.]+(\/\d{1,3})?$/;

/** `module.resource.action` with optional `*` — and able to match something (three segments or a trailing `*`). */
const isPlatformPattern = (p: string) =>
  isPermissionPattern(p) && (p.split('.').length === 3 || p.endsWith('*'));
export const CLIENT_INVALIDATE = ['/api-clients', '/applications', '/audit-logs'];

interface Draft {
  name: string;
  description: string;
  reach: Reach;
  permissions: string[];
  cidrs: string[];
  expiry: SecretExpiry;
  customDays: string;
}

function draftOf(client?: ApiClient): Draft {
  return {
    name: client?.name ?? '',
    description: client?.description ?? '',
    reach: {
      allApplications: client?.allApplications ?? false,
      applicationIds: client?.applications.map((a) => a.id) ?? [],
    },
    permissions: client?.permissions ?? [],
    cidrs: client?.allowedCidrs ?? [],
    expiry: SECRET_EXPIRY[2],
    customDays: '',
  };
}

/**
 * Create an API client (then `onCreated` reveals the one-time secret) or edit an existing client's
 * reach. Platform permissions and IP ranges sit under "Advanced".
 */
export function ClientFormDialog({
  open,
  onOpenChange,
  client,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client?: ApiClient;
  onCreated?: (created: CreatedSecret) => void;
}) {
  const t = useTranslations('applications.clients.form');
  const tc = useTranslations('common');
  const accessError = useAccessErrorText();
  const grantable = useGrantable();
  const id = useId();
  const editing = Boolean(client);
  const [draft, setDraft] = useState<Draft>(() => draftOf(client));
  const [submitted, setSubmitted] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [rootError, setRootError] = useState<string | null>(null);

  const wasOpen = useRef(false);
  useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (!opening) return;
    const d = draftOf(client);
    setDraft(d);
    setSubmitted(false);
    setRootError(null);
    setAdvanced(d.permissions.length > 0 || d.cidrs.length > 0);
  }, [open, client]);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const nameError = submitted && !draft.name.trim() ? t('validation.name') : null;
  const reachError =
    submitted &&
    !draft.reach.allApplications &&
    draft.reach.applicationIds.length === 0 &&
    draft.permissions.length === 0
      ? t('validation.reach')
      : null;
  const blocked = draft.permissions.filter((p) => !grantable(p) && !client?.permissions.includes(p));
  const expiryOk = editing || isExpiryValid(draft.expiry, draft.customDays);

  const create = useApiMutation(
    (api, body: CreateApiClientInput) => api.post<CreatedSecret>('/api-clients', body),
    {
      invalidate: CLIENT_INVALIDATE,
      onSuccess: (created) => {
        onOpenChange(false);
        onCreated?.(created);
      },
      silent: true,
    },
  );
  const update = useApiMutation(
    (api, body: UpdateApiClientInput) => api.patch<ApiClient>(`/api-clients/${client!.id}`, body),
    {
      invalidate: CLIENT_INVALIDATE,
      success: t('saved'),
      onSuccess: () => onOpenChange(false),
      silent: true,
    },
  );
  const pending = create.isPending || update.isPending;

  const submit = () => {
    setSubmitted(true);
    setRootError(null);
    const reachMissing =
      !draft.reach.allApplications &&
      draft.reach.applicationIds.length === 0 &&
      draft.permissions.length === 0;
    if (!draft.name.trim() || reachMissing || blocked.length || !expiryOk) {
      if (blocked.length || !expiryOk) setAdvanced(true);
      return;
    }
    const body = {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      allApplications: draft.reach.allApplications,
      applicationIds: draft.reach.allApplications ? [] : draft.reach.applicationIds,
      permissions: draft.permissions,
      allowedCidrs: draft.cidrs,
    };
    const onError = (err: unknown) => setRootError(accessError(err));
    if (editing) update.mutate(body, { onError });
    else
      create.mutate(
        { ...body, secretExpiresInDays: expiryDays(draft.expiry, draft.customDays) },
        { onError },
      );
  };

  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange} width={576} purpose="form">
      <Layout
        header={
          <DialogHeader
            title={editing ? t('editTitle', { name: client!.name }) : t('createTitle')}
            subtitle={editing ? t('editDescription') : t('createDescription')}
            onOpenChange={onOpenChange}
          />
        }
        content={
          <LayoutContent padding={4}>
            <form
              id={id}
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
              noValidate
            >
              <FormLayout defaultOptionality="optional">
                {editing && <Banner status="info" title={t('tokensRevoked')} collapsible={false} />}
                <TextInput
                  label={t('name')}
                  isRequired
                  value={draft.name}
                  onChange={(name) => set({ name: name.slice(0, 200) })}
                  placeholder={t('namePlaceholder')}
                  autoComplete="off"
                  hasAutoFocus
                  status={nameError ? { type: 'error', message: nameError } : undefined}
                />
                <TextArea
                  label={t('description')}
                  isOptional
                  rows={2}
                  value={draft.description}
                  onChange={(description) => set({ description: description.slice(0, 2000) })}
                  placeholder={t('descriptionPlaceholder')}
                />

                <ApplicationReachField
                  value={draft.reach}
                  onChange={(reach) => set({ reach })}
                  invalid={reachError}
                />

                {!editing && (
                  <SecretExpiryField
                    choice={draft.expiry}
                    custom={draft.customDays}
                    onChoice={(expiry) => set({ expiry })}
                    onCustom={(customDays) => set({ customDays })}
                    showError={submitted}
                  />
                )}

                <OptionalFields
                  label={t('advanced')}
                  open={advanced}
                  onOpenChange={setAdvanced}
                  filled={countFilled(draft.permissions, draft.cidrs)}
                >
                  <FormLayout defaultOptionality="optional">
                    <ChipsInput
                      label={t('permissions')}
                      description={blocked.length > 0 ? undefined : t('permissionsHint')}
                      value={draft.permissions}
                      onChange={(permissions) => set({ permissions })}
                      validate={(p) => (isPlatformPattern(p) ? null : t('permissionInvalid'))}
                      placeholder="core.users.read"
                      chipColor={(p) => (blocked.includes(p) ? 'red' : undefined)}
                      invalid={blocked.length > 0 ? t('notHeld', { permissions: blocked.join(', ') }) : null}
                    />
                    <ChipsInput
                      label={t('cidrs')}
                      description={t('cidrsHint')}
                      value={draft.cidrs}
                      onChange={(cidrs) => set({ cidrs })}
                      validate={(c) => (c.length <= 64 && CIDR_RE.test(c) ? null : t('cidrInvalid'))}
                      placeholder="10.0.0.0/8"
                    />
                  </FormLayout>
                </OptionalFields>

                {rootError && <Banner status="error" title={rootError} collapsible={false} />}
              </FormLayout>
            </form>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={2} hAlign="end">
              <Button
                label={tc('cancel')}
                variant="ghost"
                type="button"
                onClick={() => onOpenChange(false)}
              />
              <Button
                label={editing ? tc('saveChanges') : t('submit')}
                variant="primary"
                isLoading={pending}
                type="submit"
                form={id}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
