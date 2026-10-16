'use client';

import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { ToastViewport, useToast } from '@astryxdesign/core/Toast';
import { CircleCheckIcon, CircleXIcon, InfoIcon, TriangleAlertIcon } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { attachToastHost } from '../lib/toast-host';

type ShowToast = ReturnType<typeof useToast>;

/** Options of `toast.*`. `action` is the "Undo" of a reversible quick action. */
export interface ToastOptions {
  /** A second line (an error's cause). */
  description?: ReactNode;
  action?: { label: string; onClick: () => void };
  /** Milliseconds before it goes away. Errors stay until dismissed unless you set one. */
  duration?: number;
  /** Showing the same id again replaces the toast instead of stacking another. */
  id?: string | number;
}

let show: ShowToast | null = null;
const queue: Array<(show: ShowToast) => void> = [];

/**
 * Connects the global `toast` function to Astryx's hook-based toasts. Mounted once by `UiProvider`; calls made before
 * it mounts are queued.
 */
export function ToastBridge() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const container = document.createElement('div');
    container.dataset.slot = 'toast-host';
    const detach = attachToastHost(container);
    setHost(container);
    return detach;
  }, []);
  return host
    ? createPortal(
        <ToastViewport>
          <ToastConnection />
        </ToastViewport>,
        host,
      )
    : null;
}

/** This connection must be inside our viewport, so it never creates Astryx's detached fallback root. */
function ToastConnection() {
  const showToast = useToast();
  useEffect(() => {
    show = showToast;
    for (const run of queue.splice(0)) run(showToast);
    return () => {
      if (show === showToast) show = null;
    };
  }, [showToast]);
  return null;
}

const ICONS = {
  success: CircleCheckIcon,
  info: InfoIcon,
  warning: TriangleAlertIcon,
  error: CircleXIcon,
} as const;

function emit(kind: keyof typeof ICONS, message: ReactNode, options: ToastOptions = {}) {
  const run = (showToast: ShowToast) =>
    showToast({
      type: kind === 'error' ? 'error' : 'info',
      body: (
        <HStack gap={2} vAlign="start">
          <Icon icon={ICONS[kind]} size="sm" />
          <VStack gap={0.5}>
            <Text>{message}</Text>
            {options.description ? (
              <Text type="supporting" color="secondary">
                {options.description}
              </Text>
            ) : null}
          </VStack>
        </HStack>
      ),
      endContent: options.action ? (
        <Button label={options.action.label} size="sm" variant="ghost" onClick={options.action.onClick} />
      ) : undefined,
      ...(options.duration ? { isAutoHide: true, autoHideDuration: options.duration } : {}),
      ...(options.id != null ? { uniqueID: String(options.id) } : {}),
    });
  if (show) run(show);
  else queue.push(run);
}

type Emit = (message: ReactNode, options?: ToastOptions) => void;
const make =
  (kind: keyof typeof ICONS): Emit =>
  (message, options) =>
    emit(kind, message, options);

/**
 * The app's transient feedback: `toast.success(t('saved'))`, `toast.error(t('failed'), { description })`. Backed by
 * Astryx `Toast` (info and error styles; success and warning differ by icon). Errors stay until dismissed; an error that
 * blocks the task also belongs inline, next to what failed. Offer Undo on reversible quick actions:
 * `toast.success(text, { action: { label: t('undo'), onClick } })`.
 */
export const toast = Object.assign(make('info'), {
  success: make('success'),
  info: make('info'),
  warning: make('warning'),
  error: make('error'),
});
