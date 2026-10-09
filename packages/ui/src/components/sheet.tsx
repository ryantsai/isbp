'use client';

import { XIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Dialog as SheetPrimitive } from 'radix-ui';
import * as React from 'react';
import { cn } from '../lib/utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './alert-dialog';

export const Sheet = (props: React.ComponentProps<typeof SheetPrimitive.Root>) => (
  <SheetPrimitive.Root data-slot="sheet" {...props} />
);
export const SheetTrigger = (props: React.ComponentProps<typeof SheetPrimitive.Trigger>) => (
  <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
);
export const SheetClose = (props: React.ComponentProps<typeof SheetPrimitive.Close>) => (
  <SheetPrimitive.Close data-slot="sheet-close" {...props} />
);

/**
 * The panel. Record forms: `side="right"` with `className="sm:max-w-xl"`, a `SheetForm` holding `SheetBody` (scrolls)
 * and `SheetFooter` (stays at the bottom, so the primary action is visible on a phone). `dirty` asks "Discard
 * changes?" before Esc, a click outside or ✕ closes it.
 */
export function SheetContent({
  className,
  children,
  side = 'right',
  closeLabel,
  dirty = false,
  onEscapeKeyDown,
  onInteractOutside,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: 'top' | 'right' | 'bottom' | 'left';
  closeLabel?: string;
  /** The form has unsaved changes: confirm before closing by Esc, outside click or ✕. */
  dirty?: boolean;
}) {
  const t = useTranslations('ui');
  const [confirming, setConfirming] = React.useState(false);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-(--motion-base) data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-(--motion-slow)" />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        onEscapeKeyDown={(e) => {
          onEscapeKeyDown?.(e);
          if (dirty && !e.defaultPrevented) {
            e.preventDefault();
            setConfirming(true);
          }
        }}
        onInteractOutside={(e) => {
          onInteractOutside?.(e);
          if (dirty && !e.defaultPrevented) {
            e.preventDefault();
            setConfirming(true);
          }
        }}
        className={cn(
          'fixed z-50 flex flex-col gap-4 bg-background shadow-xl data-[state=closed]:animate-out data-[state=closed]:duration-(--motion-base) data-[state=closed]:ease-exit data-[state=open]:animate-in data-[state=open]:duration-(--motion-slow) data-[state=open]:ease-enter',
          side === 'right' &&
            'inset-y-0 right-0 h-full w-full border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-md',
          side === 'left' &&
            'inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm',
          side === 'top' &&
            'inset-x-0 top-0 h-auto border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top',
          side === 'bottom' &&
            'inset-x-0 bottom-0 h-auto border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
          className,
        )}
        {...props}
      >
        {children}
        {dirty ? (
          <>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className={closeButtonClass}
              aria-label={closeLabel ?? t('close')}
            >
              <XIcon aria-hidden />
            </button>
            <SheetPrimitive.Close ref={closeRef} hidden tabIndex={-1} />
          </>
        ) : (
          <SheetPrimitive.Close className={closeButtonClass} aria-label={closeLabel ?? t('close')}>
            <XIcon aria-hidden />
          </SheetPrimitive.Close>
        )}
        <AlertDialog open={confirming} onOpenChange={setConfirming}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('unsaved.title')}</AlertDialogTitle>
              <AlertDialogDescription>{t('unsaved.description')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('unsaved.keep')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setConfirming(false);
                  closeRef.current?.click();
                }}
              >
                {t('unsaved.discard')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

const closeButtonClass =
  'absolute top-3 right-3 grid size-9 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none [&_svg]:size-4';

export function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn('flex flex-col gap-1.5 p-5 pr-14 pb-0', className)}
      {...props}
    />
  );
}

/** A form that fills the sheet: put `SheetBody` and `SheetFooter` inside so the footer stays visible. */
export function SheetForm({ className, ...props }: React.ComponentProps<'form'>) {
  return (
    <form data-slot="sheet-form" className={cn('flex min-h-0 flex-1 flex-col gap-4', className)} {...props} />
  );
}

export function SheetBody({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="sheet-body" className={cn('min-h-0 flex-1 overflow-y-auto px-5', className)} {...props} />
  );
}

export function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn(
        'mt-auto flex flex-col-reverse gap-2 border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    />
  );
}

export function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn('text-lg font-semibold text-foreground', className)}
      {...props}
    />
  );
}

export function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}
