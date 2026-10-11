'use client';

import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, Layout, LayoutContent, LayoutFooter, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { Application } from '@isbp/contracts';
import { useCan } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { IconTile } from '@isbp/ui/icon-tile';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  KeyRoundIcon,
  PencilIcon,
  PlugIcon,
  ScanSearchIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UsersIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId, useState } from 'react';
import { DateTime } from '@/components/relative-time';
import { useApiMutation } from '@/lib/api';
import { useCanGlobal } from './app-parts';
import { ApplicationFormDialog } from './application-form';

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
          label={t('steps.permissions.action')}
          variant="ghost"
          size="sm"
          endContent={<Icon icon={ArrowRightIcon} />}
          onClick={() => onTab('permissions')}
        />
      ),
    },
    {
      icon: <ShieldCheckIcon />,
      title: t('steps.roles.title'),
      body: t('steps.roles.body', { count: app.counts.roles }),
      action: (
        <Button
          label={t('steps.roles.action')}
          variant="ghost"
          size="sm"
          endContent={<Icon icon={ArrowRightIcon} />}
          onClick={() => onTab('roles')}
        />
      ),
    },
    {
      icon: <UsersIcon />,
      title: t('steps.access.title'),
      body: t('steps.access.body', { count: app.counts.members }),
      action: (
        <Button
          label={t('steps.access.action')}
          variant="ghost"
          size="sm"
          endContent={<Icon icon={ArrowRightIcon} />}
          onClick={() => onTab('access')}
        />
      ),
    },
    {
      icon: <PlugIcon />,
      title: t('steps.clients.title'),
      body: t('steps.clients.body', { count: app.counts.clients }),
      action: canClients ? (
        <Button
          label={t('steps.clients.action')}
          variant="ghost"
          size="sm"
          endContent={<Icon icon={ArrowRightIcon} />}
          href="/admin/api-clients"
        />
      ) : canQuery ? (
        <Button
          label={t('steps.clients.tryIt')}
          variant="ghost"
          size="sm"
          icon={<Icon icon={ScanSearchIcon} />}
          onClick={() => onTab('query')}
        />
      ) : null,
    },
  ];

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="grid min-w-0 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>{t('details')}</CardTitle>
            <CardDescription>{t('detailsHint')}</CardDescription>
            {canManage && (
              <CardAction>
                <Button
                  label={tc('edit')}
                  variant="secondary"
                  size="sm"
                  icon={<Icon icon={PencilIcon} />}
                  onClick={() => setDialog('edit')}
                />
              </CardAction>
            )}
          </CardHeader>
          <CardContent>
            <MetadataList label={{ position: 'start', width: 112 }}>
              <MetadataListItem label={tc('name')}>{app.name}</MetadataListItem>
              <MetadataListItem label={tc('key')}>
                <Text type="code">{app.key}</Text>
              </MetadataListItem>
              <MetadataListItem label={tc('description')}>
                {app.description || <Text color="secondary">{t('none')}</Text>}
              </MetadataListItem>
              <MetadataListItem label={t('homepage')}>
                {app.homepageUrl ? (
                  <Link href={app.homepageUrl} isExternalLink maxLines={1}>
                    {app.homepageUrl}
                  </Link>
                ) : (
                  <Text color="secondary">{t('none')}</Text>
                )}
              </MetadataListItem>
              <MetadataListItem label={t('owner')}>
                {app.owner ? (
                  <HStack gap={2} vAlign="center">
                    <UserAvatar
                      name={app.owner.displayName}
                      src={app.owner.avatarUrl}
                      className="size-6 text-[10px]"
                    />
                    <Text maxLines={1}>{app.owner.displayName}</Text>
                  </HStack>
                ) : (
                  <Text color="secondary">{t('noOwner')}</Text>
                )}
              </MetadataListItem>
              <MetadataListItem label={tc('created_at')}>
                <DateTime date={app.createdAt} />
              </MetadataListItem>
              <MetadataListItem label={tc('updated_at')}>
                <DateTime date={app.updatedAt} />
              </MetadataListItem>
            </MetadataList>
          </CardContent>
        </Card>

        {canDelete && (
          <Card>
            <CardHeader>
              <CardTitle>{t('danger.title')}</CardTitle>
              <CardDescription>{t('danger.description')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Text color="secondary">
                {t('danger.summary', { roles: app.counts.roles, members: app.counts.members })}
              </Text>
              <Button
                label={t('danger.delete')}
                variant="destructive"
                icon={<Icon icon={Trash2Icon} />}
                onClick={() => setDialog('delete')}
              />
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
                <IconTile size="sm" aria-hidden>
                  {s.icon}
                </IconTile>
                <div className="min-w-0 flex-1">
                  <VStack gap={0.5}>
                    <Text weight="medium">{s.title}</Text>
                    <Text type="supporting">{s.body}</Text>
                    <HStack>{s.action}</HStack>
                  </VStack>
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
  const formId = useId();
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
  const consequences = [
    t('loseRoles', { count: app.counts.roles }),
    t('loseAccess', { count: app.counts.members }),
    t('loseQuery'),
  ];
  const close = (o: boolean) => {
    if (!o) setTyped('');
    onOpenChange(o);
  };
  return (
    <Dialog isOpen={open} onOpenChange={close} width={448} purpose="form">
      <Layout
        header={
          <DialogHeader
            title={t('confirmTitle', { name: app.name })}
            subtitle={t('confirmBody')}
            onOpenChange={close}
          />
        }
        content={
          <LayoutContent padding={4}>
            <VStack gap={4}>
              <VStack gap={1.5} role="list">
                {consequences.map((text) => (
                  <HStack key={text} gap={2} vAlign="start" role="listitem">
                    <Icon icon={AlertTriangleIcon} color="error" />
                    <StackItem size="fill">
                      <Text>{text}</Text>
                    </StackItem>
                  </HStack>
                ))}
              </VStack>
              <form
                id={formId}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (matches) del.mutate(undefined);
                }}
                noValidate
              >
                <TextInput
                  label={t.markup('typeKey', { key: app.key, code: (c) => c })}
                  value={typed}
                  onChange={setTyped}
                  autoComplete="off"
                  hasAutoFocus
                />
              </form>
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={3}>
            <HStack gap={2} hAlign="end">
              <Button
                label={tc('cancel')}
                variant="ghost"
                isDisabled={del.isPending}
                onClick={() => close(false)}
              />
              <Button
                label={t('confirm')}
                variant="destructive"
                icon={<Icon icon={Trash2Icon} />}
                isLoading={del.isPending}
                isDisabled={!matches}
                type="submit"
                form={formId}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
