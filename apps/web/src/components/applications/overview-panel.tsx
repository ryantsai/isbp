'use client';

import type { Application } from '@isbp/contracts';
import { useCan } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
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
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  PencilIcon,
  PlugIcon,
  ScanSearchIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UsersIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId, useState } from 'react';
import { DateTime } from '@/components/relative-time';
import { useApiMutation } from '@/lib/api';
import { useCanGlobal } from './app-parts';
import { ApplicationFormDialog } from './application-form';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

/** Overview tab: details (editable), how the app plugs in, and the danger zone. */
export function AppOverviewPanel({ app, onTab }: { app: Application; onTab: (tab: string) => void }) {
  const t = useTranslations('applications.overview');
  const tc = useTranslations('common');
  const canManage = useCan('core.applications.manage', { recordType: 'application', recordId: app.id });
  const canDelete = useCanGlobal('core.applications.manage');
  const canClients = useCan('core.api-clients.manage');
  const canQuery = useCan('core.role-query.read', { recordType: 'application', recordId: app.id });
  const [dialog, setDialog] = useState<'edit' | 'delete' | null>(null);

  const steps: { icon: ReactNode; title: string; body: string; action: ReactNode }[] = [
    {
      icon: <KeyRoundIcon />,
      title: t('steps.permissions.title'),
      body: t('steps.permissions.body', { count: app.counts.permissions }),
      action: (
        <Button
          variant="link"
          size="sm"
          className="h-auto px-0 has-[>svg]:px-0"
          onClick={() => onTab('permissions')}
        >
          {t('steps.permissions.action')} <ArrowRightIcon />
        </Button>
      ),
    },
    {
      icon: <ShieldCheckIcon />,
      title: t('steps.roles.title'),
      body: t('steps.roles.body', { count: app.counts.roles }),
      action: (
        <Button
          variant="link"
          size="sm"
          className="h-auto px-0 has-[>svg]:px-0"
          onClick={() => onTab('roles')}
        >
          {t('steps.roles.action')} <ArrowRightIcon />
        </Button>
      ),
    },
    {
      icon: <UsersIcon />,
      title: t('steps.access.title'),
      body: t('steps.access.body', { count: app.counts.members }),
      action: (
        <Button
          variant="link"
          size="sm"
          className="h-auto px-0 has-[>svg]:px-0"
          onClick={() => onTab('access')}
        >
          {t('steps.access.action')} <ArrowRightIcon />
        </Button>
      ),
    },
    {
      icon: <PlugIcon />,
      title: t('steps.clients.title'),
      body: t('steps.clients.body', { count: app.counts.clients }),
      action: canClients ? (
        <Button variant="link" size="sm" asChild className="h-auto px-0 has-[>svg]:px-0">
          <Link href="/admin/api-clients">
            {t('steps.clients.action')} <ArrowRightIcon />
          </Link>
        </Button>
      ) : canQuery ? (
        <Button
          variant="link"
          size="sm"
          className="h-auto px-0 has-[>svg]:px-0"
          onClick={() => onTab('query')}
        >
          <ScanSearchIcon /> {t('steps.clients.tryIt')}
        </Button>
      ) : null,
    },
  ];

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('details')}</CardTitle>
            <CardDescription>{t('detailsHint')}</CardDescription>
            {canManage && (
              <CardAction>
                <Button variant="outline" size="sm" onClick={() => setDialog('edit')}>
                  <PencilIcon /> {tc('edit')}
                </Button>
              </CardAction>
            )}
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4">
              <Field label={tc('name')}>{app.name}</Field>
              <Field label={tc('key')}>
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{app.key}</code>
              </Field>
              <Field label={tc('description')}>
                {app.description || <span className="text-muted-foreground">{t('none')}</span>}
              </Field>
              <Field label={t('homepage')}>
                {app.homepageUrl ? (
                  <a
                    href={app.homepageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex max-w-full items-center gap-1.5 text-primary hover:underline"
                  >
                    <span className="truncate">{app.homepageUrl}</span>
                    <ExternalLinkIcon className="size-3.5 shrink-0" aria-hidden />
                  </a>
                ) : (
                  <span className="text-muted-foreground">{t('none')}</span>
                )}
              </Field>
              <Field label={t('owner')}>
                {app.owner ? (
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <UserAvatar
                      name={app.owner.displayName}
                      src={app.owner.avatarUrl}
                      className="size-6 text-[10px]"
                    />
                    <span className="truncate">{app.owner.displayName}</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">{t('noOwner')}</span>
                )}
              </Field>
              <Field label={tc('created_at')}>
                <DateTime date={app.createdAt} />
              </Field>
              <Field label={tc('updated_at')}>
                <DateTime date={app.updatedAt} />
              </Field>
            </dl>
          </CardContent>
        </Card>

        {canDelete && (
          <Card className="border-destructive/30">
            <CardHeader>
              <CardTitle className="text-destructive">{t('danger.title')}</CardTitle>
              <CardDescription>{t('danger.description')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                {t('danger.summary', { roles: app.counts.roles, members: app.counts.members })}
              </p>
              <Button variant="destructive" className="shrink-0" onClick={() => setDialog('delete')}>
                <Trash2Icon /> {t('danger.delete')}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('howTitle')}</CardTitle>
          <CardDescription>{t('howHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="relative space-y-5">
            {steps.map((s, i) => (
              <li key={s.title} className="relative flex gap-3">
                {i < steps.length - 1 && (
                  <span className="absolute top-9 bottom-[-1.25rem] left-4 w-px bg-border" aria-hidden />
                )}
                <span
                  className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary [&_svg]:size-4"
                  aria-hidden
                >
                  {s.icon}
                </span>
                <div className="min-w-0 space-y-0.5 pt-1">
                  <p className="text-sm font-medium">{s.title}</p>
                  <p className="text-xs text-muted-foreground">{s.body}</p>
                  {s.action}
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {canManage && (
        <ApplicationFormDialog
          open={dialog === 'edit'}
          onOpenChange={(o) => setDialog(o ? 'edit' : null)}
          app={app}
        />
      )}
      {canDelete && (
        <DeleteApplicationDialog
          app={app}
          open={dialog === 'delete'}
          onOpenChange={(o) => setDialog(o ? 'delete' : null)}
        />
      )}
    </div>
  );
}

/** Type-the-key confirmation: deleting removes the app's roles and every grant of them. */
function DeleteApplicationDialog({
  app,
  open,
  onOpenChange,
}: {
  app: Application;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('applications.overview.danger');
  const tc = useTranslations('common');
  const router = useRouter();
  const client = useQueryClient();
  const id = useId();
  const [typed, setTyped] = useState('');
  const matches = typed.trim() === app.key;
  const del = useApiMutation((api) => api.delete(`/applications/${app.id}`), {
    // Mark the app's own queries stale without refetching, so this page never flashes "not found".
    invalidate: ['/api-clients', '/role-query', '/audit-logs', '/platform/dashboard', '/requests'],
    success: t('deleted', { name: app.name }),
    onSuccess: () => {
      onOpenChange(false);
      router.push('/admin/applications');
      void client.invalidateQueries({
        predicate: (q) => typeof q.queryKey[0] === 'string' && q.queryKey[0].startsWith('/applications'),
        refetchType: 'none',
      });
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setTyped('');
        onOpenChange(o);
      }}
    >
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('confirmTitle', { name: app.name })}</DialogTitle>
          <DialogDescription>{t('confirmBody')}</DialogDescription>
        </DialogHeader>
        <ul className="space-y-1.5 rounded-md bg-destructive/5 px-4 py-3 text-sm">
          <li className="flex items-start gap-2">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
            {t('loseRoles', { count: app.counts.roles })}
          </li>
          <li className="flex items-start gap-2">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
            {t('loseAccess', { count: app.counts.members })}
          </li>
          <li className="flex items-start gap-2">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
            {t('loseQuery')}
          </li>
        </ul>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (matches) del.mutate(undefined);
          }}
          className="space-y-4"
        >
          <div className="grid gap-2">
            <Label htmlFor={`${id}-key`} className="font-normal">
              {t.rich('typeKey', {
                key: app.key,
                code: (c) => <code className="font-mono font-semibold">{c}</code>,
              })}
            </Label>
            <Input
              id={`${id}-key`}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={del.isPending}
            >
              {tc('cancel')}
            </Button>
            <Button type="submit" variant="destructive" disabled={!matches} loading={del.isPending}>
              <Trash2Icon /> {t('confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
