'use client';

import type { ConnectorConfigSlotProps } from '@isbp/contracts';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId } from 'react';
import { API_VERSIONS, type ApiVersion, collectionUrlIssue, DEFAULT_API_VERSION } from '../../contracts';

/** Header the hub reads the webhook secret from (a technical name, not translated). */
const SECRET_HEADER = 'X-ISBP-Webhook-Secret';
const URL_EXAMPLE = 'https://ado.contoso.local/tfs/DefaultCollection';
const SERVICE_HOOK_EVENTS = [
  'workitem.created',
  'workitem.updated',
  'workitem.deleted',
  'workitem.restored',
  'workitem.commented',
  'git.push',
  'git.pullrequest.created',
  'git.pullrequest.updated',
  'git.pullrequest.merged',
] as const;

const hookKey = (event: (typeof SERVICE_HOOK_EVENTS)[number]) => event.replace(/\./g, '_');

/**
 * Settings of an on-premises Azure DevOps Server connection in the Integrations Hub
 * (`integrations.connector-config.azdo.server`): collection URL, REST API version and the personal access
 * token, with the server requirements and how to create the token and the service hooks.
 */
export default function AzdoServerConfig({
  config,
  onConfigChange,
  secrets,
  onSecretsChange,
  storedSecrets,
  errors,
  disabled,
}: ConnectorConfigSlotProps) {
  const t = useTranslations('azdo.config');
  const id = useId();
  const url = typeof config.collectionUrl === 'string' ? config.collectionUrl : '';
  const version = API_VERSIONS.includes(config.apiVersion as ApiVersion)
    ? (config.apiVersion as ApiVersion)
    : DEFAULT_API_VERSION;
  const patStored = storedSecrets.includes('pat');

  // The server's messages are English; say it in the viewer's language from the same check.
  const urlIssue = url.trim() ? (collectionUrlIssue(url.trim()) ?? 'invalid') : 'required';
  const urlError = errors?.['config.collectionUrl'] ? t(`errors.${urlIssue}`) : null;
  const versionError = errors?.['config.apiVersion'] ? t('errors.version') : null;
  const patError = errors?.['secrets.pat'] ? t('errors.pat') : null;

  const field = (
    key: string,
    label: ReactNode,
    control: (p: { id: string; 'aria-describedby': string; 'aria-invalid'?: true }) => ReactNode,
    hint: ReactNode,
    error: string | null,
  ) => (
    <div className="grid min-w-0 gap-1.5">
      <Label htmlFor={`${id}-${key}`}>{label}</Label>
      {control({
        id: `${id}-${key}`,
        'aria-describedby': `${id}-${key}-hint`,
        ...(error ? { 'aria-invalid': true as const } : {}),
      })}
      <p
        id={`${id}-${key}-hint`}
        className={error ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}
      >
        {error ?? hint}
      </p>
    </div>
  );

  return (
    <div className="grid min-w-0 gap-4">
      <fieldset className="grid min-w-0 gap-4" disabled={disabled}>
        <legend className="mb-3 text-sm font-semibold">{t('server')}</legend>
        {field(
          'url',
          t('collectionUrl'),
          (p) => (
            <Input
              {...p}
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              placeholder={URL_EXAMPLE}
              value={url}
              maxLength={500}
              onChange={(e) => onConfigChange({ ...config, collectionUrl: e.target.value })}
            />
          ),
          t('collectionUrlHint'),
          urlError,
        )}
        {field(
          'version',
          t('apiVersion'),
          (p) => (
            <Select
              value={version}
              onValueChange={(v) => onConfigChange({ ...config, apiVersion: v })}
              disabled={disabled}
            >
              <SelectTrigger {...p} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {API_VERSIONS.map((v) => (
                  <SelectItem key={v} value={v}>
                    {t(`versions.${v.replace('.', '_')}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ),
          t('apiVersionHint'),
          versionError,
        )}
      </fieldset>

      <fieldset className="grid min-w-0 gap-4" disabled={disabled}>
        <legend className="mb-3 text-sm font-semibold">{t('signIn')}</legend>
        {field(
          'pat',
          t('pat'),
          (p) => (
            <Input
              {...p}
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              value={secrets.pat ?? ''}
              placeholder={patStored ? t('patStoredPlaceholder') : undefined}
              onChange={(e) => {
                const next = { ...secrets };
                if (e.target.value) next.pat = e.target.value;
                else delete next.pat;
                onSecretsChange(next);
              }}
            />
          ),
          patStored ? t('patStored') : t('patHint'),
          patError,
        )}
      </fieldset>

      <details className="group rounded-lg border px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium outline-none focus-visible:underline">
          {t('help.reqTitle')}
        </summary>
        <ul className="mt-3 list-disc space-y-1.5 ps-5 text-muted-foreground">
          <li>{t('help.reqVersion')}</li>
          <li>{t('help.reqPat')}</li>
          <li>{t('help.reqHttps')}</li>
          <li>{t('help.reqTls')}</li>
          <li>{t('help.reqNetwork')}</li>
        </ul>
      </details>

      <details className="group rounded-lg border px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium outline-none focus-visible:underline">
          {t('help.patTitle')}
        </summary>
        <ol className="mt-3 list-decimal space-y-1.5 ps-5 text-muted-foreground">
          <li>{t('help.patStep1')}</li>
          <li>{t('help.patStep2')}</li>
          <li>
            {t('help.patStep3')}
            <ul className="mt-1 list-disc space-y-0.5 ps-5">
              <li>{t('help.scopeWorkItems')}</li>
              <li>{t('help.scopeCode')}</li>
              <li>{t('help.scopeProject')}</li>
            </ul>
          </li>
          <li>{t('help.patStep4')}</li>
        </ol>
      </details>

      <details className="group rounded-lg border px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium outline-none focus-visible:underline">
          {t('help.hooksTitle')}
        </summary>
        <div className="mt-3 space-y-2 text-muted-foreground">
          <p>{t('help.hooksIntro')}</p>
          <ol className="list-decimal space-y-1.5 ps-5">
            <li>{t('help.hooksStep1')}</li>
            <li>
              {t('help.hooksStep2')}
              <ul className="mt-1 list-disc space-y-0.5 ps-5">
                {SERVICE_HOOK_EVENTS.map((e) => (
                  <li key={e}>
                    {t(`help.events.${hookKey(e)}`)} <code className="font-mono text-xs">{e}</code>
                  </li>
                ))}
              </ul>
            </li>
            <li>{t('help.hooksStep3')}</li>
            <li>
              {t('help.hooksStep4')}{' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs break-all text-foreground">
                {`${SECRET_HEADER}: ${t('help.secretPlaceholder')}`}
              </code>
            </li>
            <li>{t('help.hooksStep5')}</li>
          </ol>
          <p>{t('help.hooksNote')}</p>
          <p>{t('help.hooksNetwork')}</p>
        </div>
      </details>
    </div>
  );
}
