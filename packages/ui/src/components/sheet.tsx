'use client';

import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Dialog } from '@astryxdesign/core/Dialog';
import { Heading, Text } from '@astryxdesign/core/Text';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Icon } from '@astryxdesign/core/Icon';
import { XIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { cn } from '../lib/utils';

/*
 * Astryx has no side drawer, so `Sheet` is ours: a full-height panel docked to a screen edge, built on Astryx `Dialog`
 * (modal, focus trap, Esc, backdrop, `<dialog>` top layer) with the Dialog positioned flush to the edge. Record forms
 * open here (see docs/ai/ui-guidelines.md); everything inside is Astryx components.
 */

interface SheetContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  titleId: string;
  descriptionId: string;
}
const SheetContext = React.createContext<SheetContextValue | null>(null);
function useSheet(): SheetContextValue {
  const ctx = React.use(SheetContext);
  if (!ctx) throw new Error('Sheet parts must be rendered inside <Sheet>');
  return ctx;
}

export function Sheet({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  children,
}: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
}) {
  const [inner, setInner] = React.useState(defaultOpen);
  const open = openProp ?? inner;
  const setOpen = React.useCallback(
    (next: boolean) => {
      if (openProp === undefined) setInner(next);
      onOpenChange?.(next);
    },
    [openProp, onOpenChange],
  );
  const id = React.useId();
  const value = React.useMemo(
    () => ({ open, setOpen, titleId: `${id}-title`, descriptionId: `${id}-description` }),
    [open, setOpen, id],
  );
  return <SheetContext.Provider value={value}>{children}</SheetContext.Provider>;
}

/** Wires a child element (or a plain button) to open/close the sheet. */
function useToggle(next: boolean, child: React.ReactNode, asChild?: boolean) {
  const { setOpen } = useSheet();
  if (asChild && React.isValidElement<{ onClick?: (e: React.MouseEvent) => void }>(child)) {
    return React.cloneElement(child, {
      onClick: (e: React.MouseEvent) => {
        child.props.onClick?.(e);
        if (!e.defaultPrevented) setOpen(next);
      },
    });
  }
  return null;
}

export function SheetTrigger({
  asChild,
  children,
  ...props
}: React.ComponentProps<'button'> & { asChild?: boolean }) {
  const { setOpen } = useSheet();
  const cloned = useToggle(true, children, asChild);
  return (
    cloned ?? (
      <button type="button" {...props} onClick={(e) => (props.onClick?.(e), setOpen(true))}>
        {children}
      </button>
    )
  );
}

export function SheetClose({
  asChild,
  children,
  ...props
}: React.ComponentProps<'button'> & { asChild?: boolean }) {
  const { setOpen } = useSheet();
  const cloned = useToggle(false, children, asChild);
  return (
    cloned ?? (
      <button type="button" {...props} onClick={(e) => (props.onClick?.(e), setOpen(false))}>
        {children}
      </button>
    )
  );
}

/** Tailwind `max-w-*` steps (call sites size the panel with `sm:max-w-xl`) → the panel's width. */
const WIDTHS: Record<string, string> = {
  sm: '24rem',
  md: '28rem',
  lg: '32rem',
  xl: '36rem',
  '2xl': '42rem',
  '3xl': '48rem',
  '4xl': '56rem',
  '5xl': '64rem',
};
/** Where each edge's panel sits (logical offsets, so the panel mirrors under RTL). */
const POSITIONS = {
  right: { top: 0, bottom: 0, end: 0 },
  left: { top: 0, bottom: 0, start: 0 },
  bottom: { bottom: 0, start: 0, end: 0 },
  top: { top: 0, start: 0, end: 0 },
} as const;
function widthFrom(className?: string) {
  const steps = [...(className ?? '').matchAll(/(?:^|\s)(?:[a-z]+:)?max-w-(sm|md|lg|xl|[2-5]xl)(?=\s|$)/g)];
  return WIDTHS[steps.at(-1)?.[1] ?? 'md'];
}

