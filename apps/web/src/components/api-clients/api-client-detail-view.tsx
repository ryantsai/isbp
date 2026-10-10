'use client';

import type { ApiClient, ApiClientSecret, CreatedSecret } from '@isbp/contracts';
import { useCan } from '@isbp/sdk/web';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@isbp/ui/dialog';
import { EmptyState } from '@isbp/ui/empty-state';
import { FadeIn } from '@isbp/ui/motion';
import { Skeleton } from '@isbp/ui/skeleton';
import { toast } from '@isbp/ui/sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@isbp/ui/table';
import { Hint } from '@isbp/ui/tooltip';
import {
  ArrowLeftIcon,
  BanIcon,
  GlobeIcon,
  KeyRoundIcon,
  LockIcon,
  NetworkIcon,
  PencilIcon,
  PlugIcon,
  PlusIcon,
  ShieldIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useNow, useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DateTime, RelativeTime } from '@/components/relative-time';
import { AppTile, CopyButton } from '@/components/applications/app-parts';
import { useApiMutation, useApiQuery, useErrorText } from '@/lib/api';
import { CLIENT_INVALIDATE, ClientFormDialog } from './client-form-dialog';
import {
  ClientExamples,
  ClientStatusBadge,
  expiryDays,
  isExpiryValid,
  type SecretExpiry,
  SecretExpiryField,
  secretState,
  SecretStatusBadge,
} from './client-parts';
import { SecretRevealDialog } from './secret-reveal-dialog';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

