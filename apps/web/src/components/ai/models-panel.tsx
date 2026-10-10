'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { AiConfigInfo, AiTestResult } from '@isbp/contracts';
import { cn } from '@isbp/ui';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@isbp/ui/form';
import { Input } from '@isbp/ui/input';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  ChevronDownIcon,
  CircleCheckIcon,
  CircleMinusIcon,
  CircleOffIcon,
  CpuIcon,
  InfoIcon,
  ServerIcon,
  SparklesIcon,
  TriangleAlertIcon,
} from 'lucide-react';
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
import {
  type ModelsValues,
  modelsSchema,
  providerChanged,
  type Section,
  toModelsBody,
  toModelsValues,
} from './models-schema';
import { RadioCards } from './radio-cards';
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
          <p role="alert" className="text-sm text-destructive">
            {form.formState.errors.root.message}
          </p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            disabled={!dirty || save.isPending}
            onClick={() => form.reset(toModelsValues(config))}
          >
            {t('discard')}
          </Button>
          <Button type="submit" disabled={!dirty} loading={save.isPending}>
            {tc('saveChanges')}
          </Button>
        </div>
      </form>
    </Form>
  );
}

/* ───────────────────────────── chat ───────────────────────────── */

function ChatCard({ config, children }: { config: AiConfigInfo; children: ReactNode }) {
  const t = useTranslations('ai.models');
  const form = useFormContext<ModelsValues>();
  const groupId = useId();
  const provider = useWatch({ control: form.control, name: 'chat.provider' });

  const onProvider = (next: ModelsValues['chat']['provider']) => {
    form.setValue('chat.provider', next, { shouldDirty: true });
    form.clearErrors('chat');
    // A stored key is only kept for the provider it was saved for.
    if (config.chat.hasApiKey) {
      const keep = next === config.chat.provider || next === 'none';
      form.setValue('chat.keyMode', keep ? 'keep' : 'replace', { shouldDirty: true });
      form.setValue('chat.apiKey', '', { shouldDirty: true });
    }
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
        <div className="space-y-2">
          <span id={groupId} className="text-sm leading-none font-medium">
            {t('provider')}
          </span>
          <RadioCards
            name="chat.provider"
            labelledBy={groupId}
            value={provider}
            onChange={onProvider}
            className="sm:grid-cols-3"
            options={[
              {
                value: 'none',
                label: t('chat.providers.none.label'),
                hint: t('chat.providers.none.hint'),
                icon: <CircleOffIcon />,
              },
              {
                value: 'anthropic',
                label: t('chat.providers.anthropic.label'),
                hint: t('chat.providers.anthropic.hint'),
                icon: <SparklesIcon />,
              },
              {
                value: 'openai-compatible',
                label: t('chat.providers.openaiCompatible.label'),
                hint: t('chat.providers.openaiCompatible.hint'),
                icon: <ServerIcon />,
              },
            ]}
          />
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={provider}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="space-y-5"
          >
            {provider === 'none' && <Note icon={<InfoIcon aria-hidden />}>{t('chat.noneNote')}</Note>}
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
    return (
      <Badge variant="muted">
        <CircleMinusIcon aria-hidden /> {t('builtin')}
      </Badge>
    );
  if (config.chat.provider === 'anthropic' && !config.chat.hasApiKey)
    return (
      <Badge variant="warning">
        <TriangleAlertIcon aria-hidden /> {t('keyMissing')}
      </Badge>
    );
  return (
    <Badge variant="success">
      <CircleCheckIcon aria-hidden /> {t('on')}
    </Badge>
  );
}

function AnthropicFields({ config }: { config: AiConfigInfo }) {
  const t = useTranslations('ai.models');
  const form = useFormContext<ModelsValues>();
  const model = useWatch({ control: form.control, name: 'chat.model' });
  const baseUrl = useWatch({ control: form.control, name: 'chat.baseUrl' });
  const defaultModel = config.chat.defaultModel ?? DEFAULT_ANTHROPIC_MODEL;
  const listId = useId();
  const advancedId = useId();
  const [advanced, setAdvanced] = useState(Boolean(config.chat.baseUrl));
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
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('chat.model')}</FormLabel>
            <FormControl>
              <Input
                list={listId}
                autoComplete="off"
                spellCheck={false}
                placeholder={defaultModel}
                className="font-mono text-sm"
                {...field}
              />
            </FormControl>
            <datalist id={listId}>
              {CLAUDE_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {`${modelLabel(m.id)} · ${t(`chat.suggestions.${m.hint}`)}`}
                </option>
              ))}
            </datalist>
            <FormDescription>{t('chat.modelHintAnthropic', { model: defaultModel })}</FormDescription>
            <FormMessage />
          </FormItem>
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
      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2 text-muted-foreground"
          aria-expanded={advanced}
          aria-controls={advancedId}
          onClick={() => setAdvanced((v) => !v)}
        >
          <ChevronDownIcon
            className={cn('transition-transform duration-200', advanced && 'rotate-180')}
            aria-hidden
          />
          {t('chat.advanced')}
        </Button>
        <AnimatePresence initial={false}>
          {advanced && (
            <motion.div
              id={advancedId}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="px-0.5 pt-3 pb-1">
                <BaseUrlField
                  section="chat"
                  hint={t('chat.baseUrlHintAnthropic')}
                  placeholder="https://api.anthropic.com"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
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
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('chat.model')}</FormLabel>
            <FormControl>
              <Input autoComplete="off" spellCheck={false} className="font-mono text-sm" {...field} />
            </FormControl>
            <FormDescription>{t('chat.modelHintOpenai')}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
      <Prices hint={t('chat.priceHintCustom')} placeholders={['0', '0']} />
    </>
  );
}