/**
 * The panel. Record forms: `side="right"` with `className="sm:max-w-xl"` (the `max-w-*` step sizes it), a `SheetForm`
 * holding `SheetBody` (scrolls) and `SheetFooter` (stays at the bottom, so the primary action is visible on a phone).
 * `dirty` asks "Discard changes?" before Esc, a click outside or ✕ closes it.
 */
export function SheetContent({
  className,
  children,
  side = 'right',
  closeLabel,
  dirty = false,
  onOpenAutoFocus,
}: {
  className?: string;
  children?: React.ReactNode;
  side?: 'right' | 'left' | 'bottom' | 'top';
  closeLabel?: string;
  /** The form has unsaved changes: confirm before closing by Esc, outside click or ✕. */
  dirty?: boolean;
  /** Called as the sheet opens; `event.preventDefault()` keeps the default focus (the first field). */
  onOpenAutoFocus?: (event: Event) => void;
}) {
  const t = useTranslations('ui');
  const { open, setOpen, titleId, descriptionId } = useSheet();
  const [confirming, setConfirming] = React.useState(false);
  const edge = side === 'left' || side === 'right';
  const panel = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const event = new Event('sheet-open-autofocus', { cancelable: true });
      onOpenAutoFocus?.(event);
      if (event.defaultPrevented) return;
      const root = panel.current;
      const field = root?.querySelector<HTMLElement>(
        '[data-autofocus], input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [role=combobox]:not([disabled])',
      );
      (field ?? root?.querySelector<HTMLElement>('button:not([disabled])'))?.focus();
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const requestClose = (next: boolean) => {
    if (!next && dirty) setConfirming(true);
    else setOpen(next);
  };
  return (
    <>
      <Dialog
        isOpen={open}
        onOpenChange={requestClose}
        purpose={dirty ? 'form' : 'info'}
        padding={0}
        width={edge ? `min(${widthFrom(className)}, 100%)` : '100%'}
        maxHeight={edge ? '100dvh' : '85dvh'}
        position={POSITIONS[side]}
        // Astryx caps a standard dialog at the viewport minus a gutter on each side; a sheet is full-bleed on a phone.
        className="max-w-none"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        style={{ borderRadius: 0, margin: 0 }}
      >
        <div
          ref={panel}
          data-slot="sheet-content"
          className={cn(
            'relative flex min-h-0 flex-col gap-3 overflow-hidden',
            edge ? 'h-dvh' : 'max-h-[85dvh]',
            className,
          )}
        >
          {children}
          <IconButton
            label={closeLabel ?? t('close')}
            variant="ghost"
            size="sm"
            icon={<Icon icon={XIcon} size="sm" />}
            onClick={() => requestClose(false)}
            style={{ position: 'absolute', top: 10, insetInlineEnd: 10 }}
          />
        </div>
      </Dialog>
      <AlertDialog
        isOpen={confirming}
        onOpenChange={setConfirming}
        title={t('unsaved.title')}
        description={t('unsaved.description')}
        cancelLabel={t('unsaved.keep')}
        actionLabel={t('unsaved.discard')}
        onAction={() => {
          setConfirming(false);
          setOpen(false);
        }}
      />
    </>
  );
}

export function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn('flex flex-col gap-1 p-4 pr-12 pb-0', className)}
      {...props}
    />
  );
}

/** A form that fills the sheet: put `SheetBody` and `SheetFooter` inside so the footer stays visible. */
export function SheetForm({ className, ...props }: React.ComponentProps<'form'>) {
  return (
    <form data-slot="sheet-form" className={cn('flex min-h-0 flex-1 flex-col gap-3', className)} {...props} />
  );
}

export function SheetBody({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="sheet-body" className={cn('min-h-0 flex-1 overflow-y-auto px-4', className)} {...props} />
  );
}

export function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn(
        'mt-auto flex flex-col-reverse gap-2 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    />
  );
}

export function SheetTitle({ className, children }: { className?: string; children?: React.ReactNode }) {
  const { titleId } = useSheet();
  return (
    <Heading level={3} id={titleId} className={className}>
      {children}
    </Heading>
  );
}

export function SheetDescription({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  const { descriptionId } = useSheet();
  return (
    <Text as="p" color="secondary" id={descriptionId} className={className}>
      {children}
    </Text>
  );
}
