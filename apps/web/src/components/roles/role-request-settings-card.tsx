'use client';

import type { Role } from '@isbp/contracts';
import { useCan } from '@isbp/sdk/web';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { toast } from '@isbp/ui/toast';
import { HandIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useApiMutation } from '@/lib/api';
import {
  draftEquals,
  draftFromRole,
  draftToBody,
  isDraftValid,
  type RequestSettingsDraft,
  RequestSettingsFields,
  RequestSettingsSummary,
} from './request-settings';
import { useAccessErrorText } from './role-utils';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack } from '@astryxdesign/core/Layout';

/**
 * "Self-service requests" for a platform role: whether people can request it in the portal, its risk,
 * owner, longest grant and approval workflow (`PUT /roles/:id/request-settings`). Read-only without
 * `core.roles.manage`.
 */
export function RoleRequestSettingsCard({ role }: { role: Role }) {
  const t = useTranslations('roles.requestSettings');
  const tc = useTranslations('common');
  const canManage = useCan('core.roles.manage');
  const accessError = useAccessErrorText();
  const saved = draftFromRole(role);
  const [draft, setDraft] = useState<RequestSettingsDraft | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const current = draft ?? saved;
  const dirty = draft !== null && !draftEquals(draft, saved);

  const save = useApiMutation(
    (api, d: RequestSettingsDraft) => api.put<Role>(`/roles/${role.id}/request-settings`, draftToBody(d)),
    {
      invalidate: ['/roles', '/requests', '/audit-logs'],
      success: t('saved'),
      onSuccess: () => {
        setDraft(null);
        setSubmitted(false);
      },
      silent: true,
    },
  );

  const onSave = () => {
    setSubmitted(true);
    if (!isDraftValid(current)) return;
    save.mutate(current, { onError: (err) => toast.error(accessError(err)) });
  };

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>
          <HStack gap={2} vAlign="center">
            <Icon icon={HandIcon} color="secondary" />
            {t('title')}
          </HStack>
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {canManage ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSave();
            }}
            noValidate
            className="space-y-4"
          >
            <RequestSettingsFields
              value={current}
              onChange={setDraft}
              disabled={save.isPending}
              showErrors={submitted}
            />
            <AnimatePresence initial={false}>
              {dirty && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  transition={{ duration: 0.18 }}
                  className="flex flex-wrap items-center justify-end gap-2 border-t pt-4"
                >
                  <span
                    className="mr-auto flex items-center gap-2 text-xs text-muted-foreground"
                    aria-live="polite"
                  >
                    <span className="size-1.5 rounded-full bg-warning" aria-hidden />
                    {t('unsaved')}
                  </span>
                  <Button
                    label={t('reset')}
                    variant="ghost"
                    size="sm"
                    isDisabled={save.isPending}
                    type="button"
                    onClick={() => {
                      setDraft(null);
                      setSubmitted(false);
                    }}
                  />
                  <Button
                    label={tc('saveChanges')}
                    variant="primary"
                    size="sm"
                    isLoading={save.isPending}
                    type="submit"
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </form>
        ) : (
          <RequestSettingsSummary role={role} />
        )}
      </CardContent>
    </Card>
  );
}
