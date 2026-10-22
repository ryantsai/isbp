'use client';

import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxList, CheckboxListItem } from '@astryxdesign/core/CheckboxList';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Heading } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { zodResolver } from '@hookform/resolvers/zod';
import { localize } from '@isbp/sdk';
import { EmptyState } from '@isbp/ui/empty-state';
import { fieldStatus, Form, FormField } from '@isbp/ui/form';
import { PageHeader } from '@isbp/ui/page-header';
import { useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetForm,
  SheetHeader,
  SheetTitle,
} from '@isbp/ui/sheet';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  CheckIcon,
  CopyIcon,
  GlobeIcon,
  LockIcon,
  MessageSquareShareIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import {
  EMBED_SCRIPT_PATH,
  embedOriginSchema,
  type PublishCategory,
  type PublishedChat,
  type PublishedChatInput,
  publishedChatPath,
} from '../../contracts';

const LIST = '/helpdesk-ai/published-chats';
const SESSION_LENGTHS = [60, 240, 480, 1440, 10080] as const;

/**
 * Administration → Published chats: Ask IS as a link and a widget on other websites. Each chat is for signed-in
 * people (their own permissions, tickets) or for anyone (public articles of chosen categories, no tickets), and may be
 * embedded only by the websites listed.
 */
export default function PublishedChatsPage() {
  const t = useTranslations('helpdesk-ai.published');
  const { data, isLoading } = useApiQuery<{ items: PublishedChat[] }>(LIST);
  const [editing, setEditing] = useState<PublishedChat | 'new' | null>(null);
  const items = data?.items ?? [];

  return (
    <VStack gap={4}>
      <PageHeader
        title={t('admin.title')}
        description={t('admin.description')}
        actions={
          <Button
            label={t('admin.create')}
            variant="primary"
            icon={<Icon icon={PlusIcon} />}
            onClick={() => setEditing('new')}
          />
        }
      />
      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : !items.length ? (
        <EmptyState
          icon={<MessageSquareShareIcon />}
          title={t('admin.emptyTitle')}
          description={t('admin.emptyBody')}
        />
      ) : (
        <List hasDividers aria-label={t('admin.title')}>
          {items.map((c) => (
            <ListItem
              key={c.id}
              label={c.name}
              description={[
                t(`admin.access.${c.access}.label`),
                c.allowedOrigins.length
                  ? t('admin.websitesCount', { count: c.allowedOrigins.length })
                  : t('admin.linkOnly'),
                t('admin.conversationsCount', { count: c.conversations }),
              ].join(' · ')}
              startContent={<Icon icon={c.access === 'anyone' ? GlobeIcon : LockIcon} color="secondary" />}
              endContent={
                <Badge
                  variant={c.enabled ? 'success' : 'neutral'}
                  label={c.enabled ? t('admin.on') : t('admin.off')}
                />
              }
              onClick={() => setEditing(c)}
            />
          ))}
        </List>
      )}
      <ChatSheet editing={editing} onChange={setEditing} onClose={() => setEditing(null)} />
    </VStack>
  );
}

