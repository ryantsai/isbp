'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@isbp/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@isbp/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@isbp/ui/form';
import { Input } from '@isbp/ui/input';
import { useApiMutation } from '@isbp/ui/query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Textarea } from '@isbp/ui/textarea';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { type CreateItemInput, createItemSchema, type Item } from '../contracts';

const STATUSES = ['draft', 'active', 'archived'] as const;

export function ItemFormDialog({ open, onOpenChange, item, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; item?: Item; onSaved?: (item: Item) => void }) {
  const t = useTranslations('__ID__');
  const tc = useTranslations('common');
  const form = useForm<CreateItemInput>({ resolver: zodResolver(createItemSchema), defaultValues: { title: '', description: '', status: 'draft' } });

  useEffect(() => {
    if (open) form.reset({ title: item?.title ?? '', description: item?.description ?? '', status: item?.status ?? 'draft' });
  }, [open, item, form]);

  const save = useApiMutation(
    (api, values: CreateItemInput) => (item ? api.patch<Item>(`/__ID__/items/${item.id}`, values) : api.post<Item>('/__ID__/items', values)),
    {
      invalidate: ['/__ID__/'],
      success: item ? t('saved') : t('created'),
      onSuccess: (saved) => {
        onOpenChange(false);
        onSaved?.(saved);
      },
    },
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{item ? t('editTitle') : t('createTitle')}</DialogTitle>
          <DialogDescription>{t('formHint')}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.title')}</FormLabel>
                  <FormControl>
                    <Input autoFocus {...field} />
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
                  <FormLabel>{t('fields.description')}</FormLabel>
                  <FormControl>
                    <Textarea rows={5} {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.status')}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {t(`status.${s}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {tc('cancel')}
              </Button>
              <Button type="submit" loading={save.isPending}>
                {item ? tc('saveChanges') : tc('create')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
