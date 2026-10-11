'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Grid } from '@astryxdesign/core/Grid';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, Layout, LayoutContent, LayoutFooter, VStack } from '@astryxdesign/core/Layout';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import type { ModuleInfo } from '@isbp/contracts';
import { ApiError, useCan } from '@isbp/sdk/web';
import { toast } from '@isbp/ui/toast';
import { CalendarClockIcon, LayoutPanelLeftIcon, RadioTowerIcon, ServerOffIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useApiMutation, useErrorText } from '@/lib/api';
import { useManifestText } from './use-manifest-text';

const IMPACTS = [
  ['pages', LayoutPanelLeftIcon],
  ['api', ServerOffIcon],
  ['jobs', CalendarClockIcon],
  ['events', RadioTowerIcon],
] as const;

/**
 * Enable/disable switch for a module. Enabling is immediate; disabling asks for confirmation and
 * explains the impact. Dependency rules are enforced by the API (409) and explained here.
 */
export function ModuleSwitch({
  module: m,
  all,
  showLabel = false,
}: {
  module: ModuleInfo;
  all: ModuleInfo[];
  showLabel?: boolean;
}) {
  const t = useTranslations('modules');
  const tc = useTranslations('common');
  const text = useManifestText();
  const format = useFormatter();
  const errorText = useErrorText();
  const router = useRouter();
  const canManage = useCan('core.modules.manage');
  const [confirming, setConfirming] = useState(false);

  const name = text(m.name);
  const byId = new Map(all.map((x) => [x.id, x]));
  const nameOf = (id: string) => (byId.get(id) ? text(byId.get(id)!.name) : id);
  const activeDependents = m.dependents.filter((id) => byId.get(id)?.enabled);
  const missingDependencies = m.dependsOn.filter((id) => !byId.get(id)?.enabled);

  const toggle = useApiMutation(
    (api, enabled: boolean) => api.post<ModuleInfo>(`/modules/${m.id}/toggle`, { enabled }),
    {
      invalidate: ['/modules', '/platform'],
      success: (r) => (r.enabled ? t('toggle.enabledToast', { name }) : t('toggle.disabledToast', { name })),
      onSuccess: () => {
        setConfirming(false);
        // Navigation and enabled modules come from the server layout.
        router.refresh();
      },
      silent: true,
    },
  );

  const run = (enabled: boolean) =>
    toggle.mutate(enabled, {
      onError: (err) => {
        const blockers = enabled ? missingDependencies : activeDependents;
        if (err instanceof ApiError && err.status === 409 && blockers.length) {
          const names = format.list(blockers.map(nameOf), { type: 'conjunction' });
          toast.error(
            enabled ? t('toggle.needsDependencies', { names }) : t('toggle.hasDependents', { names }),
          );
        } else {
          toast.error(errorText(err));
        }
      },
    });

  const checked = toggle.isPending ? Boolean(toggle.variables) : m.enabled;
  const close = (open: boolean) => {
    if (!toggle.isPending) setConfirming(open);
  };

  return (
    <>
      <HStack gap={2} vAlign="center">
        {showLabel && (
          <Text type="supporting" weight="medium">
            {checked ? tc('enabled') : tc('disabled')}
          </Text>
        )}
        <Switch
          label={t('toggle.label', { name })}
          isLabelHidden
          value={checked}
          isDisabled={!canManage || m.system || toggle.isPending}
          disabledMessage={m.system ? t('systemHint') : undefined}
          onChange={(next) => (next ? run(true) : setConfirming(true))}
        />
      </HStack>

      {/* Built on `Dialog` (like `ConfirmDialog`): the impact list and the blockers go inside it. */}
      <Dialog isOpen={confirming} onOpenChange={close} width={512} purpose="form" role="alertdialog">
        <Layout
          header={
            <DialogHeader
              title={t('disable.title', { name })}
              subtitle={t('disable.body')}
              hasDivider={false}
            />
          }
          content={
            <LayoutContent padding={4}>
              <VStack gap={3}>
                <Grid columns={{ minWidth: 200 }} gap={2}>
                  {IMPACTS.map(([key, icon]) => (
                    <HStack key={key} gap={2} vAlign="start">
                      <Icon icon={icon} color="secondary" />
                      <Text>{t(`disable.impact.${key}`)}</Text>
                    </HStack>
                  ))}
                </Grid>
                {activeDependents.length > 0 ? (
                  <Banner
                    status="warning"
                    title={t('disable.blockedTitle', { count: activeDependents.length })}
                    description={format.list(activeDependents.map(nameOf), { type: 'conjunction' })}
                    collapsible={false}
                  />
                ) : (
                  m.dependents.length > 0 && (
                    <Text type="supporting">
                      {t('disable.inactiveDependents', {
                        names: format.list(m.dependents.map(nameOf), { type: 'conjunction' }),
                      })}
                    </Text>
                  )
                )}
              </VStack>
            </LayoutContent>
          }
          footer={
            <LayoutFooter padding={3}>
              <HStack gap={2} hAlign="end" wrap="wrap">
                {/* Cancel is the least destructive choice, so it takes the initial focus. */}
                <Button
                  label={tc('cancel')}
                  variant="ghost"
                  isDisabled={toggle.isPending}
                  onClick={() => close(false)}
                  data-autofocus="true"
                />
                <Button
                  label={t('disable.confirm')}
                  variant="destructive"
                  isLoading={toggle.isPending}
                  isDisabled={activeDependents.length > 0}
                  onClick={() => run(false)}
                />
              </HStack>
            </LayoutFooter>
          }
        />
      </Dialog>
    </>
  );
}