function ChatSheet({
  editing,
  onChange,
  onClose,
}: {
  editing: PublishedChat | 'new' | null;
  /** The chat as saved (created, or given a new link). */
  onChange: (chat: PublishedChat) => void;
  onClose: () => void;
}) {
  const t = useTranslations('helpdesk-ai.published.admin');
  const tc = useTranslations('common');
  const chat = editing && editing !== 'new' ? editing : null;
  return (
    <Sheet open={editing !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-xl" closeLabel={tc('close')}>
        <SheetHeader>
          <SheetTitle>{chat ? chat.name : t('createTitle')}</SheetTitle>
          <SheetDescription>{t('formHint')}</SheetDescription>
        </SheetHeader>
        {/* Mounted per opening, so it starts from the chat as it is now. */}
        {editing !== null && (
          <ChatForm key={chat?.id ?? 'new'} chat={chat} onChange={onChange} onDone={onClose} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function ChatForm({
  chat,
  onChange,
  onDone,
}: {
  chat: PublishedChat | null;
  onChange: (chat: PublishedChat) => void;
  onDone: () => void;
}) {
  const t = useTranslations('helpdesk-ai.published.admin');
  const tc = useTranslations('common');
  const locale = useLocale();
  const errorText = useErrorText();
  const categories = useApiQuery<{ items: PublishCategory[] }>(`${LIST}/categories`);
  const [confirm, setConfirm] = useState<'regenerate' | 'delete' | null>(null);
  const [current, setCurrent] = useState(chat);

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(1, t('nameRequired')).max(120),
        enabled: z.boolean(),
        access: z.enum(['signed_in', 'anyone']),
        websites: z
          .string()
          .refine((v) => lines(v).every((l) => embedOriginSchema.safeParse(l).success), t('websitesInvalid')),
        categoryIds: z.array(z.string()),
        title: z.string().trim().max(120),
        welcome: z.string().trim().max(1_000),
        sessionMinutes: z.string(),
      }),
    [t],
  );
  type Values = z.input<typeof schema>;
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: chat?.name ?? '',
      enabled: chat?.enabled ?? true,
      access: chat?.access ?? 'signed_in',
      websites: (chat?.allowedOrigins ?? []).join('\n'),
      categoryIds: chat?.categoryIds ?? [],
      title: chat?.title ?? '',
      welcome: chat?.welcome ?? '',
      sessionMinutes: String(chat?.sessionMinutes ?? 240),
    },
  });
  const access = useWatch({ control: form.control, name: 'access' });

  const save = useApiMutation(
    (api, v: Values) => {
      const body: PublishedChatInput = {
        name: v.name.trim(),
        enabled: v.enabled,
        access: v.access,
        allowedOrigins: lines(v.websites).map((l) => l.toLowerCase()),
        categoryIds: v.access === 'anyone' ? v.categoryIds : [],
        title: v.title.trim(),
        welcome: v.welcome.trim(),
        sessionMinutes: Number(v.sessionMinutes),
      };
      return current
        ? api.patch<PublishedChat>(`${LIST}/${current.id}`, body)
        : api.post<PublishedChat>(LIST, body);
    },
    {
      invalidate: [LIST],
      success: current ? t('saved') : t('created'),
      silent: true,
      // A new chat stays open: its link and snippets are below.
      onSuccess: (saved) => (current ? onDone() : onChange(saved)),
    },
  );
  const regenerate = useApiMutation((api) => api.post<PublishedChat>(`${LIST}/${current!.id}/regenerate`), {
    invalidate: [LIST],
    success: t('regenerated'),
    onSuccess: (c) => {
      setCurrent(c);
      onChange(c);
    },
  });
  const remove = useApiMutation((api) => api.delete(`${LIST}/${current!.id}`), {
    invalidate: [LIST],
    success: t('deleted'),
    onSuccess: onDone,
  });

  const onSubmit = form.handleSubmit(async (v) => {
    form.clearErrors('root');
    try {
      await save.mutateAsync(v);
    } catch (err) {
      form.setError('root', { message: errorText(err) });
    }
  });

  return (
    <Form {...form}>
      <SheetForm onSubmit={onSubmit} noValidate>
        <SheetBody className="py-2">
          <VStack gap={6}>
            {current && <Share chat={current} />}
            <FormLayout defaultOptionality="optional">
              <FormField
                control={form.control}
                name="name"
                render={({ field, fieldState }) => (
                  <TextInput
                    label={t('name')}
                    description={t('nameHint')}
                    isRequired
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    ref={field.ref}
                    hasAutoFocus={!current}
                    status={fieldStatus(fieldState)}
                  />
                )}
              />
              <FormField
                control={form.control}
                name="access"
                render={({ field }) => (
                  <RadioList label={t('accessLabel')} value={field.value} onChange={field.onChange}>
                    <RadioListItem
                      value="signed_in"
                      label={t('access.signed_in.label')}
                      description={t('access.signed_in.hint')}
                    />
                    <RadioListItem
                      value="anyone"
                      label={t('access.anyone.label')}
                      description={t('access.anyone.hint')}
                    />
                  </RadioList>
                )}
              />
              {access === 'anyone' && (
                <FormField
                  control={form.control}
                  name="categoryIds"
                  render={({ field }) => (
                    <CheckboxList
                      label={t('categories')}
                      description={t('categoriesHint')}
                      value={field.value}
                      onChange={(values) => field.onChange(values)}
                    >
                      {(categories.data?.items ?? []).map((c) => (
                        <CheckboxListItem key={c.id} value={c.id} label={localize(c.name, locale) || c.key} />
                      ))}
                    </CheckboxList>
                  )}
                />
              )}
              <FormField
                control={form.control}
                name="websites"
                render={({ field, fieldState }) => (
                  <TextArea
                    label={t('websites')}
                    description={t('websitesHint')}
                    placeholder="https://intranet.example.com"
                    rows={3}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    status={fieldStatus(fieldState)}
                  />
                )}
              />
              <FormField
                control={form.control}
                name="title"
                render={({ field, fieldState }) => (
                  <TextInput
                    label={t('chatTitle')}
                    description={t('chatTitleHint')}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    status={fieldStatus(fieldState)}
                  />
                )}
              />
              <FormField
                control={form.control}
                name="welcome"
                render={({ field, fieldState }) => (
                  <TextArea
                    label={t('welcome')}
                    description={t('welcomeHint')}
                    rows={3}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    status={fieldStatus(fieldState)}
                  />
                )}
              />
              <FormField
                control={form.control}
                name="sessionMinutes"
                render={({ field }) => (
                  <Selector
                    label={t('session')}
                    description={t('sessionHint')}
                    value={field.value}
                    onChange={(v) => field.onChange(String(v))}
                    options={SESSION_LENGTHS.map((m) => ({ value: String(m), label: t(`sessions.${m}`) }))}
                  />
                )}
              />
              <FormField
                control={form.control}
                name="enabled"
                render={({ field }) => (
                  <Switch
                    label={t('enabled')}
                    description={t('enabledHint')}
                    value={field.value}
                    onChange={(on) => field.onChange(on)}
                  />
                )}
              />
            </FormLayout>
            {form.formState.errors.root && (
              <Banner status="error" title={form.formState.errors.root.message} collapsible={false} />
            )}
            {current && (
              <VStack gap={2}>
                <Heading level={3}>{t('dangerTitle')}</Heading>
                <HStack gap={2} wrap="wrap">
                  <Button
                    label={t('regenerate')}
                    variant="secondary"
                    icon={<Icon icon={RefreshCwIcon} />}
                    type="button"
                    onClick={() => setConfirm('regenerate')}
                  />
                  <Button
                    label={tc('delete')}
                    variant="secondary"
                    icon={<Icon icon={Trash2Icon} />}
                    type="button"
                    onClick={() => setConfirm('delete')}
                  />
                </HStack>
              </VStack>
            )}
          </VStack>
        </SheetBody>
        <SheetFooter>
          <Button label={tc('close')} variant="secondary" type="button" onClick={onDone} />
          <Button
            label={current ? tc('saveChanges') : t('publish')}
            variant="primary"
            isLoading={save.isPending}
            type="submit"
          />
        </SheetFooter>
      </SheetForm>
      <AlertDialog
        isOpen={confirm === 'regenerate'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t('regenerateTitle')}
        description={t('regenerateBody')}
        actionLabel={t('regenerate')}
        cancelLabel={tc('cancel')}
        onAction={async () => {
          await regenerate.mutateAsync(undefined).catch(() => undefined);
          setConfirm(null);
        }}
      />
      <AlertDialog
        isOpen={confirm === 'delete'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t('deleteTitle')}
        description={t('deleteBody')}
        actionLabel={tc('delete')}
        cancelLabel={tc('cancel')}
        onAction={async () => {
          await remove.mutateAsync(undefined).catch(() => undefined);
          setConfirm(null);
        }}
      />
    </Form>
  );
}

