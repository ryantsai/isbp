'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid } from '@astryxdesign/core/Grid';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import type { Application, AppPermission } from '@isbp/contracts';
import { useCan } from '@isbp/sdk/web';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { SearchInput } from '@isbp/ui/search-input';
import { Skeleton } from '@isbp/ui/skeleton';
import { toast } from '@isbp/ui/toast';
import { KeyRoundIcon, PlusIcon, SearchXIcon, Trash2Icon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useApiMutation, useApiQuery, useErrorText } from '@/lib/api';
import { APP_INVALIDATE } from './app-parts';

const KEY_RE = /^[a-z0-9][a-z0-9_:-]*(\.[a-z0-9][a-z0-9_:-]*){0,5}$/;

/** Inline "add a permission" form (key validated like `appPermissionKeySchema`). */
function AddPermission({ app, catalog }: { app: Application; catalog: readonly AppPermission[] }) {
  const t = useTranslations('applications.permissions');
  const tc = useTranslations('common');
  const errorText = useErrorText();
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
    >
      <VStack gap={3}>
        <FormLayout defaultOptionality="required">
          <Grid columns={{ minWidth: 220 }} gap={3}>
            <TextInput
              label={t('key')}
              value={key}
              onChange={(v) => {
                setKey(v.toLowerCase());
                if (error) setError(null);
              }}
              placeholder="invoices.approve"
              autoComplete="off"
              status={error ? { type: 'error', message: error } : undefined}
            />
            <TextInput
              label={tc('description')}
              isOptional
              value={description}
              onChange={setDescription}
              placeholder={t('descriptionPlaceholder')}
              autoComplete="off"
            />
          </Grid>
        </FormLayout>
        <Text type="supporting">{t('keyHint')}</Text>
        <HStack hAlign="end">
          <Button
            label={t('add')}
            variant="primary"
            icon={<Icon icon={PlusIcon} />}
            isLoading={add.isPending}
            type="submit"
          />
        </HStack>
      </VStack>
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
          <Table density="compact" aria-label={t('title')}>
            <TableHeader>
              <TableRow isHeaderRow>
                <TableHeaderCell>{t('columns.key')}</TableHeaderCell>
                <TableHeaderCell className="hidden sm:table-cell">{tc('description')}</TableHeaderCell>
                <TableHeaderCell className="text-right">{t('columns.roles')}</TableHeaderCell>
                {canManage && (
                  <TableHeaderCell>
                    <span className="sr-only">{tc('actions')}</span>
                  </TableHeaderCell>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <VStack>
                      <Text type="code" wordBreak="break-all">
                        {p.key}
                      </Text>
                      <span className="sm:hidden">
                        <Text type="supporting">{p.description || '—'}</Text>
                      </span>
                    </VStack>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Text color="secondary">{p.description || '—'}</Text>
                  </TableCell>
                  <TableCell className="text-right">
                    {p.roleCount > 0 ? (
                      <Badge variant="neutral" label={t('usedBy', { count: p.roleCount })} />
                    ) : (
                      <Text type="supporting">{t('unused')}</Text>
                    )}
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <Tooltip content={t('remove')}>
                        <IconButton
                          label={t('removeLabel', { key: p.key })}
                          variant="ghost"
                          size="sm"
                          icon={<Icon icon={Trash2Icon} />}
                          onClick={() => setRemoving(p)}
                        />
                      </Tooltip>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
          <Banner
            status="warning"
            title={t('removeWarning', { count: shown?.roleCount ?? 0 })}
            collapsible={false}
          />
        )}
      </ConfirmDialog>
    </Card>
  );
}
