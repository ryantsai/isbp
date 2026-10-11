'use client';

import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Field } from '@astryxdesign/core/Field';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Token } from '@astryxdesign/core/Token';
import { Tokenizer } from '@astryxdesign/core/Tokenizer';
import { createStaticSource, type SearchableItem } from '@astryxdesign/core/Typeahead';
import { Button } from '@astryxdesign/core/Button';
import type { ApiClient, ApiClientSecret, Application } from '@isbp/contracts';
import { usePlatform } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Skeleton } from '@isbp/ui/skeleton';
import { StatusBadge } from '@isbp/ui/status';
import { BanIcon, CircleCheckIcon, ClockIcon, KeyRoundIcon, ShieldCheckIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useNow, useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { AppTile, CodeBlock, useAppText, useOrigin } from '@/components/applications/app-parts';
import { useApiQuery } from '@/lib/api';

/* ───────────────────────── status ───────────────────────── */

export function ClientStatusBadge({ client }: { client: Pick<ApiClient, 'revokedAt'> }) {
  const t = useTranslations('applications.clients.status');
  return client.revokedAt ? (
    <StatusBadge tone="muted" icon={BanIcon} label={t('revoked')} />
  ) : (
    <StatusBadge tone="success" icon={CircleCheckIcon} label={t('active')} />
  );
}

export type SecretState = 'active' | 'expired' | 'revoked';

export function secretState(s: ApiClientSecret, now: number): SecretState {
  if (s.revokedAt) return 'revoked';
  if (s.expiresAt && new Date(s.expiresAt).getTime() <= now) return 'expired';
  return s.active ? 'active' : 'revoked';
}

export function SecretStatusBadge({ secret }: { secret: ApiClientSecret }) {
  const t = useTranslations('applications.clients.status');
  const now = useNow({ updateInterval: 60_000 });
  const state = secretState(secret, now.getTime());
  if (state === 'active') return <StatusBadge tone="success" icon={CircleCheckIcon} label={t('active')} />;
  if (state === 'expired') return <StatusBadge tone="warning" icon={ClockIcon} label={t('expired')} />;
  return <StatusBadge tone="muted" icon={BanIcon} label={t('revoked')} />;
}

/* ───────────────────────── chips input ───────────────────────── */

/** A list that only ever grows by what the person types: there is nothing to suggest. */
const NO_SUGGESTIONS = createStaticSource<SearchableItem>([]);

/**
 * Free-text list (patterns, CIDRs) as removable chips: type an entry, then pick "Create" (or press Enter). Entries
 * are validated before they join the list; several separated by spaces or commas are added together.
 */
export function ChipsInput({
  label,
  description,
  value,
  onChange,
  validate,
  placeholder,
  chipColor,
  invalid,
  isDisabled,
}: {
  label: string;
  description?: string;
  value: string[];
  onChange: (next: string[]) => void;
  /** Returns an error message, or null when the entry is acceptable. */
  validate: (entry: string) => string | null;
  placeholder?: string;
  /** Colours a chip (e.g. red for an entry the person may not grant). */
  chipColor?: (entry: string) => 'red' | undefined;
  /** A problem with the list as a whole (shown unless the last entry typed was itself rejected). */
  invalid?: string | null;
  isDisabled?: boolean;
}) {
  const t = useTranslations('applications.clients.form');
  const [error, setError] = useState<string | null>(null);
  const items = useMemo<SearchableItem[]>(() => value.map((v) => ({ id: v, label: v })), [value]);
  const add = (draft: string) => {
    const entries = draft
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!entries.length) return;
    for (const e of entries) {
      if (value.includes(e)) return setError(t('duplicate', { value: e }));
      const problem = validate(e);
      if (problem) return setError(problem);
    }
    onChange([...value, ...entries]);
    setError(null);
  };
  return (
    <Tokenizer
      label={label}
      description={description}
      placeholder={placeholder}
      searchSource={NO_SUGGESTIONS}
      value={items}
      hasCreate
      debounceMs={0}
      isDisabled={isDisabled}
      status={error || invalid ? { type: 'error', message: error ?? invalid ?? undefined } : undefined}
      onChangeQuery={() => error && setError(null)}
      onChange={(next, change) => {
        if (change.type === 'create') return add(change.item.label);
        setError(null);
        onChange(next.map((item) => item.id));
      }}
      renderToken={(item, onRemove) => (
        <Token label={item.label} color={chipColor?.(item.id) ?? 'default'} onRemove={onRemove} />
      )}
    />
  );
}

