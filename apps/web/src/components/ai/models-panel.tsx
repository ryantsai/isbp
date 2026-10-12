'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Grid } from '@astryxdesign/core/Grid';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { ToggleButton } from '@astryxdesign/core/ToggleButton';
import { zodResolver } from '@hookform/resolvers/zod';
import type { AiConfigInfo, AiTestResult } from '@isbp/contracts';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { Form, FormField, fieldStatus } from '@isbp/ui/form';
import { Skeleton } from '@isbp/ui/skeleton';
import { CircleCheckIcon, CircleMinusIcon, CpuIcon, InfoIcon, TriangleAlertIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useForm, useFormContext, useWatch } from 'react-hook-form';
import { applyServerErrors, useApiMutation, useApiQuery, useErrorText } from '@/lib/api';
import {
  AI_PREFIX,
  CHAT_PRESETS,
  CLAUDE_MODELS,
  CONFIG_PATH,
  DEFAULT_ANTHROPIC_MODEL,
  EMBEDDING_PRESETS,
  knownPrices,
  modelLabel,
} from './ai-meta';
import { ConnectionFields } from './connection-fields';
import {
  headerRows,
  type ModelsValues,
  modelsSchema,
  providerChanged,
  type Section,
  toModelsBody,
  toModelsValues,
} from './models-schema';
import { SecretKeyField } from './secret-key-field';
import { TestConnection, type TestState } from './test-result';

