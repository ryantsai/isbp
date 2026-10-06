'use client';

import type { Application, AppPermission } from '@isbp/contracts';
import { useCan } from '@isbp/sdk/web';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { SearchInput } from '@isbp/ui/search-input';
import { Skeleton } from '@isbp/ui/skeleton';
import { toast } from '@isbp/ui/sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@isbp/ui/table';
import { Hint } from '@isbp/ui/tooltip';
import { AlertTriangleIcon, KeyRoundIcon, PlusIcon, SearchXIcon, Trash2Icon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useApiMutation, useApiQuery, useErrorText } from '@/lib/api';
import { APP_INVALIDATE } from './app-parts';

const KEY_RE = /^[a-z0-9][a-z0-9_:-]*(\.[a-z0-9][a-z0-9_:-]*){0,5}$/;

/** Inline "add a permission" form (key validated like `appPermissionKeySchema`). */
function AddPermission({ app, catalog }: { app: Application; catalog: readonly AppPermission[] }) {
  const t = useTranslations('applications.permissions');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const id = useId();
  const [key, setKey] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = useApiMutation(
    (api, body: { key: string; description: string }) =>
      api.post<{ items: AppPermission[] }>(`/applications/${app.id}/permissions`, body),
    {
      invalidate: APP_INVALIDATE,
      onSuccess: (_r, v) => {
        toast.success(t('added', { key: v.key }));
        setKey('');
        setDescription('');
        setError(null);
      },
      silent: true,
    },
  );
  const submit = () => {
    const k = key.trim();
    if (!k || k.length > 200 || !KEY_RE.test(k)) return setError(t('keyInvalid'));
    if (catalog.some((p) => p.key === k)) return setError(t('keyExists'));
    setError(null);
    add.mutate(
      { key: k, description: description.trim().slice(0, 500) },
      { onError: (err) => setError(errorText(err)) },
    );
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      noValidate
      className="grid gap-3 rounded-lg border border-dashed bg-muted/20 p-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] sm:items-start"
    >
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-key`} className="text-xs">
          {t('key')}
        </Label>
        <Input
          id={`${id}-key`}
          value={key}
          onChange={(e) => {
            setKey(e.target.value.toLowerCase());
            if (error) setError(null);
          }}
          placeholder="invoices.approve"
          spellCheck={false}
          autoComplete="off"
          className="font-mono text-sm"
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-hint`}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-desc`} className="text-xs">
          {tc('description')} <span className="font-normal text-muted-foreground">({tc('optional')})</span>
        </Label>
        <Input
          id={`${id}-desc`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('descriptionPlaceholder')}
          maxLength={500}
          autoComplete="off"
        />
      </div>
      <Button type="submit" loading={add.isPending} className="sm:mt-[1.375rem]">
        <PlusIcon /> {t('add')}
      </Button>
      <p
        id={`${id}-hint`}
        className={`text-xs sm:col-span-3 ${error ? 'text-destructive' : 'text-muted-foreground'}`}
        role={error ? 'alert' : undefined}
      >
        {error ?? t('keyHint')}
      </p>
    </form>
  );
}

/** Permissions tab: the catalog the app checks, with how many roles use each permission. */
export function AppPermissionsPanel({ app }: { app: Application }) {
  const t = useTranslations('applications.permissions');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const canManage = useCan('core.applications.manage', { recordType: 'application', recordId: app.id });
  const { data, isLoading } = useApiQuery<{ items: AppPermission[] }>(`/applications/${app.id}/permissions`);
  const [q, setQ] = useState('');
  const [removing, setRemoving] = useState<AppPermission | null>(null);
  const [last, setLast] = useState<AppPermission | null>(null);
  if (removing && removing !== last) setLast(removing);
  const shown = removing ?? last;

  const remove = useApiMutation(
    (api, p: AppPermission) => api.delete(`/applications/${app.id}/permissions/${p.id}`),
    {
      invalidate: APP_INVALIDATE,
      onSuccess: (_r, p) => {
        toast.success(t('removed', { key: p.key }));
        setRemoving(null);
      },
      silent: true,
    },
  );

  const items = data?.items ?? [];
  const needle = q.trim().toLowerCase();
  const rows = items.filter(
    (p) => !needle || p.key.includes(needle) || p.description.toLowerCase().includes(needle),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('hint')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {canManage && <AddPermission app={app} catalog={items} />}
        {items.length > 8 && <SearchInput value={q} onChange={setQ} delay={0} placeholder={t('search')} />}
        {isLoading ? (
          <div className="space-y-2" aria-busy>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={<KeyRoundIcon />} title={t('empty.title')} description={t('empty.description')} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<SearchXIcon />} title={t('noMatch', { q })} />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('columns.key')}</TableHead>
                  <TableHead className="hidden sm:table-cell">{tc('description')}</TableHead>
                  <TableHead className="text-right">{t('columns.roles')}</TableHead>
                  {canManage && (
                    <TableHead className="w-12">
                      <span className="sr-only">{tc('actions')}</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                <AnimatePresence initial={false}>
                  {rows.map((p) => (
                    <motion.tr
                      key={p.id}
                      layout
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="border-b transition-colors last:border-0 hover:bg-muted/50"
                    >
                      <TableCell className="max-w-64">
                        <code className="font-mono text-xs break-all">{p.key}</code>
                        <span className="mt-0.5 block text-xs text-muted-foreground sm:hidden">
                          {p.description || '—'}
                        </span>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">
                        {p.description || '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        {p.roleCount > 0 ? (
                          <Badge variant="muted" className="tabular-nums">
                            {t('usedBy', { count: p.roleCount })}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">{t('unused')}</span>
                        )}
                      </TableCell>
                      {canManage && (
                        <TableCell className="text-right">
                          <Hint label={t('remove')}>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t('removeLabel', { key: p.key })}
                              onClick={() => setRemoving(p)}
                              className="text-muted-foreground hover:text-destructive"
                            >
                              <Trash2Icon />
                            </Button>
                          </Hint>
                        </TableCell>
                      )}
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('removeTitle', { key: shown?.key ?? '' })}
        description={t('removeBody')}
        confirmLabel={t('remove')}
        destructive
        loading={remove.isPending}
        onConfirm={() =>
          removing && remove.mutate(removing, { onError: (err) => toast.error(errorText(err)) })
        }
      >
        {(shown?.roleCount ?? 0) > 0 && (
          <p className="flex items-start gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t('removeWarning', { count: shown?.roleCount ?? 0 })}
          </p>
        )}
      </ConfirmDialog>
    </Card>
  );
}
