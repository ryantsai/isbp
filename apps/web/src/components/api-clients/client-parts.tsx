'use client';

import type { ApiClient, ApiClientSecret, Application } from '@isbp/contracts';
import { usePlatform } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Checkbox } from '@isbp/ui/checkbox';
import { Input } from '@isbp/ui/input';
import { Skeleton } from '@isbp/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import { BanIcon, ClockIcon, KeyRoundIcon, PlusIcon, ShieldCheckIcon, XIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useNow, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { AppTile, CodeBlock, useAppText, useOrigin } from '@/components/applications/app-parts';
import { Segmented } from '@/components/roles/segmented';
import { useApiQuery } from '@/lib/api';

/* ───────────────────────── status ───────────────────────── */

export function ClientStatusBadge({ client }: { client: Pick<ApiClient, 'revokedAt'> }) {
  const t = useTranslations('applications.clients.status');
  return client.revokedAt ? (
    <Badge variant="muted">
      <BanIcon aria-hidden />
      {t('revoked')}
    </Badge>
  ) : (
    <Badge variant="success">
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {t('active')}
    </Badge>
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
  if (state === 'active')
    return (
      <Badge variant="success">
        <span className="size-1.5 rounded-full bg-current" aria-hidden />
        {t('active')}
      </Badge>
    );
  if (state === 'expired')
    return (
      <Badge variant="warning">
        <ClockIcon aria-hidden />
        {t('expired')}
      </Badge>
    );
  return (
    <Badge variant="muted">
      <BanIcon aria-hidden />
      {t('revoked')}
    </Badge>
  );
}

/* ───────────────────────── chips input ───────────────────────── */

/** Free-text list (patterns, CIDRs) as removable chips; Enter or "Add" validates and appends. */
export function ChipsInput({
  id,
  value,
  onChange,
  validate,
  placeholder,
  addLabel,
  removeLabel,
  chipClassName,
  describedBy,
  disabled,
}: {
  id?: string;
  value: string[];
  onChange: (next: string[]) => void;
  /** Returns an error message, or null when the entry is acceptable. */
  validate: (entry: string) => string | null;
  placeholder?: string;
  addLabel: string;
  removeLabel: (entry: string) => string;
  chipClassName?: (entry: string) => string | undefined;
  describedBy?: string;
  disabled?: boolean;
}) {
  const t = useTranslations('applications.clients.form');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const add = () => {
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
    setDraft('');
    setError(null);
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          id={id}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          className="font-mono text-sm"
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={[error ? errorId : null, describedBy].filter(Boolean).join(' ') || undefined}
        />
        <Button type="button" variant="outline" onClick={add} disabled={disabled || !draft.trim()}>
          <PlusIcon /> {addLabel}
        </Button>
      </div>
      {error && (
        <p id={errorId} className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          <AnimatePresence initial={false}>
            {value.map((v) => (
              <motion.li
                key={v}
                layout
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ duration: 0.15 }}
                className={cn(
                  'inline-flex max-w-full items-center gap-1 rounded-md border bg-muted px-1.5 py-0.5 font-mono text-xs',
                  chipClassName?.(v),
                )}
              >
                <span className="truncate">{v}</span>
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => onChange(value.filter((x) => x !== v))}
                    aria-label={removeLabel(v)}
                    className="rounded-sm p-0.5 opacity-70 outline-none hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <XIcon className="size-3" />
                  </button>
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
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
    <div className="grid gap-2" role="group" aria-labelledby={`${id}-label`}>
      <span id={`${id}-label`} className="text-sm font-medium">
        {t('applications')}
      </span>
      <Segmented
        label={t('applications')}
        value={value.allApplications ? 'all' : 'selected'}
        onChange={(v) => onChange({ ...value, allApplications: v === 'all' })}
        disabled={disabled}
        options={[
          { value: 'selected', label: t('selectedApps') },
          { value: 'all', label: t('allApps') },
        ]}
      />
      <AnimatePresence initial={false} mode="wait">
        {value.allApplications ? (
          <motion.p
            key="all"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-xs text-muted-foreground"
          >
            {t('allAppsHint')}
          </motion.p>
        ) : (
          <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {isLoading ? (
              <Skeleton className="h-32 w-full rounded-lg" />
            ) : error && !data ? (
              <p className="flex items-center justify-between gap-2 rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
                {t('appsFailed')}
                <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
                  {t('retry')}
                </Button>
              </p>
            ) : (
              <ul
                className={cn(
                  'max-h-56 divide-y overflow-y-auto rounded-lg border',
                  invalid && 'border-destructive',
                )}
                aria-describedby={invalid ? `${id}-error` : undefined}
              >
                {apps.map((a) => {
                  const checked = value.applicationIds.includes(a.id);
                  const cid = `${id}-${a.id}`;
                  return (
                    <li key={a.id}>
                      <label
                        htmlFor={cid}
                        className="flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/50 has-[button:disabled]:cursor-not-allowed"
                      >
                        <Checkbox
                          id={cid}
                          checked={checked}
                          disabled={disabled}
                          onCheckedChange={(v) =>
                            onChange({
                              ...value,
                              applicationIds: v
                                ? [...value.applicationIds, a.id]
                                : value.applicationIds.filter((x) => x !== a.id),
                            })
                          }
                        />
                        <AppTile app={a} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{appText(a).name}</span>
                          <code className="block truncate font-mono text-xs text-muted-foreground">
                            {a.key}
                          </code>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            {invalid ? (
              <p id={`${id}-error`} className="mt-1.5 text-xs text-destructive">
                {invalid}
              </p>
            ) : (
              <p className="mt-1.5 text-xs text-muted-foreground">{t('selectedHint')}</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
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
    <div className="grid gap-2" role="group" aria-labelledby={`${id}-label`}>
      <span id={`${id}-label`} className="text-sm font-medium">
        {t('secretExpiry')}
      </span>
      <Segmented
        label={t('secretExpiry')}
        value={choice}
        onChange={onChoice}
        options={SECRET_EXPIRY.map((e) => ({ value: e, label: t(`expiry.${e}`) }))}
        className="[&>button]:px-2"
      />
      {choice === 'custom' && (
        <div className="flex items-center gap-2">
          <label htmlFor={`${id}-days`} className="sr-only">
            {t('customDays')}
          </label>
          <Input
            id={`${id}-days`}
            inputMode="numeric"
            value={custom}
            onChange={(e) => onCustom(e.target.value.replace(/[^\d]/g, ''))}
            className="w-28 tabular-nums"
            placeholder="60"
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? `${id}-error` : undefined}
          />
          <span className="text-sm text-muted-foreground">{t('daysUnit')}</span>
        </div>
      )}
      {invalid ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {t('daysInvalid')}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {choice === 'never' ? t('neverHint') : t('expiryHint')}
        </p>
      )}
    </div>
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
    <Tabs defaultValue="key">
      <TabsList className="w-full">
        <TabsTrigger value="key" className="flex-1">
          <KeyRoundIcon /> {t('apiKey')}
        </TabsTrigger>
        <TabsTrigger value="oauth" className="flex-1">
          <ShieldCheckIcon /> {t('oauth')}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="key" className="space-y-2">
        <p className="text-xs text-muted-foreground">
          {queriesApps ? t('apiKeyHint', { user: user.username }) : t('apiKeyHintNoApps')}
        </p>
        <CodeBlock code={roleQuery} copyLabel={t('copyApiKey')} />
      </TabsContent>
      <TabsContent value="oauth" className="space-y-2">
        <p className="text-xs text-muted-foreground">{t('oauthHint')}</p>
        <CodeBlock code={token} copyLabel={t('copyOauth')} />
      </TabsContent>
    </Tabs>
  );
}
