'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { createDepartmentSchema, updateDepartmentSchema } from '@isbp/contracts';
import { ApiError } from '@isbp/sdk/web';
import { Form, FormField, fieldStatus } from '@isbp/ui/form';
import { countFilled, OptionalFields, useFieldList } from '@isbp/ui/optional-fields';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@isbp/ui/sheet';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { type FieldValues, type Resolver, type UseFormReturn, useForm, useWatch } from 'react-hook-form';
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
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Code } from '@astryxdesign/core/Code';
import { Field } from '@astryxdesign/core/Field';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector, SelectorOption } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';

type Values = z.input<typeof createDepartmentSchema>;

const NONE = '__none__';
export const DEPARTMENT_INVALIDATE = [
  '/departments',
  '/users',
  '/platform/dashboard',
  '/audit-logs',
  '/role-assignments',
];

/** Left inset per tree level (the spacing scale has no 14 px step). */
const INDENT = [0, 3, 6, 8, 10] as const;

/** Indented parent picker that disables the department being edited and its whole subtree. */
function ParentSelect({
  value,
  onChange,
  excludePath,
  description,
  status,
}: {
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  excludePath?: string;
  description?: string;
  status?: { type: 'error'; message: string };
}) {
  const t = useTranslations('departments.form');
  const { ordered, byId } = useDepartments();
  return (
    <Selector
      label={t('parent')}
      description={description}
      status={status}
      hasSearch
      value={value ?? NONE}
      onChange={(v) => onChange(v === NONE ? null : v)}
      options={[
        { value: NONE, label: t('parentNone') },
        { type: 'divider' },
        ...ordered.map((d) => ({
          value: d.id,
          label: d.name,
          disabled: Boolean(excludePath && d.path.startsWith(excludePath)),
        })),
      ]}
      renderOption={(o) => {
        const d = byId.get(o.value);
        if (!d) return <SelectorOption label={o.label ?? o.value} />;
        return (
          <SelectorOption
            layout="inline"
            label={
              <HStack
                gap={1.5}
                vAlign="center"
                paddingInlineStart={INDENT[Math.min(d.depth, INDENT.length - 1)]}
              >
                {d.depth > 0 && (
                  <span aria-hidden>
                    <Text color="secondary">└</Text>
                  </span>
                )}
                {d.name}
              </HStack>
            }
            endContent={<Code color="secondary">{d.code}</Code>}
          />
        );
      }}
    />
  );
}

/**
 * Create (no `department`; optional preset `parentId`) or edit / move a department. Simple by
 * default; the description and the sibling sort order sit behind "More details".
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
  const list = useFieldList();
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

  const [descriptionValue, sortOrderValue] = useWatch({
    control: form.control,
    name: ['description', 'sortOrder'],
  });
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
            <SheetBody className="py-2">
              <FormLayout defaultOptionality="optional">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field, fieldState }) => (
                    <TextInput
                      label={t('name')}
                      autoComplete="off"
                      placeholder={t('namePlaceholder')}
                      isRequired
                      value={field.value ?? ''}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      ref={field.ref}
                      status={fieldStatus(fieldState)}
                    />
                  )}
                />
                <FormField
                  control={form.control}
                  name="code"
                  render={({ field, fieldState }) => (
                    <TextInput
                      label={t('code')}
                      autoComplete="off"
                      placeholder={t('codePlaceholder')}
                      description={t('codeHint')}
                      isRequired
                      value={field.value ?? ''}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      ref={field.ref}
                      status={fieldStatus(fieldState)}
                    />
                  )}
                />
                <FormField
                  control={form.control}
                  name="parentId"
                  render={({ field, fieldState }) => (
                    <ParentSelect
                      value={field.value}
                      onChange={field.onChange}
                      excludePath={department?.path}
                      description={editing ? t('parentHint') : undefined}
                      status={fieldStatus(fieldState)}
                    />
                  )}
                />
                <Field label={t('manager')} inputID={managerId}>
                  <UserPicker
                    id={managerId}
                    value={manager}
                    placeholder={t('noManager')}
                    onChange={(m) => {
                      setManager(m);
                      form.setValue('managerId', m?.id ?? null, { shouldDirty: true });
                    }}
                  />
                </Field>
                <OptionalFields
                  hint={list([t('description'), t('sortOrder')])}
                  open={advanced}
                  onOpenChange={setAdvanced}
                  filled={countFilled(descriptionValue, sortOrderValue || '')}
                >
                  <VStack gap={4}>
                    <FormField
                      control={form.control}
                      name="description"
                      render={({ field, fieldState }) => (
                        <TextArea
                          label={t('description')}
                          rows={3}
                          placeholder={t('descriptionPlaceholder')}
                          value={field.value ?? ''}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          ref={field.ref}
                          status={fieldStatus(fieldState)}
                        />
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="sortOrder"
                      render={({ field, fieldState }) => (
                        <NumberInput
                          label={t('sortOrder')}
                          description={t('sortOrderHint')}
                          isIntegerOnly
                          width={160}
                          value={field.value ?? 0}
                          onChange={(v) => field.onChange(Math.trunc(v))}
                          onBlur={field.onBlur}
                          status={fieldStatus(fieldState)}
                        />
                      )}
                    />
                  </VStack>
                </OptionalFields>

                <CustomFieldsSection
                  elements={custom.elements}
                  form={form as unknown as UseFormReturn<FieldValues>}
                  className="pt-1"
                />
                {form.formState.errors.root && (
                  <Banner
                    status="error"
                    title={form.formState.errors.root.message ?? ''}
                    collapsible={false}
                  />
                )}
              </FormLayout>
            </SheetBody>
            <SheetFooter>
              <Button
                label={tc('cancel')}
                variant="secondary"
                type="button"
                onClick={() => onOpenChange(false)}
              />
              <Button
                label={editing ? tc('saveChanges') : tc('create')}
                variant="primary"
                isLoading={mutation.isPending}
                type="submit"
              />
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
