'use client';

import { CodeEditor } from '@isbp/ui/code-editor';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { HTTP_METHODS } from '../../contracts';
import { type EditorProps, FormRow, NumberInput, type Pair, PairsEditor, SecretInput } from './fields';

export const HTTP_DEFAULTS = {
  method: 'GET',
  url: '',
  headers: [],
  bodyType: 'none',
  body: '',
  auth: { type: 'none' },
  expectedStatus: '200-299',
  timeoutSeconds: 30,
};

type Auth = {
  type: 'none' | 'basic' | 'bearer' | 'header';
  username?: string;
  password?: unknown;
  token?: unknown;
  name?: string;
  value?: unknown;
};

/** HTTP request: method, URL, headers, auth, body, expected status and timeout. */
export function HttpEditor({ value, onChange, errors, disabled }: EditorProps) {
  const t = useTranslations('scheduler.http');
  const id = useId();
  const c = { ...HTTP_DEFAULTS, ...value } as typeof HTTP_DEFAULTS & { headers: Pair[]; auth: Auth };
  const set = (patch: Record<string, unknown>) => onChange({ ...c, ...patch });
  const auth = c.auth;
  const setAuth = (patch: Partial<Auth>) => set({ auth: { ...auth, ...patch } });
  const hasBody = c.method !== 'GET' && c.method !== 'HEAD';

  return (
    <div className="grid min-w-0 gap-5">
      <div className="grid min-w-0 gap-2">
        <Label htmlFor={`${id}-url`} className={errors.url ? 'text-destructive' : undefined}>
          {t('request')}
        </Label>
        <div className="grid min-w-0 grid-cols-[7rem_minmax(0,1fr)] gap-2">
          <Select value={c.method} onValueChange={(v) => set({ method: v })} disabled={disabled}>
            <SelectTrigger aria-label={t('method')} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HTTP_METHODS.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            id={`${id}-url`}
            value={c.url}
            onChange={(e) => set({ url: e.target.value })}
            placeholder="https://"
            inputMode="url"
            className="min-w-0 font-mono text-xs"
            aria-invalid={Boolean(errors.url) || undefined}
            aria-describedby={`${id}-url-hint${errors.url ? ` ${id}-url-error` : ''}`}
            disabled={disabled}
          />
        </div>
        <p id={`${id}-url-hint`} className="text-xs text-muted-foreground">
          {t('urlHint')}
        </p>
        {errors.url && (
          <p id={`${id}-url-error`} className="text-xs font-medium text-destructive">
            {errors.url}
          </p>
        )}
      </div>

      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <FormRow label={t('expectedStatus')} hint={t('expectedStatusHint')} error={errors.expectedStatus}>
          {({ id: fid, describedBy, invalid }) => (
            <Input
              id={fid}
              value={c.expectedStatus}
              onChange={(e) => set({ expectedStatus: e.target.value })}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              className="font-mono text-xs"
              disabled={disabled}
            />
          )}
        </FormRow>
        <FormRow label={t('timeout')} hint={t('timeoutHint')} error={errors.timeoutSeconds}>
          {({ id: fid, describedBy, invalid }) => (
            <NumberInput
              id={fid}
              value={String(c.timeoutSeconds ?? '')}
              onChange={(v) => set({ timeoutSeconds: v === '' ? '' : Number(v) })}
              min={1}
              max={300}
              describedBy={describedBy}
              invalid={invalid}
              disabled={disabled}
            />
          )}
        </FormRow>
      </div>

      <div className="grid min-w-0 gap-2">
        <p className="text-sm font-medium">{t('headers')}</p>
        <PairsEditor
          items={c.headers}
          onChange={(headers) => set({ headers })}
          errors={errors}
          prefix="headers"
          disabled={disabled}
          labels={{
            name: t('headerName'),
            value: t('headerValue'),
            add: t('addHeader'),
            empty: t('noHeaders'),
            remove: t('removeHeader'),
          }}
        />
      </div>

      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <FormRow label={t('auth')} error={errors.auth}>
          {({ id: fid }) => (
            <Select
              value={auth.type}
              onValueChange={(v) =>
                set({
                  auth:
                    v === 'basic'
                      ? { type: 'basic', username: '', password: '' }
                      : v === 'bearer'
                        ? { type: 'bearer', token: '' }
                        : v === 'header'
                          ? { type: 'header', name: 'X-Api-Key', value: '' }
                          : { type: 'none' },
                })
              }
              disabled={disabled}
            >
              <SelectTrigger id={fid} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['none', 'basic', 'bearer', 'header'] as const).map((a) => (
                  <SelectItem key={a} value={a}>
                    {t(`authType.${a}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormRow>
        {auth.type === 'basic' && (
          <>
            <FormRow label={t('username')} error={errors['auth.username']}>
              {({ id: fid, invalid }) => (
                <Input
                  id={fid}
                  value={auth.username ?? ''}
                  autoComplete="off"
                  onChange={(e) => setAuth({ username: e.target.value })}
                  aria-invalid={invalid || undefined}
                  disabled={disabled}
                />
              )}
            </FormRow>
            <FormRow label={t('password')} error={errors['auth.password']}>
              {({ id: fid, describedBy, invalid }) => (
                <SecretInput
                  id={fid}
                  value={auth.password}
                  onChange={(v) => setAuth({ password: v })}
                  describedBy={describedBy}
                  invalid={invalid}
                  disabled={disabled}
                />
              )}
            </FormRow>
          </>
        )}
        {auth.type === 'bearer' && (
          <FormRow label={t('token')} error={errors['auth.token']}>
            {({ id: fid, describedBy, invalid }) => (
              <SecretInput
                id={fid}
                value={auth.token}
                onChange={(v) => setAuth({ token: v })}
                describedBy={describedBy}
                invalid={invalid}
                disabled={disabled}
              />
            )}
          </FormRow>
        )}
        {auth.type === 'header' && (
          <>
            <FormRow label={t('headerName')} error={errors['auth.name']}>
              {({ id: fid, invalid }) => (
                <Input
                  id={fid}
                  value={auth.name ?? ''}
                  onChange={(e) => setAuth({ name: e.target.value })}
                  aria-invalid={invalid || undefined}
                  className="font-mono text-xs"
                  disabled={disabled}
                />
              )}
            </FormRow>
            <FormRow label={t('headerValue')} error={errors['auth.value']}>
              {({ id: fid, describedBy, invalid }) => (
                <SecretInput
                  id={fid}
                  value={auth.value}
                  onChange={(v) => setAuth({ value: v })}
                  describedBy={describedBy}
                  invalid={invalid}
                  disabled={disabled}
                />
              )}
            </FormRow>
          </>
        )}
      </div>

      {hasBody && (
        <div className="grid min-w-0 gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p id={`${id}-body`} className="text-sm font-medium">
              {t('body')}
            </p>
            <Select value={c.bodyType} onValueChange={(v) => set({ bodyType: v })} disabled={disabled}>
              <SelectTrigger aria-label={t('bodyType')} className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['none', 'json', 'text'] as const).map((b) => (
                  <SelectItem key={b} value={b}>
                    {t(`bodyTypes.${b}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {c.bodyType !== 'none' && (
            <CodeEditor
              aria-labelledby={`${id}-body`}
              aria-invalid={Boolean(errors.body)}
              value={c.body}
              onChange={(body) => set({ body })}
              language={c.bodyType === 'json' ? 'json' : 'text'}
              readOnly={disabled}
              minHeight="6rem"
            />
          )}
          {errors.body && <p className="text-xs font-medium text-destructive">{errors.body}</p>}
        </div>
      )}
    </div>
  );
}
