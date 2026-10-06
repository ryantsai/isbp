'use client';

import type { ModuleInfo } from '@isbp/contracts';
import { ApiError, useCan } from '@isbp/sdk/web';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@isbp/ui/alert-dialog';
import { Button } from '@isbp/ui/button';
import { toast } from '@isbp/ui/sonner';
import { Switch } from '@isbp/ui/switch';
import { Hint } from '@isbp/ui/tooltip';
import {
  CalendarClockIcon,
  LayoutPanelLeftIcon,
  RadioTowerIcon,
  ServerOffIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useApiMutation, useErrorText } from '@/lib/api';
import { useManifestText } from './use-manifest-text';

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
  const control = (
    <Switch
      checked={checked}
      disabled={!canManage || m.system || toggle.isPending}
      onCheckedChange={(next) => (next ? run(true) : setConfirming(true))}
      aria-label={t('toggle.label', { name })}
    />
  );

  return (
    <>
      <div className="flex items-center gap-2">
        {showLabel && (
          <span className="text-xs font-medium text-muted-foreground">
            {checked ? tc('enabled') : tc('disabled')}
          </span>
        )}
        {m.system ? (
          <Hint label={t('systemHint')}>
            <span className="inline-flex" tabIndex={0}>
              {control}
            </span>
          </Hint>
        ) : (
          control
        )}
      </div>

      <AlertDialog open={confirming} onOpenChange={(o) => !toggle.isPending && setConfirming(o)}>
        <AlertDialogContent className="sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('disable.title', { name })}</AlertDialogTitle>
            <AlertDialogDescription>{t('disable.body')}</AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            {(
              [
                ['pages', LayoutPanelLeftIcon],
                ['api', ServerOffIcon],
                ['jobs', CalendarClockIcon],
                ['events', RadioTowerIcon],
              ] as const
            ).map(([key, Icon]) => (
              <li key={key} className="flex items-start gap-2 rounded-lg border bg-muted/30 px-3 py-2">
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span>{t(`disable.impact.${key}`)}</span>
              </li>
            ))}
          </ul>
          {activeDependents.length > 0 ? (
            <div
              role="alert"
              className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-warning-foreground"
            >
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div>
                <p className="font-medium">{t('disable.blockedTitle', { count: activeDependents.length })}</p>
                <p className="mt-0.5">{format.list(activeDependents.map(nameOf), { type: 'conjunction' })}</p>
              </div>
            </div>
          ) : (
            m.dependents.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {t('disable.inactiveDependents', {
                  names: format.list(m.dependents.map(nameOf), { type: 'conjunction' }),
                })}
              </p>
            )
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={toggle.isPending}>{tc('cancel')}</AlertDialogCancel>
            <Button
              variant="destructive"
              loading={toggle.isPending}
              disabled={activeDependents.length > 0}
              onClick={() => run(false)}
            >
              {t('disable.confirm')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
