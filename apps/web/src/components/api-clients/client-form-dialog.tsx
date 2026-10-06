'use client';

import type { ApiClient, CreateApiClientInput, CreatedSecret, UpdateApiClientInput } from '@isbp/contracts';
import { isPermissionPattern } from '@isbp/sdk';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@isbp/ui/dialog';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { Textarea } from '@isbp/ui/textarea';
import { AlertTriangleIcon, ChevronDownIcon, InfoIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('close')} className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? t('editTitle', { name: client!.name }) : t('createTitle')}</DialogTitle>
          <DialogDescription>{editing ? t('editDescription') : t('createDescription')}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          noValidate
          className="min-w-0 space-y-5"
        >
          {editing && (
            <p className="flex items-start gap-2 rounded-md border border-info/30 bg-info/5 px-3 py-2 text-sm">
              <InfoIcon className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
              {t('tokensRevoked')}
            </p>
          )}
          <div className="grid gap-2">
            <Label htmlFor={`${id}-name`}>{t('name')}</Label>
            <Input
              id={`${id}-name`}
              value={draft.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder={t('namePlaceholder')}
              maxLength={200}
              autoComplete="off"
              autoFocus
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? `${id}-name-error` : undefined}
            />
            {nameError && (
              <p id={`${id}-name-error`} className="text-xs text-destructive">
                {nameError}
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-desc`}>
              {t('description')} <span className="font-normal text-muted-foreground">({tc('optional')})</span>
            </Label>
            <Textarea
              id={`${id}-desc`}
              rows={2}
              value={draft.description}
              onChange={(e) => set({ description: e.target.value })}
              placeholder={t('descriptionPlaceholder')}
              maxLength={2000}
            />
          </div>

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

          <div>
            <button
              type="button"
              onClick={() => setAdvanced((a) => !a)}
              aria-expanded={advanced}
              className="flex items-center gap-1.5 rounded-sm text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <ChevronDownIcon
                className={`size-4 transition-transform duration-200 ${advanced ? 'rotate-180' : ''}`}
                aria-hidden
              />
              {advanced ? tc('hideAdvanced') : t('advanced')}
              {!advanced && (draft.permissions.length > 0 || draft.cidrs.length > 0) && (
                <Badge variant="info">
                  {t('advancedSet', { count: draft.permissions.length + draft.cidrs.length })}
                </Badge>
              )}
            </button>
            <AnimatePresence initial={false}>
              {advanced && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="space-y-5 px-0.5 pt-4 pb-0.5">
                    <div className="grid gap-2">
                      <Label htmlFor={`${id}-perms`}>{t('permissions')}</Label>
                      <ChipsInput
                        id={`${id}-perms`}
                        value={draft.permissions}
                        onChange={(permissions) => set({ permissions })}
                        validate={(p) => (isPlatformPattern(p) ? null : t('permissionInvalid'))}
                        placeholder="core.users.read"
                        addLabel={tc('add')}
                        removeLabel={(p) => t('removeEntry', { value: p })}
                        chipClassName={(p) =>
                          blocked.includes(p) ? 'border-destructive/50 text-destructive' : undefined
                        }
                        describedBy={`${id}-perms-hint`}
                      />
                      {blocked.length > 0 ? (
                        <p className="flex items-start gap-1.5 text-xs text-destructive" role="alert">
                          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                          {t('notHeld', { permissions: blocked.join(', ') })}
                        </p>
                      ) : (
                        <p id={`${id}-perms-hint`} className="text-xs text-muted-foreground">
                          {t('permissionsHint')}
                        </p>
                      )}
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor={`${id}-cidrs`}>{t('cidrs')}</Label>
                      <ChipsInput
                        id={`${id}-cidrs`}
                        value={draft.cidrs}
                        onChange={(cidrs) => set({ cidrs })}
                        validate={(c) => (c.length <= 64 && CIDR_RE.test(c) ? null : t('cidrInvalid'))}
                        placeholder="10.0.0.0/8"
                        addLabel={tc('add')}
                        removeLabel={(c) => t('removeEntry', { value: c })}
                        describedBy={`${id}-cidrs-hint`}
                      />
                      <p id={`${id}-cidrs-hint`} className="text-xs text-muted-foreground">
                        {t('cidrsHint')}
                      </p>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {rootError && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              {rootError}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" loading={pending}>
              {editing ? tc('saveChanges') : t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
