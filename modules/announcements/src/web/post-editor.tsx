'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@isbp/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@isbp/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@isbp/ui/form';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { useApiMutation } from '@isbp/ui/query';
import { Switch } from '@isbp/ui/switch';
import { Textarea } from '@isbp/ui/textarea';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import type { Post, Severity } from '../contracts';
import { SeverityBadge } from './severity';

const SEVERITIES: Severity[] = ['info', 'maintenance', 'incident'];

/** `<input type="datetime-local">` value ↔ ISO string (in the browser's time zone). */
const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocalInput = (value: string) => (value ? new Date(value).toISOString() : null);

const formSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().max(10_000),
    severity: z.enum(['info', 'maintenance', 'incident']),
    pinned: z.boolean(),
    startsAt: z.string(),
    endsAt: z.string(),
  })
  .refine((v) => !v.startsAt || !v.endsAt || v.endsAt > v.startsAt, {
    path: ['endsAt'],
    message: 'Must be after the start',
  });
type Values = z.infer<typeof formSchema>;

export function PostEditor({
  open,
  onOpenChange,
  post,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  post?: Post;
  onSaved?: (p: Post) => void;
}) {
  const t = useTranslations('announcements');
  const tc = useTranslations('common');
  const form = useForm<Values>({
    resolver: zodResolver(formSchema),
    defaultValues: { title: '', body: '', severity: 'info', pinned: false, startsAt: '', endsAt: '' },
  });
  useEffect(() => {
    if (!open) return;
    form.reset({
      title: post?.title ?? '',
      body: post?.body ?? '',
      severity: post?.severity ?? 'info',
      pinned: post?.pinned ?? false,
      startsAt: toLocalInput(post?.startsAt),
      endsAt: toLocalInput(post?.endsAt),
    });
  }, [open, post, form]);

  const severity = useWatch({ control: form.control, name: 'severity' });

  const save = useApiMutation(
    (api, { values, publish }: { values: Values; publish: boolean }) => {
      const body = {
        ...values,
        startsAt: fromLocalInput(values.startsAt),
        endsAt: fromLocalInput(values.endsAt),
      };
      return post
        ? api.patch<Post>(`/announcements/posts/${post.id}`, body)
        : api.post<Post>('/announcements/posts', { ...body, publish });
    },
    {
      invalidate: ['/announcements/'],
      success: (p) => (post ? t('saved') : p.status === 'published' ? t('publishedToast') : t('draftSaved')),
      onSuccess: (p) => {
        onOpenChange(false);
        onSaved?.(p);
      },
    },
  );
  const submit = (publish: boolean) => form.handleSubmit((values) => save.mutate({ values, publish }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl" closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{post ? t('editor.editTitle') : t('editor.createTitle')}</DialogTitle>
          <DialogDescription>{t('editor.hint')}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit(false)} className="space-y-4" noValidate>
            <div role="radiogroup" aria-label={t('editor.severity')} className="grid grid-cols-3 gap-2">
              {SEVERITIES.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={severity === s}
                  onClick={() => form.setValue('severity', s, { shouldDirty: true })}
                  className="flex flex-col items-start gap-1.5 rounded-lg border p-2.5 text-left transition-all hover:bg-accent/50 aria-checked:border-primary aria-checked:bg-primary/5 aria-checked:shadow-xs"
                >
                  <SeverityBadge severity={s} />
                  <span className="text-xs text-muted-foreground">{t(`severityHint.${s}`)}</span>
                </button>
              ))}
            </div>
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('editor.title')}</FormLabel>
                  <FormControl>
                    <Input autoFocus {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="body"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('editor.body')}</FormLabel>
                  <FormControl>
                    <Textarea rows={6} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="startsAt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('editor.startsAt')}</FormLabel>
                    <FormControl>
                      <Input type="datetime-local" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="endsAt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('editor.endsAt')}</FormLabel>
                    <FormControl>
                      <Input type="datetime-local" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">{t('editor.windowHint')}</p>
            <FormField
              control={form.control}
              name="pinned"
              render={({ field }) => (
                <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
                  <Label htmlFor="pinned" className="flex-col items-start gap-0.5">
                    <span>{t('editor.pinned')}</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {t('editor.pinnedHint')}
                    </span>
                  </Label>
                  <Switch id="pinned" checked={field.value} onCheckedChange={field.onChange} />
                </div>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {tc('cancel')}
              </Button>
              {post ? (
                <Button type="submit" loading={save.isPending}>
                  {tc('saveChanges')}
                </Button>
              ) : (
                <>
                  <Button
                    type="submit"
                    variant="secondary"
                    loading={save.isPending && !save.variables?.publish}
                  >
                    {t('editor.saveDraft')}
                  </Button>
                  <Button
                    type="button"
                    onClick={submit(true)}
                    loading={save.isPending && save.variables?.publish}
                  >
                    {t('editor.publish')}
                  </Button>
                </>
              )}
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
