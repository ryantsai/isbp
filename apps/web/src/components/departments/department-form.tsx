'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { createDepartmentSchema, updateDepartmentSchema } from '@isbp/contracts';
import { ApiError } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
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
import { easeOut } from '@isbp/ui/motion';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@isbp/ui/select';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@isbp/ui/sheet';
import { Textarea } from '@isbp/ui/textarea';
import { ChevronDownIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { type FieldValues, type Resolver, type UseFormReturn, useForm } from 'react-hook-form';
import type { z } from 'zod';
import {
  attributesPayload,
  CustomFieldsSection,
  useApplyEntityErrors,
  useAttributeDefaults,
  useAttributesResolver,
  useEntityFields,
} from '@/components/fields/entity-fields';
import { type PickedUser, UserPicker } from '@/components/pickers/user-picker';
import { type DepartmentNode, useDepartments } from '@/components/pickers/use-departments';
import { useApiMutation, useErrorText } from '@/lib/api';

type Values = z.input<typeof createDepartmentSchema>;

const NONE = '__none__';
export const DEPARTMENT_INVALIDATE = [
  '/departments',
  '/users',
  '/platform/dashboard',
  '/audit-logs',
  '/role-assignments',
];

/** Indented parent picker that disables the department being edited and its whole subtree. */
function ParentSelect({
  value,
  onChange,
  excludePath,
  ...rest
}: {
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  excludePath?: string;
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}) {
  const t = useTranslations('departments.form');
  const { ordered } = useDepartments();
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger className="w-full" {...rest}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-80">
        <SelectItem value={NONE}>{t('parentNone')}</SelectItem>
        <SelectSeparator />
        {ordered.map((d) => (
          <SelectItem
            key={d.id}
            value={d.id}
            disabled={Boolean(excludePath && d.path.startsWith(excludePath))}
          >
            <span style={{ paddingInlineStart: `${d.depth * 14}px` }} className="flex items-center gap-1.5">
              {d.depth > 0 && <span className="text-muted-foreground/60">└</span>}
              {d.name}
              <span className="font-mono text-xs text-muted-foreground">{d.code}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Create (no `department`; optional preset `parentId`) or edit / move a department. Simple by
 * default; the sibling sort order sits behind "advanced".
 */
export function DepartmentFormSheet({
  open,
  onOpenChange,
  department,
  parentId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  department?: DepartmentNode;
  parentId?: string | null;
  /** Called with the department's id after a successful create or update. */
  onSaved?: (id: string) => void;
}) {
  const t = useTranslations('departments.form');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const managerId = useId();
  const editing = Boolean(department);
  const [advanced, setAdvanced] = useState(false);
  const [manager, setManager] = useState<PickedUser | null>(null);

  const custom = useEntityFields('core.department', open);
  const applyErrors = useApplyEntityErrors();
  const resolver = useAttributesResolver(
    zodResolver(
      editing ? (updateDepartmentSchema as unknown as typeof createDepartmentSchema) : createDepartmentSchema,
    ) as Resolver<Values>,
    custom.fields,
  );

  const form = useForm<Values>({
    resolver,
    defaultValues: { code: '', name: '', description: '', parentId: null, managerId: null, sortOrder: 0 },
  });

  // Reset only when the sheet opens, so background refetches never clobber what's being typed.
  const wasOpen = useRef(false);
  useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (!opening) return;
    setAdvanced(false);
    if (department) {
      form.reset({
        code: department.code,
        name: department.name,
        description: department.description ?? '',
        parentId: department.parentId,
        managerId: department.manager?.id ?? null,
        sortOrder: department.sortOrder,
      });
      setManager(
        department.manager
          ? { id: department.manager.id, displayName: department.manager.displayName }
          : null,
      );
    } else {
      form.reset({
        code: '',
        name: '',
        description: '',
        parentId: parentId ?? null,
        managerId: null,
        sortOrder: 0,
      });
      setManager(null);
    }
  }, [open, department, parentId, form]);
  useAttributeDefaults(
    form as unknown as UseFormReturn<FieldValues>,
    custom.fields,
    custom.ready,
    open,
    department?.attributes,
  );

  const create = useApiMutation((api, values: Values) => api.post<{ id: string }>('/departments', values), {
    invalidate: DEPARTMENT_INVALIDATE,
    success: () => t('created', { name: form.getValues('name') }),
    onSuccess: (r) => {
      onOpenChange(false);
      onSaved?.(r.id);
    },
    silent: true,
  });
  const update = useApiMutation(
    (api, values: Values) => api.patch(`/departments/${department!.id}`, values),
    {
      invalidate: DEPARTMENT_INVALIDATE,
      success: t('saved'),
      onSuccess: () => {
        onOpenChange(false);
        onSaved?.(department!.id);
      },
      silent: true,
    },
  );
  const mutation = editing ? update : create;

  const onSubmit = form.handleSubmit(async (values) => {
    const payload: Values = {
      ...values,
      description: values.description?.trim() ? values.description.trim() : null,
      parentId: values.parentId ?? null,
      managerId: values.managerId ?? null,
      sortOrder: values.sortOrder ?? 0,
      // Custom-field values only once their definitions are loaded (never wipe them by accident).
      attributes: custom.ready ? attributesPayload(custom.fields, values.attributes) : undefined,
    };
    try {
      await mutation.mutateAsync(payload);
    } catch (err) {
      if (applyErrors(err, form.setError as never)) return;
      if (err instanceof ApiError && err.code === 'INVALID_PARENT') {
        form.setError('parentId', { message: t('invalidParent') });
        return;
      }
      if (err instanceof ApiError && err.code === 'CONFLICT') {
        form.setError('code', { message: t('codeTaken') }, { shouldFocus: true });
        return;
      }
      form.setError('root', { message: errorText(err) });
    }
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md" closeLabel={tc('close')}>
        <SheetHeader>
          <SheetTitle>{editing ? t('editTitle', { name: department!.name }) : t('createTitle')}</SheetTitle>
          <SheetDescription>{editing ? t('editDescription') : t('createDescription')}</SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
            <SheetBody className="space-y-5 py-2">
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
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('code')}</FormLabel>
                    <FormControl>
                      <Input
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={t('codePlaceholder')}
                        className="font-mono text-sm"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>{t('codeHint')}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="parentId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('parent')}</FormLabel>
                    <FormControl>
                      <ParentSelect
                        value={field.value}
                        onChange={field.onChange}
                        excludePath={department?.path}
                      />
                    </FormControl>
                    {editing && <FormDescription>{t('parentHint')}</FormDescription>}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid gap-2">
                <Label htmlFor={managerId}>{t('manager')}</Label>
                <UserPicker
                  id={managerId}
                  value={manager}
                  placeholder={t('noManager')}
                  onChange={(m) => {
                    setManager(m);
                    form.setValue('managerId', m?.id ?? null, { shouldDirty: true });
                  }}
                />
              </div>
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t('description')}{' '}
                      <span className="font-normal text-muted-foreground">({tc('optional')})</span>
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        rows={3}
                        placeholder={t('descriptionPlaceholder')}
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <CustomFieldsSection
                elements={custom.elements}
                form={form as unknown as UseFormReturn<FieldValues>}
                className="pt-1"
              />

              <div>
                <button
                  type="button"
                  onClick={() => setAdvanced((a) => !a)}
                  aria-expanded={advanced}
                  className="flex items-center gap-1.5 rounded-sm text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <ChevronDownIcon
                    className={`size-4 transition-transform duration-200 ${advanced ? 'rotate-180' : ''}`}
                    aria-hidden
                  />
                  {advanced ? tc('hideAdvanced') : tc('showAdvanced')}
                </button>
                <AnimatePresence initial={false}>
                  {advanced && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: easeOut }}
                      className="overflow-hidden"
                    >
                      <div className="pt-4">
                        <FormField
                          control={form.control}
                          name="sortOrder"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{t('sortOrder')}</FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  inputMode="numeric"
                                  step={1}
                                  className="w-32"
                                  name={field.name}
                                  ref={field.ref}
                                  onBlur={field.onBlur}
                                  value={field.value ?? 0}
                                  onChange={(e) =>
                                    field.onChange(
                                      e.target.value === '' ? 0 : Math.trunc(Number(e.target.value)),
                                    )
                                  }
                                />
                              </FormControl>
                              <FormDescription>{t('sortOrderHint')}</FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              {form.formState.errors.root && (
                <p role="alert" className="text-sm text-destructive">
                  {form.formState.errors.root.message}
                </p>
              )}
            </SheetBody>
            <SheetFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {tc('cancel')}
              </Button>
              <Button type="submit" loading={mutation.isPending}>
                {editing ? tc('saveChanges') : tc('create')}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
