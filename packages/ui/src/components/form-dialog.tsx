'use client';

import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { HStack, Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import { type FormEvent, type ReactNode, useId } from 'react';
import { useOpened } from '../lib/use-opened';

/** Dialog widths: `sm` 448 px (a question or one field), `md` 512, `lg` 576, `xl` 672 (a record with many fields). */
const WIDTHS = { sm: 448, md: 512, lg: 576, xl: 672 } as const;

export interface FormDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  title: string;
  /** One line under the title. */
  subtitle?: string;
  size?: keyof typeof WIDTHS;
  /**
   * Submits the form. Without it the dialog is a plain task (no `<form>`): put your own action in `footer`, or just a
   * close button. The handler is a form submit handler, so `form.handleSubmit(...)` fits as is.
   */
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  /** Label of the primary button, e.g. `t('save')`. */
  submitLabel?: string;
  /** Label of the secondary button. Default: none, only the ✕ in the header (pass `t('cancel')` for forms). */
  cancelLabel?: string;
  /** `destructive` only when the dialog itself is the confirmation of a destructive action. */
  submitVariant?: 'primary' | 'destructive';
  /** Shows the spinner on the primary button and disables it. */
  isSubmitting?: boolean;
  isSubmitDisabled?: boolean;
  /**
   * Wrap the children in Astryx `FormLayout` (vertical field gaps) with this default: `required` when most fields are
   * required (mark the others `isOptional`), otherwise `optional` (mark the required ones `isRequired`). Omit when the
   * children bring their own layout.
   */
  defaultOptionality?: 'required' | 'optional';
  /** Left side of the footer (e.g. a secondary link-style action). */
  footerStart?: ReactNode;
  /** Default: `form` (Esc closes, a backdrop click doesn't) when there is a form, otherwise `info`. `required` blocks every exit but your own buttons (a secret shown once). */
  purpose?: 'form' | 'required' | 'info';
  children: ReactNode;
}

/**
 * A modal for filling in a few fields or doing one small task: the header, the scrolling content and the footer with
 * Cancel and the primary button. This is the one way to build a form dialog; don't re-assemble `Dialog` + `Layout` by
 * hand. More than ~4 fields or a long form is a `Sheet` (`@isbp/ui/sheet`); a plain yes/no is an Astryx `AlertDialog`.
 *
 * With react-hook-form, put the `Form` provider around it (context crosses the portal):
 *
 * ```tsx
 * <Form {...form}>
 *   <FormDialog isOpen={open} onOpenChange={setOpen} title={t('title')} onSubmit={onSubmit} submitLabel={t('save')}
 *     cancelLabel={tc('cancel')} isSubmitting={mutation.isPending} defaultOptionality="required">
 *     <FormField … />
 *   </FormDialog>
 * </Form>
 * ```
 */
export function FormDialog({
  isOpen,
  onOpenChange,
  title,
  subtitle,
  size = 'md',
  onSubmit,
  submitLabel,
  cancelLabel,
  submitVariant = 'primary',
  isSubmitting = false,
  isSubmitDisabled = false,
  defaultOptionality,
  footerStart,
  purpose,
  children,
}: FormDialogProps) {
  const formId = useId();
  const opened = useOpened(isOpen);
  if (!opened) return null;
  const body = defaultOptionality ? (
    <FormLayout defaultOptionality={defaultOptionality}>{children}</FormLayout>
  ) : (
    children
  );
  const hasFooter = Boolean(cancelLabel || (onSubmit && submitLabel) || footerStart);

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      width={WIDTHS[size]}
      purpose={purpose ?? (onSubmit ? 'form' : 'info')}
      // Astryx names a dialog from the header present when it mounts: say it here so a late-mounting caller still has a name.
      aria-label={title}
    >
      <Layout
        header={<DialogHeader title={title} subtitle={subtitle} onOpenChange={onOpenChange} />}
        content={
          <LayoutContent padding={4}>
            {onSubmit ? (
              <form id={formId} onSubmit={onSubmit} noValidate>
                {body}
              </form>
            ) : (
              body
            )}
          </LayoutContent>
        }
        footer={
          hasFooter ? (
            <LayoutFooter hasDivider padding={3}>
              <HStack gap={2} wrap="wrap" vAlign="center" hAlign={footerStart ? 'between' : 'end'}>
                {footerStart}
                <HStack gap={2} wrap="wrap" hAlign="end" className="ml-auto">
                  {cancelLabel ? (
                    <Button label={cancelLabel} variant="ghost" onClick={() => onOpenChange(false)} />
                  ) : null}
                  {onSubmit && submitLabel ? (
                    <Button
                      label={submitLabel}
                      variant={submitVariant}
                      type="submit"
                      form={formId}
                      isLoading={isSubmitting}
                      isDisabled={isSubmitDisabled}
                    />
                  ) : null}
                </HStack>
              </HStack>
            </LayoutFooter>
          ) : undefined
        }
      />
    </Dialog>
  );
}
