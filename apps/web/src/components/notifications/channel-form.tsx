'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { NotificationChannel } from '@isbp/contracts';
import { ApiError } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@isbp/ui/dialog';
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
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Switch } from '@isbp/ui/switch';
import { CheckIcon, LightbulbIcon, LockIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { useApiMutation, useErrorText } from '@/lib/api';
import {
  CHANNEL_TYPES,
  CHANNELS_PATH,
  ChannelTile,
  type ChannelType,
  localeLabel,
  MESSAGE_LOCALES,
  useChannelLabel,
} from './notification-meta';
import { TypePatternsField } from './type-patterns-field';

type Created = NotificationChannel & { signingSecret: string | null };

const PLACEHOLDER: Record<ChannelType, string> = {
  teams: 'https://prod-00.westeurope.logic.azure.com/workflows/…',
  slack: 'https://hooks.slack.com/services/T000/B000/XXXX',
  webhook: 'https://example.com/hooks/isbp',
};

const isHttpUrl = (value: string) => {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
};

/** Add (no `channel`) or edit a Teams / Slack / webhook channel. The URL is write-only. */
export function ChannelFormDialog({
  open,
  onOpenChange,
  channel,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel?: NotificationChannel;
  onCreated: (c: Created) => void;
}) {
  const t = useTranslations('notifications.admin.channels.form');
  const tc = useTranslations('common');
  const channelLabel = useChannelLabel();
  const errorText = useErrorText();
  const editing = Boolean(channel);
  const typeGroupId = useId();
  const list = useFieldList();

  const schema = useMemo(
    () =>
      z
        .object({
          name: z.string().trim().min(1, t('validation.name')).max(200, t('validation.nameLength')),
          type: z.enum(CHANNEL_TYPES),
          url: z.string().trim().max(2000, t('validation.url')),
          locale: z.enum(MESSAGE_LOCALES),
          types: z.array(z.string()).min(1, t('validation.types')).max(50, t('validation.typesMax')),
          enabled: z.boolean(),
        })
        .superRefine((v, ctx) => {
          if (!v.url && !editing)
            ctx.addIssue({ code: 'custom', path: ['url'], message: t('validation.urlRequired') });
          else if (v.url && !isHttpUrl(v.url))
            ctx.addIssue({ code: 'custom', path: ['url'], message: t('validation.url') });
        }),
    [t, editing],
  );
  type Values = z.input<typeof schema>;
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', type: 'teams', url: '', locale: 'en', types: [], enabled: true },
  });

  // Reset only when the dialog opens, so background refetches never clobber what's being typed.
  const wasOpen = useRef(false);
  useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (!opening) return;
    form.reset(
      channel
        ? {
            name: channel.name,
            type: channel.type,
            url: '',
            locale: (MESSAGE_LOCALES as readonly string[]).includes(channel.locale)
              ? (channel.locale as Values['locale'])
              : 'en',
            types: [...channel.types],
            enabled: channel.enabled,
          }
        : { name: '', type: 'teams', url: '', locale: 'en', types: [], enabled: true },
    );
  }, [open, channel, form]);

  const type = useWatch({ control: form.control, name: 'type' });
  const [locale, enabled] = useWatch({ control: form.control, name: ['locale', 'enabled'] });

  const create = useApiMutation((api, v: Values) => api.post<Created>(CHANNELS_PATH, v), {
    invalidate: [CHANNELS_PATH],
    success: (c) => t('created', { name: c.name }),
    onSuccess: (c) => {
      onOpenChange(false);
      onCreated(c);
    },
    silent: true,
  });
  const update = useApiMutation(
    (api, v: Partial<Values>) => api.patch<NotificationChannel>(`${CHANNELS_PATH}/${channel!.id}`, v),
    {
      invalidate: [CHANNELS_PATH],
      success: (c) => t('saved', { name: c.name }),
      onSuccess: () => onOpenChange(false),
      silent: true,
    },
  );
  const pending = create.isPending || update.isPending;

  const onSubmit = form.handleSubmit(async (v) => {
    const name = v.name.trim();
    const url = v.url.trim();
    try {
      if (editing) {
        await update.mutateAsync({
          name,
          locale: v.locale,
          types: v.types,
          enabled: v.enabled,
          ...(url ? { url } : {}),
        });
      } else {
        await create.mutateAsync({ ...v, name, url });
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'WEBHOOK_TARGET_INVALID') {
        form.setError('url', { message: t('validation.target') }, { shouldFocus: true });
        return;
      }
      if (err instanceof ApiError && err.code === 'VALIDATION_FAILED') {
        const issues = (err.details as { issues?: { path: string }[] } | undefined)?.issues ?? [];
        const fields = ['name', 'url', 'types', 'locale'] as const;
        let mapped = false;
        for (const issue of issues) {
          const field = fields.find((f) => issue.path === f || issue.path.startsWith(`${f}.`));
          if (field) {
            form.setError(field, {
              message: field === 'url' ? t('validation.url') : t('validation.invalid'),
            });
            mapped = true;
          }
        }
        if (mapped) return;
      }
      form.setError('root', { message: errorText(err) });
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('close')} className="grid-cols-[minmax(0,1fr)] sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? t('editTitle', { name: channel!.name }) : t('createTitle')}</DialogTitle>
          <DialogDescription>{editing ? t('editDescription') : t('createDescription')}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-5" noValidate>
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <span id={typeGroupId} className="text-sm leading-none font-medium">
                    {t('type')}
                  </span>
                  <div role="radiogroup" aria-labelledby={typeGroupId} className="grid grid-cols-3 gap-2">
                    {CHANNEL_TYPES.map((ct) => {
                      const selected = field.value === ct;
                      return (
                        <label
                          key={ct}
                          className={cn(
                            'relative flex cursor-pointer flex-col items-center gap-2 rounded-lg border p-3 text-center text-sm transition-[border-color,background-color] duration-200 hover:bg-accent/50 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
                            selected && 'border-primary bg-primary/5 hover:bg-primary/5',
                            editing && !selected && 'hidden',
                            editing && 'col-span-3 cursor-default flex-row text-left',
                          )}
                        >
                          <input
                            type="radio"
                            name={field.name}
                            value={ct}
                            checked={selected}
                            disabled={editing}
                            onChange={() => field.onChange(ct)}
                            className="sr-only"
                          />
                          <ChannelTile kind={ct} className="size-9 [&_svg]:size-4" />
                          <span className="font-medium">{channelLabel(ct)}</span>
                          {editing ? (
                            <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <LockIcon className="size-3" aria-hidden /> {t('typeLocked')}
                            </span>
                          ) : (
                            selected && (
                              <motion.span
                                layoutId={`${typeGroupId}-check`}
                                className="absolute top-1.5 right-1.5 grid size-4 place-items-center rounded-full bg-primary text-primary-foreground"
                                aria-hidden
                              >
                                <CheckIcon className="size-2.5" strokeWidth={3} />
                              </motion.span>
                            )
                          )}
                        </label>
                      );
                    })}
                  </div>
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      key={type}
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 4 }}
                      transition={{ duration: 0.15 }}
                      className="flex items-start gap-2.5 rounded-lg bg-muted/50 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground"
                    >
                      <LightbulbIcon
                        className="mt-0.5 size-3.5 shrink-0 text-warning-foreground"
                        aria-hidden
                      />
                      <p>{t(`guide.${type}`)}</p>
                    </motion.div>
                  </AnimatePresence>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('name')}</FormLabel>
                  <FormControl>
                    <Input autoComplete="off" placeholder={t('namePlaceholder')} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('url')}
                    {editing && (
                      <span className="font-normal text-muted-foreground"> ({tc('optional')})</span>
                    )}
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="url"
                      inputMode="url"
                      autoComplete="off"
                      spellCheck={false}
                      className={cn('font-mono text-xs', editing && 'placeholder:font-sans')}
                      placeholder={editing ? t('urlKeepPlaceholder') : PLACEHOLDER[type]}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {editing ? t('urlKeep', { host: channel!.host }) : t('urlHint')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="types"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel>{t('types.label')}</FormLabel>
                  <FormDescription className="-mt-1">{t('types.hint')}</FormDescription>
                  <FormControl>
                    <TypePatternsField
                      value={field.value}
                      onChange={field.onChange}
                      invalid={Boolean(fieldState.error)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <OptionalFields
              hint={list([t('locale'), t('enabled')])}
              filled={countFilled(locale === 'en' ? '' : locale, !enabled)}
            >
              <FormField
                control={form.control}
                name="locale"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('locale')}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full sm:w-64">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {MESSAGE_LOCALES.map((l) => (
                          <SelectItem key={l} value={l} lang={l}>
                            {localeLabel(l)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>{t('localeHint')}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="enabled"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between gap-4 rounded-lg border px-3 py-2.5">
                    <div className="space-y-0.5">
                      <FormLabel>{t('enabled')}</FormLabel>
                      <FormDescription>{t('enabledHint')}</FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </OptionalFields>
            {form.formState.errors.root && (
              <p role="alert" className="text-sm text-destructive">
                {form.formState.errors.root.message}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {tc('cancel')}
              </Button>
              <Button type="submit" loading={pending}>
                {editing ? tc('saveChanges') : t('submit')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
