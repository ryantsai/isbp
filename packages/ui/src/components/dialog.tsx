'use client';

import { XIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn } from '../lib/utils';

export const Dialog = (props: React.ComponentProps<typeof DialogPrimitive.Root>) => (
  <DialogPrimitive.Root data-slot="dialog" {...props} />
);
export const DialogTrigger = (props: React.ComponentProps<typeof DialogPrimitive.Trigger>) => (
  <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
);
export const DialogClose = (props: React.ComponentProps<typeof DialogPrimitive.Close>) => (
  <DialogPrimitive.Close data-slot="dialog-close" {...props} />
);

export function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-(--motion-fast) data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-(--motion-base)',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Short forms (at most 4 fields) and single decisions. Longer record forms belong in a `Sheet`. The `DialogFooter`
 * sticks to the bottom while the content scrolls.
 */
export function DialogContent({
  className,
  children,
  showClose = true,
  closeLabel,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { showClose?: boolean; closeLabel?: string }) {
  const t = useTranslations('ui');
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'fixed top-[50%] left-[50%] z-50 grid max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-3 overflow-y-auto rounded-lg border bg-background p-5 shadow-xl outline-none sm:max-w-lg',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-98 data-[state=closed]:duration-(--motion-fast) data-[state=closed]:ease-exit data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-98 data-[state=open]:duration-(--motion-base) data-[state=open]:ease-enter',
          className,
        )}
        {...props}
      >
        {children}
        {showClose && (
          <DialogPrimitive.Close
            aria-label={closeLabel ?? t('close')}
            className="absolute top-2.5 right-2.5 grid size-8 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none [&_svg]:size-4"
          >
            <XIcon aria-hidden />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-1 pr-8 text-center sm:text-left', className)}
      {...props}
    />
  );
}

export function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        'sticky -bottom-5 z-10 -mx-5 -mb-5 flex flex-col-reverse gap-2 bg-background px-5 pt-3 pb-5 sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    />
  );
}

export function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-base leading-tight font-semibold', className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}
