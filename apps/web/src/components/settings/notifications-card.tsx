'use client';

import type { NotificationPreference, NotificationPreferences } from '@isbp/contracts';
import { useApi } from '@isbp/sdk/web';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { Disclosure } from '@isbp/ui/motion';
import { Skeleton } from '@isbp/ui/skeleton';
import { toast } from '@isbp/ui/toast';
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query';
import { BellIcon, CheckIcon, LockIcon, MailIcon, RotateCcwIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTypeLabel } from '@/components/notifications/notification-meta';
import { useApiQuery, useErrorText } from '@/lib/api';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Switch } from '@astryxdesign/core/Switch';
import { pixel, Table } from '@astryxdesign/core/Table';

const PATH = '/me/notification-preferences';
const KEY = [PATH, {}];
const MUTATION_KEY = ['notification-preferences'];

type Change = { type: string; inApp: boolean; email: boolean };
type Category = 'approvals' | 'requests' | 'assigned' | 'announcements' | 'security' | 'other';

/** Email is forced on for a mandatory type whose default includes email (mirrors the API). */
const emailLocked = (p: NotificationPreference) => p.mandatory && p.defaults.email;

/**
 * The six plain areas a person thinks in. A type's area comes from what it is about (its name), so the settings read
 * "Approvals", "My requests", "Assigned to me" rather than one heading per module.
 */
export function categoryOf(type: string): Category {
  const s = type.toLowerCase();
  if (/approv|sign-?off|delegat/.test(s)) return 'approvals';
  if (/assign|todo|to-do|task|stocktake|review|remind|reminder/.test(s)) return 'assigned';
  if (/announc|news|bulletin/.test(s)) return 'announcements';
  if (/security|password|mfa|breach|sign-?in|login|credential/.test(s)) return 'security';
  if (/request|access-request|form-submission|submission/.test(s)) return 'requests';
  return 'other';
}

const CATEGORY_ORDER: Category[] = [
  'approvals',
  'requests',
  'assigned',
  'announcements',
  'security',
  'other',
];

/**
 * Per-type, per-channel notification switches, grouped by area. Each toggle saves at once (optimistic; rolled back with a
 * toast if the API refuses). Mandatory types keep in-app on. A person sees the types that are relevant to them (set,
 * mandatory, or delivered before); the rest sit behind "Show all".
 */
export function NotificationsCard() {
  const t = useTranslations('settings.notifications');
  const typeLabel = useTypeLabel();
  const errorText = useErrorText();
  const api = useApi();
  const client = useQueryClient();
  const hintId = useId();
  const { data, isLoading } = useApiQuery<NotificationPreferences>(PATH);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);

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
  const shown = useMemo(
    () => (data?.items ?? []).filter((p) => showAll || p.relevant || p.mandatory),
    [data, showAll],
  );
  const groups = useMemo(
    () =>
      CATEGORY_ORDER.map((category) => ({
        category,
        items: shown.filter((p) => categoryOf(p.type) === category),
      })).filter((g) => g.items.length > 0),
    [shown],
  );

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

  /** "All on" / "All off" for one area: the in-app channel of every type in it (email too, when it is set up). */
  const setAll = (items: NotificationPreference[], on: boolean) =>
    save.mutate(
      items.map((p) => ({
        type: p.type,
        inApp: p.mandatory ? true : on,
        email: emailAvailable && !emailLocked(p) ? on : p.email,
      })),
    );

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
          <Button
            label={t('reset')}
            variant="secondary"
            size="sm"
            icon={<Icon icon={RotateCcwIcon} />}
            onClick={reset}
            isDisabled={!data || atDefaults || saving}
          />
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
                  <Spinner size="sm" /> {t('saving')}
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
          <Banner status="info" title={t('emailUnavailable')} collapsible={false} />
        )}

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('none')}</p>
        ) : (
          groups.map(({ category, items }) => {
            const on = items.filter((p) => p.inApp).length;
            const columns = [
              {
                key: 'type',
                header: t('columns.type'),
                renderCell: (p: NotificationPreference) => {
                  const label = typeLabel(p.type);
                  return (
                    <span className="block min-w-0">
                      <span className="block font-medium [overflow-wrap:anywhere]">{label}</span>
                      {p.mandatory && (
                        <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <LockIcon className="size-3" aria-hidden />
                          {t('mandatory')}
                        </span>
                      )}
                    </span>
                  );
                },
              },
              {
                key: 'inApp',
                header: (
                  <span className="inline-flex items-center gap-1.5">
                    <BellIcon className="size-3.5" aria-hidden />
                    {t('columns.inApp')}
                  </span>
                ),
                align: 'center' as const,
                width: pixel(96),
                renderCell: (p: NotificationPreference) => (
                  <Switch
                    label={t('switchLabel', { type: typeLabel(p.type), channel: t('columns.inApp') })}
                    isLabelHidden
                    value={p.inApp}
                    isDisabled={p.mandatory}
                    disabledMessage={p.mandatory ? t('mandatory') : undefined}
                    onChange={(v) => toggle(p, 'inApp', v)}
                  />
                ),
              },
              ...(emailAvailable
                ? [
                    {
                      key: 'email',
                      header: (
                        <span className="inline-flex items-center gap-1.5">
                          <MailIcon className="size-3.5" aria-hidden />
                          {t('columns.email')}
                        </span>
                      ),
                      align: 'center' as const,
                      width: pixel(96),
                      renderCell: (p: NotificationPreference) => (
                        <Switch
                          label={t('switchLabel', { type: typeLabel(p.type), channel: t('columns.email') })}
                          isLabelHidden
                          value={p.email}
                          isDisabled={emailLocked(p)}
                          disabledMessage={emailLocked(p) ? t('mandatory') : undefined}
                          onChange={(v) => toggle(p, 'email', v)}
                        />
                      ),
                    },
                  ]
                : []),
            ];
            return (
              <section key={category} aria-labelledby={`${hintId}-${category}`} className="rounded-xl border">
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <h3 id={`${hintId}-${category}`} className="text-sm font-semibold">
                      {t(`categories.${category}`)}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {t('onCount', { on, total: items.length })}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      label={t('allOn')}
                      variant="secondary"
                      size="sm"
                      isDisabled={saving || items.every((p) => p.inApp || p.mandatory)}
                      onClick={() => setAll(items, true)}
                    />
                    <Button
                      label={t('allOff')}
                      variant="secondary"
                      size="sm"
                      isDisabled={saving || items.every((p) => !p.inApp || p.mandatory)}
                      onClick={() => setAll(items, false)}
                    />
                  </div>
                </div>
                <Disclosure
                  summary={t('customise')}
                  className="border-t"
                  triggerClassName="w-full justify-between px-4 py-2.5 text-sm text-muted-foreground"
                  contentClassName="px-4 pb-2"
                >
                  <Table
                    aria-label={t(`categories.${category}`)}
                    density="compact"
                    data={items}
                    idKey="type"
                    columns={columns}
                  />
                </Disclosure>
              </section>
            );
          })
        )}

        {data && !isLoading && (data.items.some((p) => !p.relevant && !p.mandatory) || showAll) && (
          <div className="flex justify-center">
            <Button
              label={showAll ? t('showFewer') : t('showAll', { count: data.items.length })}
              variant="ghost"
              size="sm"
              onClick={() => setShowAll((v) => !v)}
              aria-expanded={showAll}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