const lines = (v: string) =>
  v
    .split(/[\s,]+/)
    .map((l) => l.trim())
    .filter(Boolean);

/** The chat's link and the two ways to put it on a website, each with a copy button. */
function Share({ chat }: { chat: PublishedChat }) {
  const t = useTranslations('helpdesk-ai.published.admin');
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const link = `${origin}${publishedChatPath(chat.token)}`;
  const iframe = `<iframe src="${link}?embed=1" title="${(chat.title || 'Ask IS').replace(/[&"<>]/g, (ch) => `&#${ch.charCodeAt(0)};`)}" style="width:400px;height:640px;border:0"></iframe>`;
  const script = `<script src="${origin}${EMBED_SCRIPT_PATH}" data-chat="${chat.token}" defer></script>`;
  return (
    <VStack gap={3}>
      <Heading level={3}>{t('shareTitle')}</Heading>
      {!chat.enabled && <Banner status="warning" title={t('offWarning')} collapsible={false} />}
      {!chat.allowedOrigins.length && <Banner status="info" title={t('linkOnlyNote')} collapsible={false} />}
      <CopyField label={t('link')} value={link} />
      <CopyField label={t('scriptSnippet')} description={t('scriptHint')} value={script} multiline />
      <CopyField label={t('iframeSnippet')} description={t('iframeHint')} value={iframe} multiline />
    </VStack>
  );
}

function CopyField({
  label,
  description,
  value,
  multiline,
}: {
  label: string;
  description?: string;
  value: string;
  multiline?: boolean;
}) {
  const t = useTranslations('common');
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard?.writeText(value).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2_000);
  };
  return (
    <HStack gap={2} vAlign="end">
      <div className="min-w-0 flex-1">
        {multiline ? (
          <TextArea
            label={label}
            description={description}
            value={value}
            isReadOnly
            rows={3}
            onChange={() => {}}
          />
        ) : (
          <TextInput label={label} description={description} value={value} isReadOnly onChange={() => {}} />
        )}
      </div>
      <IconButton
        variant="secondary"
        size="sm"
        label={copied ? t('copied') : `${t('copy')}: ${label}`}
        icon={<Icon icon={copied ? CheckIcon : CopyIcon} />}
        onClick={() => void copy()}
      />
    </HStack>
  );
}
