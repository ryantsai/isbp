'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { CheckboxList, CheckboxListItem } from '@astryxdesign/core/CheckboxList';
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
  DOCUMENT_PRESETS,
  modelLabel,
  RERANK_PRESETS,
  VISION_PRESETS,
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
          <RerankCard config={config}>
            <TestConnection
              section="rerank"
              state={test}
              pending={runTest.isPending}
              blocked={saveFirst ?? (config.rerank.provider === 'none' ? t('test.noReranker') : null)}
              onTest={onTest}
            />
          </RerankCard>
          <ImagesCard config={config}>
            <TestConnection
              section="vision"
              state={test}
              pending={runTest.isPending}
              blocked={saveFirst ?? (config.vision.provider === 'none' ? t('test.noVision') : null)}
              onTest={onTest}
            />
          </ImagesCard>
          <DocumentsCard config={config}>
            <TestConnection
              section="documents"
              state={test}
              pending={runTest.isPending}
              blocked={
                saveFirst ?? (config.documents.provider === 'none' ? t('test.noDocumentService') : null)
              }
              onTest={onTest}
            />
          </DocumentsCard>
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

function ApiStyleField({ section = 'chat' }: { section?: 'chat' | 'vision' }) {
  const t = useTranslations('ai.models.chat.apiStyle');
  const form = useFormContext<ModelsValues>();
  const value = useWatch({ control: form.control, name: `${section}.apiStyle` });
  return (
    <RadioList
      label={t('label')}
      value={value}
      onChange={(v) =>
        form.setValue(`${section}.apiStyle`, v as ModelsValues['chat']['apiStyle'], { shouldDirty: true })
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

function Prices({
  hint,
  placeholders,
  section = 'chat',
}: {
  hint: string;
  placeholders: [string, string];
  section?: 'chat' | 'vision';
}) {
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
            name={`${section}.${name}`}
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

/* ───────────────────────────── reranker ───────────────────────────── */

const RERANK_PROVIDERS = ['none', 'cohere', 'tei', 'voyage'] as const;

function RerankCard({ config, children }: { config: AiConfigInfo; children: ReactNode }) {
  const t = useTranslations('ai.models');
  const form = useFormContext<ModelsValues>();
  const provider = useWatch({ control: form.control, name: 'rerank.provider' });
  const baseUrl = useWatch({ control: form.control, name: 'rerank.baseUrl' });
  const model = useWatch({ control: form.control, name: 'rerank.model' });

  const onProvider = (next: ModelsValues['rerank']['provider']) => {
    form.setValue('rerank.provider', next, { shouldDirty: true });
    form.clearErrors('rerank');
    const keep = next === config.rerank.provider || next === 'none';
    if (config.rerank.hasApiKey) {
      form.setValue('rerank.keyMode', keep ? 'keep' : 'replace', { shouldDirty: true });
      form.setValue('rerank.apiKey', '', { shouldDirty: true });
    }
    form.setValue('rerank.headers', keep ? headerRows(config.rerank.headers) : [], { shouldDirty: true });
  };

  const on = config.rerank.provider !== 'none';
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('rerank.title')}</CardTitle>
        <CardDescription>{t('rerank.description')}</CardDescription>
        <CardAction>
          <Badge
            variant={on ? 'success' : 'neutral'}
            label={on ? t('badge.on') : t('badge.off')}
            icon={<Icon icon={on ? CircleCheckIcon : CircleMinusIcon} size="xsm" />}
          />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-5">
        <RadioList
          label={t('provider')}
          value={provider}
          onChange={(v) => onProvider(v as ModelsValues['rerank']['provider'])}
        >
          {RERANK_PROVIDERS.map((p) => (
            <RadioListItem
              key={p}
              value={p}
              label={t(`rerank.providers.${p}.label`)}
              description={t(`rerank.providers.${p}.hint`)}
            />
          ))}
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
            {provider === 'none' ? (
              <Note>{t('rerank.noneNote')}</Note>
            ) : (
              <>
                <div className="space-y-2">
                  <Chips
                    label={t('presets')}
                    items={RERANK_PRESETS.filter((p) => p.provider === provider).map((p) => ({
                      id: p.id,
                      label: p.label,
                      hint: p.model || undefined,
                      pressed: baseUrl.trim() === p.baseUrl && model.trim() === p.model,
                      onSelect: () => {
                        const opts = { shouldDirty: true, shouldValidate: true };
                        form.setValue('rerank.baseUrl', p.baseUrl, opts);
                        form.setValue('rerank.model', p.model, opts);
                      },
                    }))}
                  />
                  <BaseUrlField
                    section="rerank"
                    required
                    hint={t('rerank.baseUrlHint')}
                    placeholder={provider === 'tei' ? 'http://localhost:8080' : 'https://api.cohere.com/v2'}
                  />
                </div>
                <SecretKeyField
                  section="rerank"
                  optional
                  stored={config.rerank.hasApiKey}
                  notice={keyNotice(t, 'rerank', config, provider, baseUrl)}
                />
                <FormField
                  control={form.control}
                  name="rerank.model"
                  render={({ field, fieldState }) => (
                    <TextInput
                      label={t('rerank.model')}
                      description={provider === 'tei' ? t('rerank.modelHintTei') : t('rerank.modelHint')}
                      isOptional={provider === 'tei'}
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
                  name="rerank.price"
                  render={({ field, fieldState }) => (
                    <TextInput
                      label={t('rerank.price')}
                      description={t('rerank.priceHint')}
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
                <ConnectionOptions section="rerank" config={config} />
              </>
            )}
          </motion.div>
        </AnimatePresence>
        {children}
      </CardContent>
    </Card>
  );
}

/* ───────────────────────────── images ───────────────────────────── */

function ImagesCard({ config, children }: { config: AiConfigInfo; children: ReactNode }) {
  const t = useTranslations('ai.models');
  const form = useFormContext<ModelsValues>();
  const provider = useWatch({ control: form.control, name: 'vision.provider' });
  const baseUrl = useWatch({ control: form.control, name: 'vision.baseUrl' });
  const model = useWatch({ control: form.control, name: 'vision.model' });
  const chatImages = useWatch({ control: form.control, name: 'images.chat' });
  const noChat = useWatch({ control: form.control, name: 'chat.provider' }) === 'none';

  const onProvider = (next: ModelsValues['vision']['provider']) => {
    form.setValue('vision.provider', next, { shouldDirty: true });
    form.clearErrors('vision');
    // The key and header values belong to the vision service they were saved for.
    const keep = next === config.vision.provider || next !== 'openai-compatible';
    if (config.vision.hasApiKey) {
      form.setValue('vision.keyMode', keep ? 'keep' : 'replace', { shouldDirty: true });
      form.setValue('vision.apiKey', '', { shouldDirty: true });
    }
    form.setValue('vision.headers', keep ? headerRows(config.vision.headers) : [], { shouldDirty: true });
  };

  const on = config.vision.provider !== 'none' || config.images.chat;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('images.title')}</CardTitle>
        <CardDescription>{t('images.description')}</CardDescription>
        <CardAction>
          <Badge
            variant={on ? 'success' : 'neutral'}
            label={on ? t('badge.on') : t('badge.off')}
            icon={<Icon icon={on ? CircleCheckIcon : CircleMinusIcon} size="xsm" />}
          />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-5">
        <RadioList
          label={t('images.describer')}
          description={t('images.describerHint')}
          value={provider}
          onChange={(v) => onProvider(v as ModelsValues['vision']['provider'])}
        >
          <RadioListItem
            value="none"
            label={t('images.providers.none.label')}
            description={t('images.providers.none.hint')}
          />
          <RadioListItem
            value="chat"
            label={t('images.providers.chat.label')}
            description={noChat ? t('images.providers.chat.needsChat') : t('images.providers.chat.hint')}
            isDisabled={noChat && provider !== 'chat'}
          />
          <RadioListItem
            value="openai-compatible"
            label={t('images.providers.openaiCompatible.label')}
            description={t('images.providers.openaiCompatible.hint')}
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
            {provider === 'none' && <Note>{t('images.noneNote')}</Note>}
            {provider === 'chat' && (
              <Note tone={noChat ? 'warning' : 'muted'}>
                {noChat ? t('images.providers.chat.needsChat') : t('images.chatNote')}
              </Note>
            )}
            {provider === 'openai-compatible' && (
              <>
                <div className="space-y-2">
                  <Chips
                    label={t('presets')}
                    items={VISION_PRESETS.map((p) => ({
                      id: p.id,
                      label: p.label,
                      hint: p.model,
                      pressed: baseUrl.trim() === p.baseUrl && model.trim() === p.model,
                      onSelect: () => {
                        const opts = { shouldDirty: true, shouldValidate: true };
                        form.setValue('vision.baseUrl', p.baseUrl, opts);
                        form.setValue('vision.model', p.model, opts);
                      },
                    }))}
                  />
                  <BaseUrlField
                    section="vision"
                    required
                    hint={t('chat.baseUrlHintOpenai')}
                    placeholder="http://localhost:11434/v1"
                  />
                </div>
                <SecretKeyField
                  section="vision"
                  optional
                  stored={config.vision.hasApiKey}
                  notice={keyNotice(t, 'vision', config, provider, baseUrl)}
                />
                <FormField
                  control={form.control}
                  name="vision.model"
                  render={({ field, fieldState }) => (
                    <TextInput
                      label={t('images.model')}
                      description={t('images.modelHint')}
                      isRequired
                      autoComplete="off"
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      status={fieldStatus(fieldState)}
                    />
                  )}
                />
                <ApiStyleField section="vision" />
                <Prices section="vision" hint={t('chat.priceHintCustom')} placeholders={['0', '0']} />
                <ConnectionOptions section="vision" config={config} />
              </>
            )}
          </motion.div>
        </AnimatePresence>

        {provider !== 'none' && <Note tone="warning">{t('images.privacy')}</Note>}

        <FormField
          control={form.control}
          name="images.chat"
          render={({ field }) => (
            <CheckboxInput
              label={t('images.chat')}
              description={t('images.chatHint')}
              value={field.value === true}
              onChange={(checked) => field.onChange(checked)}
              onBlur={field.onBlur}
              isDisabled={noChat && !field.value}
              disabledMessage={noChat ? t('images.chatNeedsModel') : undefined}
              ref={field.ref}
            />
          )}
        />
        {chatImages && noChat && <Note tone="warning">{t('images.chatNeedsModel')}</Note>}
        {children}
      </CardContent>
    </Card>
  );
}

/* ───────────────────────────── attachments (document extraction) ───────────────────────────── */

const DOCUMENT_PROVIDERS = ['none', 'docling', 'paddleocr', 'azure', 'mistral'] as const;
/** OCR languages offered (native names are never translated). */
const OCR_LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'zh-CN', label: '简体中文' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
] as const;

function DocumentsCard({ config, children }: { config: AiConfigInfo; children: ReactNode }) {
  const t = useTranslations('ai.models');
  const form = useFormContext<ModelsValues>();
  const enabled = useWatch({ control: form.control, name: 'documents.enabled' });
  const provider = useWatch({ control: form.control, name: 'documents.provider' });
  const baseUrl = useWatch({ control: form.control, name: 'documents.baseUrl' });

  const onProvider = (next: ModelsValues['documents']['provider']) => {
    form.setValue('documents.provider', next, { shouldDirty: true });
    form.clearErrors('documents');
    const keep = next === config.documents.provider || next === 'none';
    if (config.documents.hasApiKey) {
      form.setValue('documents.keyMode', keep ? 'keep' : 'replace', { shouldDirty: true });
      form.setValue('documents.apiKey', '', { shouldDirty: true });
    }
    form.setValue('documents.headers', keep ? headerRows(config.documents.headers) : [], {
      shouldDirty: true,
    });
    const preset = DOCUMENT_PRESETS.find((p) => p.provider === next);
    if (!keep && preset) {
      form.setValue('documents.baseUrl', preset.baseUrl, { shouldDirty: true });
      form.setValue('documents.model', preset.model, { shouldDirty: true });
    }
  };

  const on = config.documents.enabled;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('documents.title')}</CardTitle>
        <CardDescription>{t('documents.description')}</CardDescription>
        <CardAction>
          <Badge
            variant={on ? 'success' : 'neutral'}
            label={on ? t('badge.on') : t('badge.off')}
            icon={<Icon icon={on ? CircleCheckIcon : CircleMinusIcon} size="xsm" />}
          />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-5">
        <FormField
          control={form.control}
          name="documents.enabled"
          render={({ field }) => (
            <CheckboxInput
              label={t('documents.enabled')}
              description={t('documents.enabledHint')}
              value={field.value === true}
              onChange={(checked) => field.onChange(checked)}
              onBlur={field.onBlur}
              ref={field.ref}
            />
          )}
        />
        {enabled && (
          <>
            <RadioList
              label={t('documents.service')}
              value={provider}
              onChange={(v) => onProvider(v as ModelsValues['documents']['provider'])}
            >
              {DOCUMENT_PROVIDERS.map((p) => (
                <RadioListItem
                  key={p}
                  value={p}
                  label={t(`documents.providers.${p}.label`)}
                  description={t(`documents.providers.${p}.hint`)}
                />
              ))}
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
                {provider === 'none' ? (
                  <Note>{t('documents.noneNote')}</Note>
                ) : (
                  <>
                    <Note tone="warning">{t('documents.privacy')}</Note>
                    <BaseUrlField
                      section="documents"
                      required
                      hint={t(`documents.baseUrlHint.${provider}`)}
                      placeholder={DOCUMENT_PRESETS.find((p) => p.provider === provider)?.baseUrl ?? ''}
                    />
                    <SecretKeyField
                      section="documents"
                      optional={provider === 'docling' || provider === 'paddleocr'}
                      stored={config.documents.hasApiKey}
                      notice={keyNotice(t, 'documents', config, provider, baseUrl)}
                    />
                    {(provider === 'azure' || provider === 'mistral') && (
                      <FormField
                        control={form.control}
                        name="documents.model"
                        render={({ field, fieldState }) => (
                          <TextInput
                            label={t('documents.model')}
                            description={t(`documents.modelHint.${provider}`)}
                            isOptional
                            autoComplete="off"
                            placeholder={DOCUMENT_PRESETS.find((p) => p.provider === provider)?.model}
                            value={field.value}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            status={fieldStatus(fieldState)}
                          />
                        )}
                      />
                    )}
                    <FormField
                      control={form.control}
                      name="documents.mode"
                      render={({ field }) => (
                        <RadioList
                          label={t('documents.mode')}
                          value={field.value}
                          onChange={(v) => field.onChange(v)}
                        >
                          <RadioListItem
                            value="fallback"
                            label={t('documents.modes.fallback.label')}
                            description={t('documents.modes.fallback.hint')}
                          />
                          <RadioListItem
                            value="always"
                            label={t('documents.modes.always.label')}
                            description={t('documents.modes.always.hint')}
                          />
                        </RadioList>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="documents.languages"
                      render={({ field, fieldState }) => (
                        <CheckboxList
                          label={t('documents.languages')}
                          description={t('documents.languagesHint')}
                          value={field.value}
                          onChange={(values) => field.onChange(values)}
                          status={fieldStatus(fieldState)}
                        >
                          {OCR_LANGUAGES.map((l) => (
                            <CheckboxListItem key={l.value} value={l.value} label={l.label} />
                          ))}
                        </CheckboxList>
                      )}
                    />
                    <Grid columns={{ minWidth: 200 }} gap={4}>
                      <FormField
                        control={form.control}
                        name="documents.price"
                        render={({ field, fieldState }) => (
                          <TextInput
                            label={t('documents.price')}
                            description={t('documents.priceHint')}
                            autoComplete="off"
                            placeholder="0"
                            value={field.value}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            status={fieldStatus(fieldState)}
                          />
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="documents.maxPages"
                        render={({ field, fieldState }) => (
                          <TextInput
                            label={t('documents.maxPages')}
                            description={t('documents.maxPagesHint')}
                            autoComplete="off"
                            value={field.value}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            status={fieldStatus(fieldState)}
                          />
                        )}
                      />
                    </Grid>
                    <ConnectionOptions section="documents" config={config} />
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </>
        )}
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