function Prices({ hint, placeholders }: { hint: string; placeholders: [string, string] }) {
  const t = useTranslations('ai.models');
  const form = useFormContext<ModelsValues>();
  const id = useId();
  return (
    <fieldset className="space-y-2" aria-describedby={id}>
      <legend className="text-sm font-medium">{t('chat.prices')}</legend>
      <div className="grid gap-4 sm:grid-cols-2">
        {(['inputPrice', 'outputPrice'] as const).map((name, i) => (
          <FormField
            key={name}
            control={form.control}
            name={`chat.${name}`}
            render={({ field }) => (
              <FormItem>
                <FormLabel className="font-normal text-muted-foreground">{t(`chat.${name}`)}</FormLabel>
                <FormControl>
                  <Input
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder={placeholders[i]}
                    className="tabular-nums"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ))}
      </div>
      <p id={id} className="text-xs text-muted-foreground">
        {hint}
      </p>
    </fieldset>
  );
}

/* ───────────────────────────── embeddings ───────────────────────────── */

function EmbeddingsCard({ config, children }: { config: AiConfigInfo; children: ReactNode }) {
  const t = useTranslations('ai.models');
  const form = useFormContext<ModelsValues>();
  const groupId = useId();
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
    if (config.embeddings.hasApiKey) {
      const keep = next === config.embeddings.provider || next === 'builtin';
      form.setValue('embeddings.keyMode', keep ? 'keep' : 'replace', { shouldDirty: true });
      form.setValue('embeddings.apiKey', '', { shouldDirty: true });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('embeddings.title')}</CardTitle>
        <CardDescription>{t('embeddings.description')}</CardDescription>
        <CardAction>
          <Badge variant={config.embeddings.provider === 'builtin' ? 'muted' : 'success'}>
            {config.embeddings.provider === 'builtin' ? (
              <CpuIcon aria-hidden />
            ) : (
              <CircleCheckIcon aria-hidden />
            )}{' '}
            {config.embeddings.provider === 'builtin' ? t('badge.builtin') : t('badge.on')}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <span id={groupId} className="text-sm leading-none font-medium">
            {t('provider')}
          </span>
          <RadioCards
            name="embeddings.provider"
            labelledBy={groupId}
            value={provider}
            onChange={onProvider}
            className="sm:grid-cols-2"
            options={[
              {
                value: 'builtin',
                label: t('embeddings.providers.builtin.label'),
                hint: t('embeddings.providers.builtin.hint'),
                icon: <CpuIcon />,
              },
              {
                value: 'openai-compatible',
                label: t('embeddings.providers.openaiCompatible.label'),
                hint: t('embeddings.providers.openaiCompatible.hint'),
                icon: <ServerIcon />,
              },
            ]}
          />
        </div>

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
              <Note icon={<InfoIcon aria-hidden />}>{t('embeddings.builtinNote')}</Note>
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
                <div className="space-y-2">
                  <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
                    <FormField
                      control={form.control}
                      name="embeddings.model"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('embeddings.model')}</FormLabel>
                          <FormControl>
                            <Input
                              autoComplete="off"
                              spellCheck={false}
                              className="font-mono text-sm"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="embeddings.dimensions"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('embeddings.dimensions')}</FormLabel>
                          <FormControl>
                            <Input
                              inputMode="numeric"
                              autoComplete="off"
                              className="tabular-nums"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">{t('embeddings.dimensionsHint')}</p>
                </div>
                <FormField
                  control={form.control}
                  name="embeddings.price"
                  render={({ field }) => (
                    <FormItem className="sm:max-w-56">
                      <FormLabel>{t('embeddings.price')}</FormLabel>
                      <FormControl>
                        <Input
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder="0"
                          className="tabular-nums"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>{t('embeddings.priceHint')}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}
          </motion.div>
        </AnimatePresence>

        <Note icon={<TriangleAlertIcon aria-hidden />} tone={modelChanges ? 'warning' : 'muted'}>
          {t('embeddings.reembedWarning')}
        </Note>
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
      render={({ field }) => (
        <FormItem>
          <FormLabel>{t('baseUrl')}</FormLabel>
          <FormControl>
            <Input
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder={placeholder}
              aria-required={required || undefined}
              className="font-mono text-sm"
              {...field}
            />
          </FormControl>
          <FormDescription>{hint}</FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/** Quick-fill buttons (presets, suggested models); `aria-pressed` marks the one that matches. */
function Chips({
  label,
  items,
}: {
  label: string;
  items: { id: string; label: string; hint?: string; pressed: boolean; onSelect: () => void }[];
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <p id={id} className="text-xs text-muted-foreground">
        {label}
      </p>
      <div role="group" aria-labelledby={id} className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={item.pressed}
            onClick={item.onSelect}
            className={cn(
              'inline-flex max-w-full items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs font-medium transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
              item.pressed && 'border-primary bg-primary/5 hover:bg-primary/10',
            )}
          >
            {item.pressed && <CircleCheckIcon className="size-3.5 shrink-0 text-primary" aria-hidden />}
            <span className="truncate">{item.label}</span>
            {item.hint && <span className="truncate font-normal text-muted-foreground">{item.hint}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function Note({
  icon,
  tone = 'muted',
  children,
}: {
  icon: ReactNode;
  tone?: 'muted' | 'warning';
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-xs leading-relaxed transition-colors [&>svg]:mt-0.5 [&>svg]:size-3.5 [&>svg]:shrink-0',
        tone === 'muted' && 'bg-muted/50 text-muted-foreground',
        tone === 'warning' && 'bg-warning/15 text-warning-foreground',
      )}
    >
      {icon}
      <p>{children}</p>
    </div>
  );
}