/** "Add secret": choose its lifetime, then the new secret is revealed once. */
function AddSecretDialog({
  client,
  open,
  onOpenChange,
  onCreated,
}: {
  client: ApiClient;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (c: CreatedSecret) => void;
}) {
  const t = useTranslations('applications.clients.secrets');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const [choice, setChoice] = useState<SecretExpiry>('365');
  const [custom, setCustom] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const add = useApiMutation(
    (api, expiresInDays: number | null) =>
      api.post<CreatedSecret>(`/api-clients/${client.id}/secrets`, { expiresInDays }),
    {
      invalidate: CLIENT_INVALIDATE,
      onSuccess: (c) => {
        onOpenChange(false);
        onCreated(c);
      },
      silent: true,
    },
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setChoice('365');
          setCustom('');
          setSubmitted(false);
        }
        onOpenChange(o);
      }}
    >
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('addTitle')}</DialogTitle>
          <DialogDescription>{t('addDescription')}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(true);
            if (!isExpiryValid(choice, custom)) return;
            add.mutate(expiryDays(choice, custom), { onError: (err) => toast.error(errorText(err)) });
          }}
          className="space-y-5"
          noValidate
        >
          <SecretExpiryField
            choice={choice}
            custom={custom}
            onChoice={setChoice}
            onCustom={setCustom}
            showError={submitted}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" loading={add.isPending}>
              <KeyRoundIcon /> {t('generate')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SecretsCard({ client, onAdd }: { client: ApiClient; onAdd?: () => void }) {
  const t = useTranslations('applications.clients.secrets');
  const errorText = useErrorText();
  const now = useNow({ updateInterval: 60_000 });
  const [revoking, setRevoking] = useState<ApiClientSecret | null>(null);
  const [last, setLast] = useState<ApiClientSecret | null>(null);
  if (revoking && revoking !== last) setLast(revoking);
  const shown = revoking ?? last;
  const active = client.secrets.filter((s) => secretState(s, now.getTime()) === 'active').length;
  const revoke = useApiMutation(
    (api, s: ApiClientSecret) => api.delete<ApiClient>(`/api-clients/${client.id}/secrets/${s.id}`),
    {
      invalidate: CLIENT_INVALIDATE,
      onSuccess: (_r, s) => {
        toast.success(t('revoked', { prefix: s.prefix }));
        setRevoking(null);
      },
      silent: true,
    },
  );
  const secrets = [...client.secrets].reverse();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('hint')}</CardDescription>
        {onAdd && (
          <CardAction>
            <Button size="sm" onClick={onAdd}>
              <PlusIcon /> {t('add')}
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {secrets.length === 0 ? (
          <EmptyState icon={<KeyRoundIcon />} title={t('empty')} className="py-6" />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('columns.secret')}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t('columns.created')}</TableHead>
                  <TableHead>{t('columns.expires')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('columns.lastUsed')}</TableHead>
                  <TableHead>{t('columns.status')}</TableHead>
                  {onAdd && (
                    <TableHead className="w-12">
                      <span className="sr-only">{t('columns.actions')}</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                <AnimatePresence initial={false}>
                  {secrets.map((s) => {
                    const state = secretState(s, now.getTime());
                    return (
                      <motion.tr
                        key={s.id}
                        layout
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`border-b transition-colors last:border-0 hover:bg-muted/50 ${state !== 'active' ? 'text-muted-foreground' : ''}`}
                      >
                        <TableCell>
                          <code className="font-mono text-xs">{s.prefix}…</code>
                        </TableCell>
                        <TableCell className="hidden whitespace-nowrap sm:table-cell">
                          <RelativeTime date={s.createdAt} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {s.expiresAt ? (
                            <RelativeTime date={s.expiresAt} />
                          ) : (
                            <span>{t('neverExpires')}</span>
                          )}
                        </TableCell>
                        <TableCell className="hidden whitespace-nowrap md:table-cell">
                          <RelativeTime date={s.lastUsedAt} />
                        </TableCell>
                        <TableCell>
                          <SecretStatusBadge secret={s} />
                        </TableCell>
                        {onAdd && (
                          <TableCell className="text-right">
                            {state === 'active' && (
                              <Hint label={t('revoke')}>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={t('revokeLabel', { prefix: s.prefix })}
                                  onClick={() => setRevoking(s)}
                                  className="text-muted-foreground hover:text-destructive"
                                >
                                  <BanIcon />
                                </Button>
                              </Hint>
                            )}
                          </TableCell>
                        )}
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={t('revokeTitle', { prefix: shown?.prefix ?? '' })}
        description={active <= 1 ? t('revokeLastBody') : t('revokeBody')}
        confirmLabel={t('revoke')}
        destructive
        loading={revoke.isPending}
        onConfirm={() =>
          revoking && revoke.mutate(revoking, { onError: (err) => toast.error(errorText(err)) })
        }
      />
    </Card>
  );
}

export function ApiClientDetailView({ id }: { id: string }) {
  const t = useTranslations('applications.clients');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const canManage = useCan('core.api-clients.manage');
  const { data: client, isLoading, error } = useApiQuery<ApiClient>(canManage ? `/api-clients/${id}` : null);
  const [dialog, setDialog] = useState<'edit' | 'secret' | 'revoke' | null>(null);
  const [created, setCreated] = useState<CreatedSecret | null>(null);
  const revoke = useApiMutation((api) => api.post<ApiClient>(`/api-clients/${id}/revoke`), {
    invalidate: CLIENT_INVALIDATE,
    success: t('detail.revoked'),
    onSuccess: () => setDialog(null),
    silent: true,
  });

  const back = (
    <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
      <Link href="/admin/api-clients">
        <ArrowLeftIcon /> {t('title')}
      </Link>
    </Button>
  );

  if (!canManage) {
    return (
      <div className="space-y-5">
        {back}
        <EmptyState
          icon={<LockIcon />}
          title={t('forbidden.title')}
          description={t('forbidden.description')}
        />
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className="space-y-5" aria-busy>
        {back}
        <div className="flex items-center gap-4">
          <Skeleton className="size-14 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-72" />
          </div>
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }
  if (error || !client) {
    return (
      <div className="space-y-5">
        {back}
        <EmptyState icon={<PlugIcon />} title={t('detail.notFound')} />
      </div>
    );
  }

  const revoked = Boolean(client.revokedAt);

  return (
    <div className="space-y-5">
      {back}
      <FadeIn y={4} className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <span
          className={`grid size-14 shrink-0 place-items-center rounded-xl ${revoked ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'}`}
          aria-hidden
        >
          <PlugIcon className="size-6" />
        </span>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 truncate text-xl font-semibold tracking-tight">{client.name}</h1>
            <ClientStatusBadge client={client} />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span className="sr-only">{t('detail.clientId')}</span>
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{client.clientId}</code>
              <CopyButton value={client.clientId} label={t('detail.copyClientId')} className="size-7" />
            </span>
            <span>
              {t('detail.lastUsed')} <RelativeTime date={client.lastUsedAt} />
              {client.lastUsedIp && (
                <>
                  {' · '}
                  <code className="font-mono text-xs">{client.lastUsedIp}</code>
                </>
              )}
            </span>
          </div>
          {client.description && (
            <p className="max-w-3xl text-sm text-muted-foreground">{client.description}</p>
          )}
        </div>
        {!revoked && (
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" onClick={() => setDialog('edit')}>
              <PencilIcon /> {tc('edit')}
            </Button>
          </div>
        )}
      </FadeIn>

      {revoked && (
        <FadeIn
          delay={0.05}
          className="flex items-start gap-3 rounded-lg border bg-muted/40 px-4 py-3 text-sm"
        >
          <BanIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p>
            <span className="font-medium">
              {t('detail.revokedTitle')} <DateTime date={client.revokedAt} />.
            </span>{' '}
            <span className="text-muted-foreground">{t('detail.revokedNotice')}</span>
          </p>
        </FadeIn>
      )}

      <div className="grid min-w-0 grid-cols-1 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>{t('detail.reach')}</CardTitle>
            <CardDescription>{t('detail.reachHint')}</CardDescription>
            {!revoked && (
              <CardAction>
                <Button variant="outline" size="sm" onClick={() => setDialog('edit')}>
                  <PencilIcon /> {tc('edit')}
                </Button>
              </CardAction>
            )}
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4">
              <Field label={t('detail.applications')}>
                {client.allApplications ? (
                  <Badge variant="info">
                    <GlobeIcon aria-hidden />
                    {t('allApplications')}
                  </Badge>
                ) : client.applications.length === 0 ? (
                  <span className="text-muted-foreground">{t('noApplications')}</span>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {client.applications.map((a) => (
                      <li key={a.id}>
                        <Link
                          href={`/admin/applications/${a.id}`}
                          className="inline-flex items-center gap-2 rounded-md border py-1 pr-2.5 pl-1 text-sm transition-colors hover:bg-muted"
                        >
                          <AppTile
                            app={{ ...a, isSystem: a.key === 'isbp' }}
                            size="sm"
                            className="size-6 text-[9px]"
                          />
                          {a.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Field>
              <Field label={t('detail.permissions')}>
                {client.permissions.length === 0 ? (
                  <span className="text-muted-foreground">{t('detail.noPermissions')}</span>
                ) : (
                  <span className="flex flex-wrap gap-1">
                    {client.permissions.map((p) => (
                      <code key={p} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                        {p}
                      </code>
                    ))}
                  </span>
                )}
              </Field>
              <Field label={t('detail.cidrs')}>
                {client.allowedCidrs.length === 0 ? (
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <NetworkIcon className="size-3.5" aria-hidden />
                    {t('detail.anyIp')}
                  </span>
                ) : (
                  <span className="flex flex-wrap gap-1">
                    {client.allowedCidrs.map((c) => (
                      <code key={c} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                        {c}
                      </code>
                    ))}
                  </span>
                )}
              </Field>
              <Field label={tc('created_at')}>
                <DateTime date={client.createdAt} />
                {client.createdBy && (
                  <span className="text-muted-foreground">
                    {' '}
                    · {t('detail.by', { name: client.createdBy.displayName })}
                  </span>
                )}
              </Field>
            </dl>
          </CardContent>
        </Card>

        <SecretsCard client={client} onAdd={revoked ? undefined : () => setDialog('secret')} />

        {!revoked && (
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>{t('detail.examples')}</CardTitle>
              <CardDescription>{t('detail.examplesHint')}</CardDescription>
            </CardHeader>
            <CardContent className="min-w-0">
              <ClientExamples client={client} />
            </CardContent>
          </Card>
        )}

        {!revoked && (
          <Card className="border-destructive/30">
            <CardHeader>
              <CardTitle className="text-destructive">{t('detail.dangerTitle')}</CardTitle>
              <CardDescription>{t('detail.dangerHint')}</CardDescription>
              <CardAction>
                <Button variant="destructive" onClick={() => setDialog('revoke')}>
                  <ShieldIcon /> {t('detail.revoke')}
                </Button>
              </CardAction>
            </CardHeader>
          </Card>
        )}
      </div>

      {!revoked && (
        <>
          <ClientFormDialog
            open={dialog === 'edit'}
            onOpenChange={(o) => setDialog(o ? 'edit' : null)}
            client={client}
          />
          <AddSecretDialog
            client={client}
            open={dialog === 'secret'}
            onOpenChange={(o) => setDialog(o ? 'secret' : null)}
            onCreated={setCreated}
          />
        </>
      )}
      <SecretRevealDialog created={created} onDone={() => setCreated(null)} rotated />
      <ConfirmDialog
        open={dialog === 'revoke'}
        onOpenChange={(o) => setDialog(o ? 'revoke' : null)}
        title={t('detail.revokeTitle', { name: client.name })}
        description={t('detail.revokeBody')}
        confirmLabel={t('detail.revoke')}
        destructive
        loading={revoke.isPending}
        onConfirm={() => revoke.mutate(undefined, { onError: (err) => toast.error(errorText(err)) })}
      />
    </div>
  );
}