/* ───────────────────────── application reach ───────────────────────── */

export interface Reach {
  allApplications: boolean;
  applicationIds: string[];
}

/** "All applications" or a checklist of the applications this client may query. */
export function ApplicationReachField({
  value,
  onChange,
  invalid,
  disabled,
}: {
  value: Reach;
  onChange: (next: Reach) => void;
  invalid?: string | null;
  disabled?: boolean;
}) {
  const t = useTranslations('applications.clients.form');
  const appText = useAppText();
  const id = useId();
  const { data, isLoading, error, refetch } = useApiQuery<{ items: Application[] }>('/applications');
  const apps = data?.items ?? [];
  return (
    <Field
      label={t('applications')}
      isGroupLabel
      inputID={`${id}-reach`}
      description={value.allApplications ? t('allAppsHint') : t('selectedHint')}
      status={invalid ? { type: 'error', message: invalid } : undefined}
      statusVariant="detached"
      isDisabled={disabled}
    >
      <VStack gap={2} id={`${id}-reach`}>
        <SegmentedControl
          label={t('applications')}
          value={value.allApplications ? 'all' : 'selected'}
          onChange={(v) => onChange({ ...value, allApplications: v === 'all' })}
          isDisabled={disabled}
        >
          <SegmentedControlItem value="selected" label={t('selectedApps')} />
          <SegmentedControlItem value="all" label={t('allApps')} />
        </SegmentedControl>
        <AnimatePresence initial={false} mode="wait">
          {!value.allApplications && (
            <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {isLoading ? (
                <Skeleton className="h-32 w-full rounded-lg" />
              ) : error && !data ? (
                <HStack gap={2} hAlign="between" vAlign="center">
                  <Text color="secondary">{t('appsFailed')}</Text>
                  <Button
                    label={t('retry')}
                    variant="secondary"
                    size="sm"
                    type="button"
                    onClick={() => void refetch()}
                  />
                </HStack>
              ) : (
                <ul
                  className={cn(
                    'max-h-56 divide-y overflow-y-auto rounded-lg border',
                    invalid && 'border-destructive',
                  )}
                >
                  {apps.map((a) => {
                    const checked = value.applicationIds.includes(a.id);
                    return (
                      <li key={a.id} className="flex items-center gap-3 px-3 py-2">
                        <AppTile app={a} size="sm" />
                        <div className="min-w-0 flex-1">
                          <CheckboxInput
                            label={appText(a).name}
                            description={a.key}
                            value={checked}
                            isDisabled={disabled}
                            onChange={(next) =>
                              onChange({
                                ...value,
                                applicationIds: next
                                  ? [...value.applicationIds, a.id]
                                  : value.applicationIds.filter((x) => x !== a.id),
                              })
                            }
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </VStack>
    </Field>
  );
}

/* ───────────────────────── expiry ───────────────────────── */

export const SECRET_EXPIRY = ['90', '180', '365', 'never', 'custom'] as const;
export type SecretExpiry = (typeof SECRET_EXPIRY)[number];

export function expiryDays(choice: SecretExpiry, custom: string): number | null {
  if (choice === 'never') return null;
  if (choice === 'custom') return Number(custom);
  return Number(choice);
}

export function isExpiryValid(choice: SecretExpiry, custom: string) {
  if (choice !== 'custom') return true;
  const n = Number(custom);
  return /^\d+$/.test(custom.trim()) && n >= 1 && n <= 730;
}

/** Secret lifetime: presets, "never" or a custom number of days (1–730). */
export function SecretExpiryField({
  choice,
  custom,
  onChoice,
  onCustom,
  showError,
}: {
  choice: SecretExpiry;
  custom: string;
  onChoice: (c: SecretExpiry) => void;
  onCustom: (v: string) => void;
  showError?: boolean;
}) {
  const t = useTranslations('applications.clients.form');
  const id = useId();
  const invalid = showError && !isExpiryValid(choice, custom);
  return (
    <Field
      label={t('secretExpiry')}
      isGroupLabel
      inputID={`${id}-expiry`}
      description={choice === 'never' ? t('neverHint') : t('expiryHint')}
      status={invalid ? { type: 'error', message: t('daysInvalid') } : undefined}
      statusVariant="detached"
    >
      <VStack gap={2} id={`${id}-expiry`}>
        <SegmentedControl
          label={t('secretExpiry')}
          value={choice}
          onChange={(v) => onChoice(v as SecretExpiry)}
        >
          {SECRET_EXPIRY.map((e) => (
            <SegmentedControlItem key={e} value={e} label={t(`expiry.${e}`)} />
          ))}
        </SegmentedControl>
        {choice === 'custom' && (
          <HStack gap={2} vAlign="center">
            <TextInput
              label={t('customDays')}
              isLabelHidden
              value={custom}
              onChange={(v) => onCustom(v.replace(/[^\d]/g, ''))}
              placeholder="60"
              width={112}
              status={invalid ? { type: 'error' } : undefined}
            />
            <Text color="secondary">{t('daysUnit')}</Text>
          </HStack>
        )}
      </VStack>
    </Field>
  );
}

/* ───────────────────────── examples ───────────────────────── */

/**
 * Copy-ready calls for a client: Role Query with the API key, and the OAuth client-credentials token
 * request. `secret` is the real secret right after creation, otherwise a placeholder.
 */
export function ClientExamples({ client, secret }: { client: ApiClient; secret?: string }) {
  const t = useTranslations('applications.clients.examples');
  const { user } = usePlatform();
  const panelId = useId();
  const [tab, setTab] = useState<'key' | 'oauth'>('key');
  const origin = useOrigin() || 'https://isbp.example.com';
  const base = `${origin}/api/v1`;
  const key = secret ?? '<API key>';
  const secretValue = secret ?? '<client secret>';
  const app = client.allApplications ? null : client.applications[0];
  const appKey = app?.key ?? '<application>';
  const queriesApps = client.allApplications || client.applications.length > 0;
  const scope = queriesApps ? 'role-query' : 'api';
  const roleQuery = `curl -H "Authorization: Bearer ${key}" \\\n  "${base}/role-query/users/${encodeURIComponent(user.username)}?application=${appKey}"`;
  const token = `curl -u "${client.clientId}:${secretValue}" \\\n  -d grant_type=client_credentials -d scope=${scope} \\\n  ${base}/oauth/token`;
  return (
    <VStack gap={3}>
      <TabList role="tablist" value={tab} onChange={(v) => setTab(v as 'key' | 'oauth')} hasDivider>
        <Tab value="key" label={t('apiKey')} icon={<Icon icon={KeyRoundIcon} />} panelId={panelId} />
        <Tab value="oauth" label={t('oauth')} icon={<Icon icon={ShieldCheckIcon} />} panelId={panelId} />
      </TabList>
      <div
        role="tabpanel"
        id={panelId}
        aria-label={t(tab === 'key' ? 'apiKey' : 'oauth')}
        className="min-w-0"
      >
        <VStack gap={2}>
          {tab === 'key' ? (
            <>
              <Text type="supporting" color="secondary">
                {queriesApps ? t('apiKeyHint', { user: user.username }) : t('apiKeyHintNoApps')}
              </Text>
              <CodeBlock code={roleQuery} copyLabel={t('copyApiKey')} />
            </>
          ) : (
            <>
              <Text type="supporting" color="secondary">
                {t('oauthHint')}
              </Text>
              <CodeBlock code={token} copyLabel={t('copyOauth')} />
            </>
          )}
        </VStack>
      </div>
    </VStack>
  );
}
