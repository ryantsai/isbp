'use client';

import { FieldStatus } from '@astryxdesign/core/FieldStatus';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { CodeEditor } from '@isbp/ui/code-editor';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { HTTP_METHODS } from '../../contracts';
import { type EditorProps, errorStatus, type Pair, PairsEditor, SecretInput } from './fields';

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
    <VStack gap={5}>
      <HStack gap={2} vAlign="end">
        <Selector
          label={t('method')}
          isLabelHidden
          width={112}
          value={c.method}
          onChange={(v) => set({ method: v })}
          options={HTTP_METHODS.map((m) => ({ value: m, label: m }))}
          isDisabled={disabled}
        />
        <StackItem size="fill">
          <TextInput
            label={t('request')}
            description={t('urlHint')}
            placeholder="https://"
            autoComplete="off"
            value={c.url}
            onChange={(v) => set({ url: v })}
            status={errorStatus(errors.url)}
            isDisabled={disabled}
          />
        </StackItem>
      </HStack>

      <Grid columns={{ minWidth: 240, repeat: 'fit' }} gap={4} align="end">
        <TextInput
          label={t('expectedStatus')}
          description={t('expectedStatusHint')}
          value={c.expectedStatus}
          onChange={(v) => set({ expectedStatus: v })}
          status={errorStatus(errors.expectedStatus)}
          isDisabled={disabled}
        />
        <NumberInput
          label={t('timeout')}
          description={t('timeoutHint')}
          width="100%"
          min={1}
          max={300}
          value={typeof c.timeoutSeconds === 'number' ? c.timeoutSeconds : null}
          onChange={(v) => set({ timeoutSeconds: v })}
          status={errorStatus(errors.timeoutSeconds)}
          isDisabled={disabled}
        />
      </Grid>

      <VStack gap={2}>
        <Text weight="medium">{t('headers')}</Text>
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
      </VStack>

      <Grid columns={{ minWidth: 240, repeat: 'fit' }} gap={4} align="end">
        <Selector
          label={t('auth')}
          width="100%"
          value={auth.type}
          onChange={(v) =>
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
          options={(['none', 'basic', 'bearer', 'header'] as const).map((a) => ({
            value: a,
            label: t(`authType.${a}`),
          }))}
          status={errorStatus(errors.auth)}
          isDisabled={disabled}
        />
        {auth.type === 'basic' && (
          <>
            <TextInput
              label={t('username')}
              autoComplete="off"
              value={auth.username ?? ''}
              onChange={(v) => setAuth({ username: v })}
              status={errorStatus(errors['auth.username'])}
              isDisabled={disabled}
            />
            <SecretInput
              label={t('password')}
              value={auth.password}
              onChange={(v) => setAuth({ password: v })}
              status={errorStatus(errors['auth.password'])}
              isDisabled={disabled}
            />
          </>
        )}
        {auth.type === 'bearer' && (
          <SecretInput
            label={t('token')}
            value={auth.token}
            onChange={(v) => setAuth({ token: v })}
            status={errorStatus(errors['auth.token'])}
            isDisabled={disabled}
          />
        )}
        {auth.type === 'header' && (
          <>
            <TextInput
              label={t('headerName')}
              value={auth.name ?? ''}
              onChange={(v) => setAuth({ name: v })}
              status={errorStatus(errors['auth.name'])}
              isDisabled={disabled}
            />
            <SecretInput
              label={t('headerValue')}
              value={auth.value}
              onChange={(v) => setAuth({ value: v })}
              status={errorStatus(errors['auth.value'])}
              isDisabled={disabled}
            />
          </>
        )}
      </Grid>

      {hasBody && (
        <VStack gap={2}>
          <HStack gap={2} hAlign="between" vAlign="center" wrap="wrap">
            <Text id={`${id}-body`} weight="medium">
              {t('body')}
            </Text>
            <Selector
              label={t('bodyType')}
              isLabelHidden
              width={160}
              value={c.bodyType}
              onChange={(v) => set({ bodyType: v })}
              options={(['none', 'json', 'text'] as const).map((b) => ({
                value: b,
                label: t(`bodyTypes.${b}`),
              }))}
              isDisabled={disabled}
            />
          </HStack>
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
          {errors.body && <FieldStatus type="error" message={errors.body} variant="detached" />}
        </VStack>
      )}
    </VStack>
  );
}
