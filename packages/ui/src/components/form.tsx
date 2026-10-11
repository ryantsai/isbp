'use client';

import {
  Controller,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
  FormProvider,
} from 'react-hook-form';

/**
 * React Hook Form bindings for Astryx inputs. An Astryx input draws its own label, hint and error, so a form field is
 * one component: render it inside `FormField` and map the state with `fieldStatus` (see docs/ai/ui-components.md → Forms).
 */
export const Form = FormProvider;

export function FormField<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>(props: ControllerProps<TFieldValues, TName>) {
  return <Controller {...props} />;
}

/**
 * The `status` prop of an Astryx input for a react-hook-form field: `status={fieldStatus(fieldState)}` inside a
 * `FormField` render.
 */
export function fieldStatus(state: {
  error?: { message?: string };
}): { type: 'error'; message: string } | undefined {
  return state.error ? { type: 'error', message: String(state.error.message ?? '') } : undefined;
}