export function ModelsPanel() {
  const { data } = useApiQuery<AiConfigInfo>(CONFIG_PATH);
  if (!data)
    return (
      <div className="max-w-3xl space-y-5">
        {[0, 1].map((i) => (
          <Card key={i}>
            <CardContent className="space-y-4">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-2/3" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  return <ModelsForm config={data} />;
}

function ModelsForm({ config }: { config: AiConfigInfo }) {
  const t = useTranslations('ai.models');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const schema = useMemo(() => modelsSchema(t, config), [t, config]);
  const form = useForm<ModelsValues>({
    resolver: zodResolver(schema),
    defaultValues: toModelsValues(config),
  });
  const dirty = form.formState.isDirty;
  const [test, setTest] = useState<TestState>(null);

  // Pick up changes saved elsewhere while nothing is being edited here.
  const last = useRef(config);
  useEffect(() => {
    if (last.current === config) return;
    last.current = config;
    if (!form.formState.isDirty) form.reset(toModelsValues(config));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  const save = useApiMutation(
    (api, body: ReturnType<typeof toModelsBody>) => api.put<AiConfigInfo>(CONFIG_PATH, body),
    {
      invalidate: [AI_PREFIX],
      success: t('saved'),
      onSuccess: (c) => {
        last.current = c;
        form.reset(toModelsValues(c));
        setTest(null);
      },
      silent: true,
    },
  );

  const runTest = useApiMutation((api) => api.post<AiTestResult>('/ai/test'), {
    // Each test call is logged as usage.
    invalidate: ['/ai/usage'],
    silent: true,
  });
  const onTest = async () => {
    setTest(null);
    try {
      setTest({ result: await runTest.mutateAsync(undefined) });
    } catch (err) {
      setTest({ error: errorText(err) });
    }
  };

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await save.mutateAsync(toModelsBody(v, config));
    } catch (err) {
      if (applyServerErrors(err, form.setError as never)) return;
      form.setError('root', { message: errorText(err) });
    }
  });

  const saveFirst = dirty ? t('test.saveFirst') : null;

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="max-w-3xl space-y-5">
        <div className="space-y-5">
          <ChatCard config={config}>
            <TestConnection
              section="chat"
              state={test}
              pending={runTest.isPending}
              blocked={saveFirst ?? (config.chat.provider === 'none' ? t('test.nothingToTest') : null)}
              onTest={onTest}
            />
          </ChatCard>
          <EmbeddingsCard config={config}>
            <TestConnection
              section="embeddings"
              state={test}
              pending={runTest.isPending}
              blocked={saveFirst}
              onTest={onTest}
            />
          </EmbeddingsCard>
        </div>

        {form.formState.errors.root && (
          <Banner status="error" title={form.formState.errors.root.message} collapsible={false} />
        )}
        <HStack gap={2} hAlign="end" wrap="wrap">
          <Button
            label={t('discard')}
            variant="ghost"
            isDisabled={!dirty || save.isPending}
            type="button"
            onClick={() => form.reset(toModelsValues(config))}
          />
          <Button
            label={tc('saveChanges')}
            variant="primary"
            isLoading={save.isPending}
            isDisabled={!dirty}
            type="submit"
          />
        </HStack>
      </form>
    </Form>
  );
}

/* ───────────────────────────── chat ───────────────────────────── */

function ChatCard({ config, children }: { config: AiConfigInfo; children: ReactNode }) {
  const t = useTranslations('ai.models');
  const form = useFormContext<ModelsValues>();
  const provider = useWatch({ control: form.control, name: 'chat.provider' });

  const onProvider = (next: ModelsValues['chat']['provider']) => {
    form.setValue('chat.provider', next, { shouldDirty: true });
    form.clearErrors('chat');
    // A stored key and stored header values are only kept for the provider they were saved for.
    const keep = next === config.chat.provider || next === 'none';
    if (config.chat.hasApiKey) {
      form.setValue('chat.keyMode', keep ? 'keep' : 'replace', { shouldDirty: true });
      form.setValue('chat.apiKey', '', { shouldDirty: true });
    }
    form.setValue('chat.headers', keep ? headerRows(config.chat.headers) : [], { shouldDirty: true });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('chat.title')}</CardTitle>
        <CardDescription>{t('chat.description')}</CardDescription>
        <CardAction>
          <ChatBadge config={config} />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-5">
        <RadioList
          label={t('provider')}
          value={provider}
          onChange={(v) => onProvider(v as ModelsValues['chat']['provider'])}
        >
          <RadioListItem
            value="none"
            label={t('chat.providers.none.label')}
            description={t('chat.providers.none.hint')}
          />
          <RadioListItem
            value="anthropic"
            label={t('chat.providers.anthropic.label')}
            description={t('chat.providers.anthropic.hint')}
          />
          <RadioListItem
            value="openai-compatible"
            label={t('chat.providers.openaiCompatible.label')}
            description={t('chat.providers.openaiCompatible.hint')}
          />
        </RadioList>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={provider}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="space-y-5"
          >
            {provider === 'none' && <Note>{t('chat.noneNote')}</Note>}
            {provider === 'anthropic' && <AnthropicFields config={config} />}
            {provider === 'openai-compatible' && <OpenAiChatFields config={config} />}
          </motion.div>
        </AnimatePresence>
        {children}
      </CardContent>
    </Card>
  );
}

function ChatBadge({ config }: { config: AiConfigInfo }) {
  const t = useTranslations('ai.models.badge');
  if (config.chat.provider === 'none')
    return <Badge variant="neutral" label={t('builtin')} icon={<Icon icon={CircleMinusIcon} size="xsm" />} />;
  if (config.chat.provider === 'anthropic' && !config.chat.hasApiKey)
    return (
      <Badge variant="warning" label={t('keyMissing')} icon={<Icon icon={TriangleAlertIcon} size="xsm" />} />
    );
  return <Badge variant="success" label={t('on')} icon={<Icon icon={CircleCheckIcon} size="xsm" />} />;
}

function AnthropicFields({ config }: { config: AiConfigInfo }) {
  const t = useTranslations('ai.models');
  const form = useFormContext<ModelsValues>();
  const model = useWatch({ control: form.control, name: 'chat.model' });
  const baseUrl = useWatch({ control: form.control, name: 'chat.baseUrl' });
  const defaultModel = config.chat.defaultModel ?? DEFAULT_ANTHROPIC_MODEL;
  const prices = knownPrices(model);
  const current = model.trim() || defaultModel;

  return (
    <>
      <SecretKeyField
        section="chat"
        stored={config.chat.hasApiKey}
        notice={keyNotice(t, 'chat', config, 'anthropic', baseUrl)}
      />
      <FormField
        control={form.control}
        name="chat.model"
        render={({ field, fieldState }) => (
          <TextInput
            label={t('chat.model')}
            description={t('chat.modelHintAnthropic', { model: defaultModel })}
            placeholder={defaultModel}
            autoComplete="off"
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            status={fieldStatus(fieldState)}
          />
        )}
      />
      <Chips
        label={t('chat.suggestionsLabel')}
        items={CLAUDE_MODELS.map((m) => ({
          id: m.id,
          label: modelLabel(m.id),
          hint: t(`chat.suggestions.${m.hint}`),
          pressed: current === m.id,
          onSelect: () => form.setValue('chat.model', m.id, { shouldDirty: true, shouldValidate: true }),
        }))}
      />
      <Prices
        hint={t('chat.priceHintKnown')}
        placeholders={prices ? [String(prices[0]), String(prices[1])] : ['0', '0']}
      />
      <Collapsible
        trigger={<Text color="secondary">{t('chat.advanced')}</Text>}
        defaultIsOpen={Boolean(config.chat.baseUrl) || hasConnectionOptions(config.chat)}
      >
        <VStack gap={5}>
          <BaseUrlField
            section="chat"
            hint={t('chat.baseUrlHintAnthropic')}
            placeholder="https://api.anthropic.com"
          />
          <ConnectionFields<ModelsValues> section="chat" />
        </VStack>
      </Collapsible>
    </>
  );
}

const hasConnectionOptions = (c: { headers: unknown[]; insecureTls: boolean }) =>
  c.headers.length > 0 || c.insecureTls;

/** Headers and the TLS switch, folded away until needed (open when something is set). */
function ConnectionOptions({ section, config }: { section: Section; config: AiConfigInfo }) {
  const t = useTranslations('ai.models');
  return (
    <Collapsible
      trigger={<Text color="secondary">{t('connection.title')}</Text>}
      defaultIsOpen={hasConnectionOptions(config[section])}
    >
      <ConnectionFields<ModelsValues> section={section} />
    </Collapsible>
  );
}

function ApiStyleField() {
  const t = useTranslations('ai.models.chat.apiStyle');
  const form = useFormContext<ModelsValues>();
  const value = useWatch({ control: form.control, name: 'chat.apiStyle' });
  return (
    <RadioList
      label={t('label')}
      value={value}
      onChange={(v) =>
        form.setValue('chat.apiStyle', v as ModelsValues['chat']['apiStyle'], { shouldDirty: true })
      }
    >
      <RadioListItem
        value="chat-completions"
        label={t('chatCompletions.label')}
        description={t('chatCompletions.hint')}
      />
      <RadioListItem value="responses" label={t('responses.label')} description={t('responses.hint')} />
    </RadioList>
  );
}

function OpenAiChatFields({ config }: { config: AiConfigInfo }) {
  const t = useTranslations('ai.models');
  const form = useFormContext<ModelsValues>();
  const baseUrl = useWatch({ control: form.control, name: 'chat.baseUrl' });
  return (
    <>
      <div className="space-y-2">
        <BaseUrlField
          section="chat"
          required
          hint={t('chat.baseUrlHintOpenai')}
          placeholder="https://api.openai.com/v1"
        />
        <Chips
          label={t('presets')}
          items={CHAT_PRESETS.map((p) => ({
            id: p.id,
            label: p.label,
            pressed: baseUrl.trim() === p.baseUrl,
            onSelect: () =>
              form.setValue('chat.baseUrl', p.baseUrl, { shouldDirty: true, shouldValidate: true }),
          }))}
        />
      </div>
      <SecretKeyField
        section="chat"
        optional
        stored={config.chat.hasApiKey}
        notice={keyNotice(t, 'chat', config, 'openai-compatible', baseUrl)}
      />
      <FormField
        control={form.control}
        name="chat.model"
        render={({ field, fieldState }) => (
          <TextInput
            label={t('chat.model')}
            description={t('chat.modelHintOpenai')}
            autoComplete="off"
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            status={fieldStatus(fieldState)}
          />
        )}
      />
      <ApiStyleField />
      <Prices hint={t('chat.priceHintCustom')} placeholders={['0', '0']} />
      <ConnectionOptions section="chat" config={config} />
    </>
  );
}

function Prices({ hint, placeholders }: { hint: string; placeholders: [string, string] }) {
  const t = useTranslations('ai.models');
  const form = useFormContext<ModelsValues>();
  return (
    <VStack gap={2}>
      <Text type="label">{t('chat.prices')}</Text>
      <Grid columns={{ minWidth: 200 }} gap={4}>
        {(['inputPrice', 'outputPrice'] as const).map((name, i) => (
          <FormField
            key={name}
            control={form.control}
            name={`chat.${name}`}
            render={({ field, fieldState }) => (
              <TextInput
                label={t(`chat.${name}`)}
                autoComplete="off"
                placeholder={placeholders[i]}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                status={fieldStatus(fieldState)}
              />
            )}
          />
        ))}
      </Grid>
      <Text as="p" display="block" type="supporting" color="secondary">
        {hint}
      </Text>
    </VStack>
  );
}

/* ───────────────────────────── embeddings ───────────────────────────── */

function EmbeddingsCard({ config, children }: { config: AiConfigInfo; children: ReactNode }) {
  const t = useTranslations('ai.models');
  const form = useFormContext<ModelsValues>();
  const provider = useWatch({ control: form.control, name: 'embeddings.provider' });
  const model = useWatch({ control: form.control, name: 'embeddings.model' });
  const baseUrl = useWatch({ control: form.control, name: 'embeddings.baseUrl' });

  // Builtin always means the builtin model; a different effective model re-embeds everything.
  const savedModel = config.embeddings.provider === 'builtin' ? 'builtin' : config.embeddings.model;
  const nextModel = provider === 'builtin' ? 'builtin' : model.trim();
  const modelChanges = nextModel !== savedModel;

  const onProvider = (next: ModelsValues['embeddings']['provider']) => {
    form.setValue('embeddings.provider', next, { shouldDirty: true });
    form.clearErrors('embeddings');
    const keep = next === config.embeddings.provider || next === 'builtin';
    if (config.embeddings.hasApiKey) {
      form.setValue('embeddings.keyMode', keep ? 'keep' : 'replace', { shouldDirty: true });
      form.setValue('embeddings.apiKey', '', { shouldDirty: true });
    }
    form.setValue('embeddings.headers', keep ? headerRows(config.embeddings.headers) : [], {
      shouldDirty: true,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('embeddings.title')}</CardTitle>
        <CardDescription>{t('embeddings.description')}</CardDescription>
        <CardAction>
          <Badge
            variant={config.embeddings.provider === 'builtin' ? 'neutral' : 'success'}
            label={config.embeddings.provider === 'builtin' ? t('badge.builtin') : t('badge.on')}
            icon={
              <Icon icon={config.embeddings.provider === 'builtin' ? CpuIcon : CircleCheckIcon} size="xsm" />
            }
          />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-5">
        <RadioList
          label={t('provider')}
          value={provider}
          onChange={(v) => onProvider(v as ModelsValues['embeddings']['provider'])}
        >
          <RadioListItem
            value="builtin"
            label={t('embeddings.providers.builtin.label')}
            description={t('embeddings.providers.builtin.hint')}
          />
          <RadioListItem
            value="openai-compatible"
            label={t('embeddings.providers.openaiCompatible.label')}
            description={t('embeddings.providers.openaiCompatible.hint')}
          />
        </RadioList>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={provider}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="space-y-5"
          >
            {provider === 'builtin' ? (
              <Note>{t('embeddings.builtinNote')}</Note>
            ) : (
              <>
                <div className="space-y-2">
                  <Chips
                    label={t('presets')}
                    items={EMBEDDING_PRESETS.map((p) => ({
                      id: p.id,
                      label: p.label,
                      hint: p.model,
                      pressed: baseUrl.trim() === p.baseUrl && model.trim() === p.model,
                      onSelect: () => {
                        const opts = { shouldDirty: true, shouldValidate: true };
                        form.setValue('embeddings.baseUrl', p.baseUrl, opts);
                        form.setValue('embeddings.model', p.model, opts);
                        form.setValue('embeddings.dimensions', String(p.dimensions), opts);
                      },
                    }))}
                  />
                  <BaseUrlField
                    section="embeddings"
                    required
                    hint={t('embeddings.baseUrlHint')}
                    placeholder="https://api.openai.com/v1"
                  />
                </div>
                <SecretKeyField
                  section="embeddings"
                  optional
                  stored={config.embeddings.hasApiKey}
                  notice={keyNotice(t, 'embeddings', config, provider, baseUrl)}
                />
                <VStack gap={2}>
                  <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
                    <FormField
                      control={form.control}
                      name="embeddings.model"
                      render={({ field, fieldState }) => (
                        <TextInput
                          label={t('embeddings.model')}
                          autoComplete="off"
                          value={field.value}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          status={fieldStatus(fieldState)}
                        />
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="embeddings.dimensions"
                      render={({ field, fieldState }) => (
                        <TextInput
                          label={t('embeddings.dimensions')}
                          autoComplete="off"
                          value={field.value}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          status={fieldStatus(fieldState)}
                        />
                      )}
                    />
                  </div>
                  <Text as="p" display="block" type="supporting" color="secondary">
                    {t('embeddings.dimensionsHint')}
                  </Text>
                </VStack>
                <FormField
                  control={form.control}
                  name="embeddings.price"
                  render={({ field, fieldState }) => (
                    <TextInput
                      label={t('embeddings.price')}
                      description={t('embeddings.priceHint')}
                      autoComplete="off"
                      placeholder="0"
                      width={224}
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      status={fieldStatus(fieldState)}
                    />
                  )}
                />
                <ConnectionOptions section="embeddings" config={config} />
              </>
            )}
          </motion.div>
        </AnimatePresence>

        <Note tone={modelChanges ? 'warning' : 'muted'}>{t('embeddings.reembedWarning')}</Note>
        {children}
      </CardContent>
    </Card>
  );
}

/* ───────────────────────────── shared bits ───────────────────────────── */

function keyNotice(
  t: (key: string) => string,
  section: Section,
  config: AiConfigInfo,
  provider: string,
  baseUrl: string,
): string | null {
  if (providerChanged(section, provider, config)) return t('key.providerChanged');
  if (config[section].hasApiKey && baseUrl.trim() !== config[section].baseUrl.trim())
    return t('key.urlChanged');
  return null;
}

function BaseUrlField({
  section,
  hint,
  placeholder,
  required,
}: {
  section: Section;
  hint: string;
  placeholder: string;
  required?: boolean;
}) {
  const t = useTranslations('ai.models');
  const form = useFormContext<ModelsValues>();
  return (
    <FormField
      control={form.control}
      name={`${section}.baseUrl`}
      render={({ field, fieldState }) => (
        <TextInput
          label={t('baseUrl')}
          description={hint}
          isRequired={required}
          autoComplete="off"
          placeholder={placeholder}
          value={field.value}
          onChange={field.onChange}
          onBlur={field.onBlur}
          status={fieldStatus(fieldState)}
        />
      )}
    />
  );
}

/** Quick-fill buttons (presets, suggested models); `isPressed` marks the one that matches. */
function Chips({
  label,
  items,
}: {
  label: string;
  items: { id: string; label: string; hint?: string; pressed: boolean; onSelect: () => void }[];
}) {
  const id = useId();
  return (
    <VStack gap={1.5}>
      <Text id={id} type="supporting" color="secondary">
        {label}
      </Text>
      <div role="group" aria-labelledby={id}>
        <HStack gap={1.5} wrap="wrap">
          {items.map((item) => (
            <ToggleButton
              key={item.id}
              size="sm"
              label={item.hint ? `${item.label} · ${item.hint}` : item.label}
              isPressed={item.pressed}
              onPressedChange={() => item.onSelect()}
            />
          ))}
        </HStack>
      </div>
    </VStack>
  );
}

/** A quiet explanatory line; `warning` (a change that triggers re-embedding) is a banner. */
function Note({ tone = 'muted', children }: { tone?: 'muted' | 'warning'; children: ReactNode }) {
  if (tone === 'warning')
    return (
      <Banner
        status="warning"
        icon={<Icon icon={TriangleAlertIcon} />}
        title={children}
        collapsible={false}
      />
    );
  return (
    <HStack gap={1.5} vAlign="start">
      <Icon icon={InfoIcon} color="secondary" />
      <Text as="p" display="block" type="supporting" color="secondary">
        {children}
      </Text>
    </HStack>
  );
}
