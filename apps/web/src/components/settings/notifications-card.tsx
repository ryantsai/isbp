'use client';

import type { NotificationPreference, NotificationPreferences } from '@isbp/contracts';
import { useApi } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { Skeleton } from '@isbp/ui/skeleton';
import { toast } from '@isbp/ui/sonner';
import { Spinner } from '@isbp/ui/spinner';
import { Switch } from '@isbp/ui/switch';
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query';
import { BellIcon, CheckIcon, LockIcon, MailIcon, MailXIcon, RotateCcwIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useModuleName, useTypeLabel } from '@/components/notifications/notification-meta';
import { useApiQuery, useErrorText } from '@/lib/api';

const PATH = '/me/notification-preferences';
const KEY = [PATH, {}];
const MUTATION_KEY = ['notification-preferences'];

type Change = { type: string; inApp: boolean; email: boolean };

/** Email is forced on for a mandatory type whose default includes email (mirrors the API). */
const emailLocked = (p: NotificationPreference) => p.mandatory && p.defaults.email;

/**
 * Per-type, per-channel notification switches. Each toggle saves at once (optimistic; rolled back
 * with a toast if the API refuses). Mandatory types keep in-app on.
 */
export function NotificationsCard() {
  const t = useTranslations('settings.notifications');
  const typeLabel = useTypeLabel();
  const moduleName = useModuleName();
  const errorText = useErrorText();
  const api = useApi();
  const client = useQueryClient();
  const hintId = useId();
  const { data, isLoading } = useApiQuery<NotificationPreferences>(PATH);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const save = useMutation({
    mutationKey: MUTATION_KEY,
    mutationFn: (items: Change[]) => api.put<NotificationPreferences>(PATH, { items }),
    onMutate: async (items) => {
      await client.cancelQueries({ queryKey: KEY });
      const prev = client.getQueryData<NotificationPreferences>(KEY);
      if (prev) {
        const byType = new Map(items.map((i) => [i.type, i]));
        client.setQueryData<NotificationPreferences>(KEY, {
          ...prev,
          items: prev.items.map((p) => {
            const c = byType.get(p.type);
            if (!c) return p;
            return {
              ...p,
              inApp: p.mandatory ? true : c.inApp,
              email: c.email || emailLocked(p),
            };
          }),
        });
      }
      return { prev };
    },
    onError: (err, _items, ctx) => {
      if (ctx?.prev) client.setQueryData(KEY, ctx.prev);
      toast.error(errorText(err));
    },
    onSuccess: (result) => {
      // Only the last of several quick toggles writes the server's answer back (no flicker).
      if (client.isMutating({ mutationKey: MUTATION_KEY }) <= 1) client.setQueryData(KEY, result);
      setSavedAt(Date.now());
    },
  });
  const saving = useIsMutating({ mutationKey: MUTATION_KEY }) > 0;
  useEffect(() => {
    if (!savedAt) return;
    const h = setTimeout(() => setSavedAt(null), 2500);
    return () => clearTimeout(h);
  }, [savedAt]);

  // Emails link to /settings#notifications. The table grows once loaded, which moves this card's
  // anchor and every one below it — re-apply the URL's anchor then.
  const scrolled = useRef(false);
  const loaded = Boolean(data);
  useEffect(() => {
    if (!loaded || scrolled.current) return;
    scrolled.current = true;
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, [loaded]);

  const emailAvailable = data?.emailAvailable ?? false;
  const groups = useMemo(() => {
    const map = new Map<string, NotificationPreference[]>();
    for (const item of data?.items ?? []) {
      const list = map.get(item.moduleId) ?? [];
      list.push(item);
      map.set(item.moduleId, list);
    }
    return [...map.entries()].map(([moduleId, items]) => ({ moduleId, items }));
  }, [data]);

  const atDefaults = (data?.items ?? []).every(
    (p) => p.inApp === p.defaults.inApp && p.email === p.defaults.email,
  );

  const toggle = (p: NotificationPreference, channel: 'inApp' | 'email', value: boolean) => {
    save.mutate([
      {
        type: p.type,
        inApp: channel === 'inApp' ? value : p.inApp,
        // The API reports the stored email choice even while email is off platform-wide.
        email: channel === 'email' ? value : p.email,
      },
    ]);
  };

  const reset = () =>
    save.mutate(
      (data?.items ?? []).map((p) => ({ type: p.type, inApp: p.defaults.inApp, email: p.defaults.email })),
      { onSuccess: () => toast.success(t('resetDone')) },
    );

  return (
    <Card id="notifications" className="scroll-mt-20">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" onClick={reset} disabled={!data || atDefaults || saving}>
            <RotateCcwIcon /> <span className="hidden sm:inline">{t('reset')}</span>
            <span className="sr-only sm:hidden">{t('reset')}</span>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex min-h-5 items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">{t('autosave')}</p>
          <p aria-live="polite" className="text-xs text-muted-foreground">
            <AnimatePresence mode="wait" initial={false}>
              {saving ? (
                <motion.span
                  key="saving"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="inline-flex items-center gap-1.5"
                >
                  <Spinner className="size-3" /> {t('saving')}
                </motion.span>
              ) : savedAt ? (
                <motion.span
                  key="saved"
                  initial={{ opacity: 0, y: 2 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="inline-flex items-center gap-1 text-success"
                >
                  <CheckIcon className="size-3.5" aria-hidden /> {t('saved')}
                </motion.span>
              ) : null}
            </AnimatePresence>
          </p>
        </div>

        {data && !emailAvailable && (
          <div
            id={hintId}
            className="flex items-start gap-2.5 rounded-lg border border-dashed bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground"
          >
            <MailXIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>{t('emailUnavailable')}</p>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-5 w-8 rounded-full" />
                <Skeleton className="h-5 w-8 rounded-full" />
              </div>
            ))}
          </div>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">{t('tableCaption')}</caption>
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th scope="col" className="pb-2 text-left font-medium">
                  {t('columns.type')}
                </th>
                <th scope="col" className="w-16 pb-2 text-center font-medium sm:w-24">
                  <span className="inline-flex flex-col items-center gap-0.5 sm:flex-row sm:gap-1.5">
                    <BellIcon className="size-3.5" aria-hidden />
                    {t('columns.inApp')}
                  </span>
                </th>
                <th scope="col" className="w-16 pb-2 text-center font-medium sm:w-24">
                  <span className="inline-flex flex-col items-center gap-0.5 sm:flex-row sm:gap-1.5">
                    <MailIcon className="size-3.5" aria-hidden />
                    {t('columns.email')}
                  </span>
                </th>
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.moduleId}>
                <tr>
                  <th
                    scope="colgroup"
                    colSpan={3}
                    className="border-b pt-5 pb-2 text-left text-xs font-semibold tracking-wide text-foreground/80 uppercase"
                  >
                    {moduleName(g.moduleId)}
                  </th>
                </tr>
                {g.items.map((p) => {
                  const label = typeLabel(p.type);
                  const lockId = `${hintId}-${p.type}`;
                  return (
                    <tr key={p.type} className="border-b last:border-b-0">
                      <th scope="row" className="py-3 pr-3 text-left font-normal">
                        <span className="block font-medium">{label}</span>
                        {p.mandatory && (
                          <span
                            id={lockId}
                            className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground"
                          >
                            <LockIcon className="size-3" aria-hidden />
                            {t('mandatory')}
                          </span>
                        )}
                      </th>
                      <td className="py-3 text-center">
                        <Switch
                          checked={p.inApp}
                          disabled={p.mandatory}
                          onCheckedChange={(v) => toggle(p, 'inApp', v)}
                          aria-label={t('switchLabel', { type: label, channel: t('columns.inApp') })}
                          aria-describedby={p.mandatory ? lockId : undefined}
                        />
                      </td>
                      <td className="py-3 text-center">
                        <Switch
                          checked={emailAvailable && p.email}
                          disabled={!emailAvailable || emailLocked(p)}
                          onCheckedChange={(v) => toggle(p, 'email', v)}
                          aria-label={t('switchLabel', { type: label, channel: t('columns.email') })}
                          aria-describedby={!emailAvailable ? hintId : emailLocked(p) ? lockId : undefined}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        )}
      </CardContent>
    </Card>
  );
}
