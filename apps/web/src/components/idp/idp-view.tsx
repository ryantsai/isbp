'use client';

import type { IdentityProvider } from '@isbp/contracts';
import { useCan } from '@isbp/sdk/web';
import { Button } from '@isbp/ui/button';
import { Card } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { FadeIn, Stagger, StaggerItem } from '@isbp/ui/motion';
import { PageHeader } from '@isbp/ui/page-header';
import { Skeleton } from '@isbp/ui/skeleton';
import { InfoIcon, KeyRoundIcon, PlusIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useApiQuery } from '@/lib/api';
import { IdpCard } from './idp-card';
import { IdpFormSheet } from './idp-form';
import { choiceOf, type IdpChoice } from './idp-meta';
import { TestConnectionDialog } from './test-dialog';
import { TypePickerDialog } from './type-picker';

function CardSkeleton() {
  return (
    <Card className="gap-0 py-0">
      <div className="flex items-start gap-3 p-5">
        <Skeleton className="size-10 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
        <Skeleton className="h-[1.15rem] w-8 rounded-full" />
      </div>
      <Skeleton className="h-14 rounded-none" />
      <div className="flex gap-2 p-5">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-20" />
      </div>
    </Card>
  );
}

/** `choice`/`provider` are kept after closing so the sheet doesn't change while it slides out. */
interface FormState {
  open: boolean;
  choice: IdpChoice;
  provider?: IdentityProvider;
}

export function IdpView() {
  const t = useTranslations('idp');
  const canManage = useCan('core.idp.manage');
  const [pollUntil, setPollUntil] = useState(0);
  const { data, isLoading } = useApiQuery<{ items: IdentityProvider[] }>('/identity-providers', undefined, {
    refetchInterval: pollUntil ? 3000 : undefined,
  });
  const items = data?.items ?? [];

  // After "Sync now", poll briefly so the result shows up without a reload.
  useEffect(() => {
    if (!pollUntil) return;
    const h = setTimeout(() => setPollUntil(0), Math.max(0, pollUntil - Date.now()));
    return () => clearTimeout(h);
  }, [pollUntil]);

  const [choosing, setChoosing] = useState(false);
  const [form, setForm] = useState<FormState>({ open: false, choice: 'entra' });
  const [testing, setTesting] = useState<IdentityProvider | null>(null);
  const [testOpen, setTestOpen] = useState(false);

  // Keep the edited provider fresh while its sheet is open.
  const editing = form.provider
    ? (items.find((p) => p.id === form.provider!.id) ?? form.provider)
    : undefined;

  const startCreate = (choice: IdpChoice) => {
    setChoosing(false);
    setForm({ open: true, choice });
  };
  const test = (p: IdentityProvider) => {
    setTesting(p);
    setTestOpen(true);
  };

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          canManage && (
            <Button onClick={() => setChoosing(true)}>
              <PlusIcon /> {t('add')}
            </Button>
          )
        }
      />

      {isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2" aria-busy>
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : items.length === 0 ? (
        <Card className="py-0">
          <EmptyState
            icon={<KeyRoundIcon />}
            title={t('empty.title')}
            description={t('empty.description')}
            action={
              canManage && (
                <Button onClick={() => setChoosing(true)}>
                  <PlusIcon /> {t('add')}
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <Stagger className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
          {items.map((p) => (
            <StaggerItem key={p.id} className="h-full min-w-0">
              <IdpCard
                idp={p}
                onEdit={() => setForm({ open: true, choice: choiceOf(p), provider: p })}
                onTest={() => test(p)}
                onSyncQueued={() => setPollUntil(Date.now() + 30_000)}
              />
            </StaggerItem>
          ))}
        </Stagger>
      )}

      <FadeIn delay={0.15} className="mt-6 flex items-start gap-2.5 text-sm text-muted-foreground">
        <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p className="max-w-3xl">{t('localNote')}</p>
      </FadeIn>

      {canManage && (
        <>
          <TypePickerDialog open={choosing} onOpenChange={setChoosing} onPick={startCreate} />
          <IdpFormSheet
            open={form.open}
            onOpenChange={(open) => setForm((f) => ({ ...f, open }))}
            choice={form.choice}
            provider={editing}
            onBack={() => {
              setForm((f) => ({ ...f, open: false }));
              setChoosing(true);
            }}
            onTest={test}
          />
          <TestConnectionDialog provider={testing} open={testOpen} onOpenChange={setTestOpen} />
        </>
      )}
    </>
  );
}
