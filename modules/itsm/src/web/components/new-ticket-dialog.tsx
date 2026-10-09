'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useCan, usePlatform } from '@isbp/sdk/web';
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
import { Label } from '@isbp/ui/label';
import { type PersonOption, PersonPicker } from '@isbp/ui/person-picker';
import { applyServerErrors, useApiMutation } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Switch } from '@isbp/ui/switch';
import { Textarea } from '@isbp/ui/textarea';
import { SirenIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { type CreateTicketInput, priorityFor, type TicketDetail, type TicketType } from '../../contracts';
import { INVALIDATE, ticketHref, useCategories } from '../lib';
import type { CmdbCiOption } from '../types';
import { PriorityBadge, TYPE_ICON } from './badges';
import { AssigneeSelect, CategorySelect, CiPicker, GroupSelect } from './pickers';

const LEVELS = ['1', '2', '3'] as const;

/** Impact / urgency select with the long label ("High — work is blocked"). */
export function LevelSelect({
  kind,
  value,
  onChange,
  id,
  size,
  className,
}: {
  kind: 'impact' | 'urgency';
  value: string;
  onChange: (v: string) => void;
  id?: string;
  size?: 'sm' | 'default';
  className?: string;
}) {
  const t = useTranslations('itsm');
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} size={size} className={className ?? 'w-full'}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LEVELS.map((l) => (
          <SelectItem key={l} value={l}>
            {t(`${kind}.${l}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Segmented radio group of ticket types (icon + label). */
export function TypeRadio({
  types,
  value,
  onChange,
  label,
}: {
  types: readonly TicketType[];
  value: TicketType;
  onChange: (t: TicketType) => void;
  label: string;
}) {
  const t = useTranslations('itsm.types');
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {types.map((type) => {
        const Icon = TYPE_ICON[type];
        return (
          <button
            key={type}
            type="button"
            role="radio"
            aria-checked={value === type}
            onClick={() => onChange(type)}
            className="flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none aria-checked:border-primary aria-checked:bg-primary/5 aria-checked:font-medium"
          >
            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            {t(type)}
          </button>
        );
      })}
    </div>
  );
}

const makeSchema = (t: (key: string) => string) =>
  z.object({
    type: z.enum(['incident', 'service_request', 'problem', 'change']),
    requester: z.custom<PersonOption | null>(),
    title: z.string().trim().min(3, t('titleTooShort')).max(200, t('titleTooLong')),
    description: z.string().max(20_000),
    impact: z.enum(LEVELS),
    urgency: z.enum(LEVELS),
    categoryId: z.string().nullable(),
    groupId: z.string().nullable(),
    assigneeId: z.string().nullable(),
    cis: z.array(z.custom<CmdbCiOption>()).max(20),
    major: z.boolean(),
  });
type Values = z.infer<ReturnType<typeof makeSchema>>;

/** Agents raise a ticket for anyone: classification, assignment and affected CIs up front. */
export function NewTicketDialog({
  open,
  onOpenChange,
  types = ['incident', 'service_request'],
  defaultType,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  types?: readonly TicketType[];
  defaultType?: TicketType;
}) {
  const t = useTranslations('itsm.newTicket');
  const tc = useTranslations('common');
  const router = useRouter();
  const uid = useId();
  const { enabledModules } = usePlatform();
  const canPickCis = useCan('cmdb.cis.read') && enabledModules.includes('cmdb');
  const schema = useMemo(() => makeSchema(t), [t]);
  const initialType = defaultType ?? types[0] ?? 'incident';
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      type: initialType,
      requester: null,
      title: '',
      description: '',
      impact: '2',
      urgency: '2',
      categoryId: null,
      groupId: null,
      assigneeId: null,
      cis: [],
      major: false,
    },
  });
  useEffect(() => {
    if (open)
      form.reset({
        type: initialType,
        requester: null,
        title: '',
        description: '',
        impact: '2',
        urgency: '2',
        categoryId: null,
        groupId: null,
        assigneeId: null,
        cis: [],
        major: false,
      });
  }, [open, initialType, form]);

  const [type, impact, urgency, groupId, categoryId] = useWatch({
    control: form.control,
    name: ['type', 'impact', 'urgency', 'groupId', 'categoryId'],
  });
  const priority = priorityFor(Number(impact), Number(urgency));
  const { categories } = useCategories(type);

  // A category routes to its default group when no group was picked yet.
  useEffect(() => {
    if (!categoryId || form.getValues('groupId')) return;
    const def = categories.find((c) => c.id === categoryId)?.defaultGroup;
    if (def) form.setValue('groupId', def.id);
  }, [categoryId, categories, form]);

  const create = useApiMutation(
    (api, body: CreateTicketInput) => api.post<TicketDetail>('/itsm/tickets', body),
    {
      invalidate: INVALIDATE,
      success: (r) => t('created', { reference: r.reference }),
      onSuccess: (r) => {
        onOpenChange(false);
        router.push(ticketHref(r.reference));
      },
    },
  );

  const submit = form.handleSubmit((v) =>
    create.mutate(
      {
        type: v.type,
        title: v.title.trim(),
        description: v.description.trim(),
        impact: Number(v.impact),
        urgency: Number(v.urgency),
        categoryId: v.categoryId,
        assignmentGroupId: v.groupId,
        assigneeId: v.assigneeId,
        requesterId: v.requester?.id ?? null,
        ciIds: v.cis.map((c) => c.id),
        channel: 'agent',
        major: v.type === 'incident' ? v.major : undefined,
      },
      { onError: (err) => applyServerErrors(err, form.setError as never) },
    ),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t(types.length === 1 ? `title_${types[0]}` : 'title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} className="grid gap-4" noValidate>
            {types.length > 1 && (
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <TypeRadio
                    types={types}
                    value={field.value}
                    onChange={(v) => {
                      field.onChange(v);
                      form.setValue('categoryId', null);
                    }}
                    label={t('type')}
                  />
                )}
              />
            )}
            <FormField
              control={form.control}
              name="requester"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('requester')}</FormLabel>
                  <FormControl>
                    <PersonPicker
                      value={field.value}
                      onChange={field.onChange}
                      placeholder={t('requesterPlaceholder')}
                    />
                  </FormControl>
                  <FormDescription>{t('requesterHint')}</FormDescription>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('titleLabel')}</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="off" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('descriptionLabel')}</FormLabel>
                  <FormControl>
                    <Textarea rows={4} {...field} />
                  </FormControl>
                  <FormDescription>{t('markdownHint')}</FormDescription>
                </FormItem>
              )}
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
              <FormField
                control={form.control}
                name="impact"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>{t('impact')}</FormLabel>
                    <FormControl>
                      <LevelSelect kind="impact" value={field.value} onChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="urgency"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>{t('urgency')}</FormLabel>
                    <FormControl>
                      <LevelSelect kind="urgency" value={field.value} onChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <div className="grid gap-2" aria-live="polite">
                <span className="text-sm font-medium">{t('priority')}</span>
                <div className="flex h-9 items-center">
                  <PriorityBadge priority={priority} long />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="categoryId"
                render={({ field }) => (
                  <FormItem className="min-w-0 sm:col-span-2">
                    <FormLabel>{t('category')}</FormLabel>
                    <FormControl>
                      <CategorySelect type={type} value={field.value} onChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="groupId"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>{t('group')}</FormLabel>
                    <FormControl>
                      <GroupSelect
                        value={field.value}
                        onChange={(v) => {
                          field.onChange(v);
                          form.setValue('assigneeId', null);
                        }}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="assigneeId"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>{t('assignee')}</FormLabel>
                    <FormControl>
                      <AssigneeSelect groupId={groupId} value={field.value} onChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>
            {canPickCis && (
              <FormField
                control={form.control}
                name="cis"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('cis')}</FormLabel>
                    <FormControl>
                      <CiPicker value={field.value} onChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
            )}
            {type === 'incident' && (
              <FormField
                control={form.control}
                name="major"
                render={({ field }) => (
                  <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
                    <Label htmlFor={`${uid}-major`} className="flex-col items-start gap-0.5">
                      <span className="inline-flex items-center gap-1.5">
                        <SirenIcon className="size-4 text-destructive" aria-hidden />
                        {t('major')}
                      </span>
                      <span className="text-xs font-normal text-muted-foreground">{t('majorHint')}</span>
                    </Label>
                    <Switch id={`${uid}-major`} checked={field.value} onCheckedChange={field.onChange} />
                  </div>
                )}
              />
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {tc('cancel')}
              </Button>
              <Button type="submit" loading={create.isPending}>
                {t('submit')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
