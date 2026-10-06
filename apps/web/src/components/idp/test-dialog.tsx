'use client';

import type { IdentityProvider, idpTestResultSchema } from '@isbp/contracts';
import { Button } from '@isbp/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@isbp/ui/dialog';
import { Spinner } from '@isbp/ui/spinner';
import { CircleCheckBigIcon, CircleXIcon, RotateCcwIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import type { z } from 'zod';
import { useApiMutation } from '@/lib/api';

type TestResult = z.input<typeof idpTestResultSchema>;

function detailValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

/** Runs `POST /identity-providers/:id/test` as soon as it opens and shows the outcome. */
export function TestConnectionDialog({
  provider,
  open,
  onOpenChange,
}: {
  provider: IdentityProvider | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('idp.test');
  const tc = useTranslations('common');
  const test = useApiMutation((api, id: string) => api.post<TestResult>(`/identity-providers/${id}/test`));
  const started = useRef<string | null>(null);

  useEffect(() => {
    if (!open || !provider) {
      started.current = null;
      return;
    }
    if (started.current === provider.id) return;
    started.current = provider.id;
    test.reset();
    test.mutate(provider.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, provider?.id]);

  const result = test.data;
  const state = test.isPending
    ? 'pending'
    : result
      ? result.ok
        ? 'ok'
        : 'failed'
      : test.isError
        ? 'error'
        : 'pending';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('title', { name: provider?.name ?? '' })}</DialogTitle>
          <DialogDescription>{t(`hint.${provider?.type ?? 'oidc'}`)}</DialogDescription>
        </DialogHeader>
        <div aria-live="polite" className="min-h-28">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={state}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
              className="space-y-3"
            >
              {state === 'pending' && (
                <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
                  <Spinner className="size-4" />
                  {t('running')}
                </div>
              )}
              {(state === 'ok' || state === 'failed') && result && (
                <>
                  <div
                    className={
                      state === 'ok'
                        ? 'flex items-start gap-3 rounded-lg border border-success/30 bg-success/8 p-4'
                        : 'flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/8 p-4'
                    }
                  >
                    <motion.span
                      initial={{ scale: 0.4 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 420, damping: 18 }}
                    >
                      {state === 'ok' ? (
                        <CircleCheckBigIcon className="size-5 text-success" />
                      ) : (
                        <CircleXIcon className="size-5 text-destructive" />
                      )}
                    </motion.span>
                    <div className="min-w-0 space-y-1">
                      <p className="font-medium">{state === 'ok' ? t('ok') : t('failed')}</p>
                      {state === 'failed' && (
                        <p className="font-mono text-xs break-words text-muted-foreground">
                          {result.message}
                        </p>
                      )}
                    </div>
                  </div>
                  {result.details && Object.keys(result.details).length > 0 && (
                    <dl className="divide-y rounded-lg border text-sm">
                      {Object.entries(result.details).map(([k, v]) => (
                        <div key={k} className="grid grid-cols-[minmax(0,9rem)_1fr] gap-3 px-3 py-2">
                          <dt className="text-muted-foreground">
                            {t.has(`details.${k}`) ? t(`details.${k}`) : k}
                          </dt>
                          <dd className="min-w-0 font-mono text-xs break-all">{detailValue(v)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </>
              )}
              {state === 'error' && (
                <p className="rounded-lg bg-destructive/8 p-4 text-sm text-destructive">{t('couldNotRun')}</p>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => provider && test.mutate(provider.id)}
            disabled={test.isPending || !provider}
          >
            <RotateCcwIcon /> {t('again')}
          </Button>
          <Button onClick={() => onOpenChange(false)}>{tc('close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
