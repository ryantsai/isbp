'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CodeBlock as JsonBlock } from '@astryxdesign/core/CodeBlock';
import { Field } from '@astryxdesign/core/Field';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Card as SurfaceCard } from '@astryxdesign/core/Card';
import { Switch } from '@astryxdesign/core/Switch';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Tokenizer } from '@astryxdesign/core/Tokenizer';
import { type SearchableItem, type SearchSource, TypeaheadItem } from '@astryxdesign/core/Typeahead';
import type {
  Application,
  AppPermission,
  RoleQueryCheckInput,
  RoleQueryCheckResult,
  RoleQueryResult,
} from '@isbp/contracts';
import { UserAvatar } from '@isbp/ui/avatar';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { IconTile } from '@isbp/ui/icon-tile';
import { Skeleton } from '@isbp/ui/skeleton';
import {
  AlertTriangleIcon,
  ClockIcon,
  KeyRoundIcon,
  NetworkIcon,
  ScanSearchIcon,
  ShieldCheckIcon,
  UserIcon,
  UserSearchIcon,
  UsersIcon,
  UsersRoundIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId, useMemo, useState } from 'react';
import { DepartmentSelect } from '@/components/pickers/department-select';
import { type PickedUser, UserPicker } from '@/components/pickers/user-picker';
import { RelativeTime } from '@/components/relative-time';
import { ExpiryCell, ScopeBadge } from '@/components/roles/assignment-parts';
import { useApiMutation, useApiQuery, useErrorText } from '@/lib/api';
import { CodeBlock, shellQuote, useOrigin } from './app-parts';
import { PermissionChip } from './app-permission-picker';

type QueryRole = RoleQueryResult['roles'][number];
type QueryScope = QueryRole['scope'];

const NO_PERMISSIONS: AppPermission[] = [];

/** Role Query scopes carry a department *code*; reuse the assignment scope badge. */
function QueryScopeBadge({ scope }: { scope: QueryScope }) {
  return (
    <ScopeBadge
      assignment={{
        scopeType: scope.type,
        scope: {
          departmentId: scope.departmentId,
          departmentName: scope.departmentCode,
          recordType: scope.recordType,
          recordId: scope.recordId,
        },
      }}
    />
  );
}

function ViaBadge({ role }: { role: QueryRole }) {
  const t = useTranslations('applications.query.via');
  if (role.source === 'group')
    return (
      <Badge
        variant="neutral"
        label={t('group', { name: role.group?.name ?? '?' })}
        icon={<Icon icon={UsersRoundIcon} size="xsm" />}
      />
    );
  if (role.source === 'everyone')
    return <Badge variant="neutral" label={t('everyone')} icon={<Icon icon={UsersIcon} size="xsm" />} />;
  return <Badge variant="neutral" label={t('direct')} icon={<Icon icon={UserIcon} size="xsm" />} />;
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <VStack gap={3} as="section">
      <HStack gap={2} vAlign="center">
        <Heading level={3} weight="medium">
          {title}
        </Heading>
        {count !== undefined && (
          <Text type="supporting" hasTabularNumbers>
            {count}
          </Text>
        )}
      </HStack>
      {children}
    </VStack>
  );
}

function ResultView({ result }: { result: RoleQueryResult }) {
  const t = useTranslations('applications.query');
  const tc = useTranslations('common');
  const u = result.user;
  return (
    <VStack gap={5}>
      <HStack gap={3} wrap="wrap" vAlign="center">
        <UserAvatar name={u.displayName} className="size-9" />
        <StackItem size="fill">
          <VStack>
            <Text weight="medium" maxLines={1}>
              {u.displayName}
            </Text>
            <Text type="supporting" maxLines={1}>
              <Text type="code">{u.username}</Text> · {u.email}
              {u.department && <> · {u.department.name}</>}
            </Text>
          </VStack>
        </StackItem>
        <Text type="supporting">
          {t('evaluated')} <RelativeTime date={result.evaluatedAt} />
        </Text>
      </HStack>

      {!result.active && (
        <div role="status">
          <Banner
            status="warning"
            title={t('inactive', {
              status: tc.has(`status_values.${u.status}`) ? tc(`status_values.${u.status}`) : u.status,
            })}
            collapsible={false}
          />
        </div>
      )}

      <Section title={t('roles')} count={result.roles.length}>
        {result.roles.length === 0 ? (
          <Text color="secondary">{t('noRoles', { app: result.application.name })}</Text>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {result.roles.map((r, i) => (
              <motion.li
                key={`${r.key}-${r.scope.type}-${r.scope.departmentId}-${r.scope.recordId}-${r.group?.key}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="min-w-0"
              >
                <SurfaceCard padding={3}>
                  <VStack gap={2}>
                    <HStack gap={3} vAlign="start">
                      <IconTile size="xs" aria-hidden>
                        <ShieldCheckIcon />
                      </IconTile>
                      <StackItem size="fill">
                        <VStack>
                          <Text weight="medium" maxLines={1}>
                            {r.name}
                          </Text>
                          <Text type="code" color="secondary" maxLines={1}>
                            {r.key}
                          </Text>
                        </VStack>
                      </StackItem>
                    </HStack>
                    <HStack gap={1.5} wrap="wrap" vAlign="center">
                      <QueryScopeBadge scope={r.scope} />
                      <ViaBadge role={r} />
                      {r.expiresAt ? (
                        <HStack gap={1} vAlign="center">
                          <Icon icon={ClockIcon} size="xsm" color="secondary" />
                          <ExpiryCell expiresAt={r.expiresAt} expired={false} />
                        </HStack>
                      ) : (
                        <Text type="supporting">{t('noExpiry')}</Text>
                      )}
                    </HStack>
                  </VStack>
                </SurfaceCard>
              </motion.li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('permissions')} count={result.permissions.length}>
        {result.permissions.length === 0 ? (
          <Text color="secondary">{t('noPermissions')}</Text>
        ) : (
          <HStack gap={1.5} wrap="wrap">
            {result.permissions.map((p) => (
              <PermissionChip key={p} value={p} />
            ))}
          </HStack>
        )}
      </Section>

      {result.scopedPermissions.length > 0 && (
        <Section title={t('scoped')} count={result.scopedPermissions.length}>
          <ul className="space-y-1.5">
            {result.scopedPermissions.map((s) => (
              <li key={`${s.permission}-${s.scope.type}-${s.scope.departmentId}-${s.scope.recordId}`}>
                <HStack gap={2} wrap="wrap" vAlign="center">
                  <PermissionChip value={s.permission} />
                  <Text type="supporting">{t('within')}</Text>
                  <QueryScopeBadge scope={s.scope} />
                </HStack>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </VStack>
  );
}

/** "Is X allowed to do Y (in department Z)?" — `POST /role-query/check`. */
function CheckForm({
  app,
  person,
  catalog,
  onChecked,
}: {
  app: Application;
  person: PickedUser | null;
  catalog: readonly AppPermission[];
  onChecked: (permission: string) => void;
}) {
  const t = useTranslations('applications.query.check');
  const errorText = useErrorText();
  const id = useId();
  // A key picked from the catalog (or created) is a token; text typed but not yet committed counts as well.
  const [picked, setPicked] = useState('');
  const [typed, setTyped] = useState('');
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const permission = (picked || typed).trim();
  const check = useApiMutation(
    (api, body: RoleQueryCheckInput) => api.post<RoleQueryCheckResult>('/role-query/check', body),
    { silent: true },
  );
  const result = check.data;
  const stale =
    result &&
    (result.user.id !== person?.id ||
      result.permission !== permission ||
      check.variables?.departmentId !== (departmentId ?? undefined));

  const source = useMemo<SearchSource<SearchableItem<string>>>(() => {
    const run = (q: string) => {
      const needle = q.trim().toLowerCase();
      return catalog
        .filter((p) => !needle || p.key.includes(needle) || p.description.toLowerCase().includes(needle))
        .map((p) => ({ id: p.key, label: p.key, auxiliaryData: p.description }));
    };
    return { search: run, bootstrap: () => run('') };
  }, [catalog]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!person || !permission) return;
        onChecked(permission);
        check.mutate({
          user: person.id,
          application: app.key,
          permission,
          departmentId: departmentId ?? undefined,
        });
      }}
      noValidate
    >
      <VStack gap={4}>
        <Tokenizer<SearchableItem<string>>
          label={t('permission')}
          description={t('permissionHint')}
          placeholder={catalog[0]?.key ?? 'invoices.approve'}
          searchSource={source}
          value={picked ? [{ id: picked, label: picked }] : []}
          onChange={(items) => {
            setPicked(items[0]?.id ?? '');
            setTyped('');
          }}
          onChangeQuery={setTyped}
          maxEntries={1}
          hasCreate
          hasEntriesOnFocus
          maxMenuItems={50}
          renderItem={(item) => <TypeaheadItem item={item} description={item.auxiliaryData || undefined} />}
        />
        <Field label={t('department')} inputID={`${id}-dept`} description={t('departmentHint')}>
          <DepartmentSelect
            id={`${id}-dept`}
            value={departmentId}
            onChange={setDepartmentId}
            noneLabel={t('anyDepartment')}
          />
        </Field>
        <Button
          label={t('submit')}
          variant="primary"
          icon={<Icon icon={ScanSearchIcon} />}
          isLoading={check.isPending}
          isDisabled={!person || !permission}
          type="submit"
          width="100%"
        />
        <div aria-live="polite">
          <AnimatePresence mode="wait" initial={false}>
            {check.error ? (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <Banner status="error" title={errorText(check.error)} collapsible={false} />
              </motion.div>
            ) : result ? (
              <motion.div
                key={`${result.allowed}-${result.evaluatedAt}`}
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: stale ? 0.6 : 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ type: 'spring', stiffness: 420, damping: 30 }}
              >
                <Banner
                  status={result.allowed ? 'success' : 'error'}
                  title={result.allowed ? t('allowed') : t('denied')}
                  description={t('summary', { user: result.user.username, permission: result.permission })}
                  collapsible={false}
                >
                  {((result.allowed && result.matchedRoles.length > 0) || stale) && (
                    <VStack gap={2}>
                      {result.allowed && result.matchedRoles.length > 0 && (
                        <HStack gap={1.5} wrap="wrap" vAlign="center">
                          <Text type="supporting">{t('matched')}</Text>
                          {result.matchedRoles.map((r) => (
                            <Badge variant="neutral" label={r} key={r} />
                          ))}
                        </HStack>
                      )}
                      {stale && <Text type="supporting">{t('stale')}</Text>}
                    </VStack>
                  )}
                </Banner>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </VStack>
    </form>
  );
}

/** Keeps readable values (usernames, emails, placeholders) as typed; encodes anything else. */
function pathSegment(value: string) {
  return /^[\w.@+<>-]+$/.test(value) ? value : encodeURIComponent(value);
}

/** Copy-ready curl calls for this app, using the current host. */
function Examples({ app, user, permission }: { app: Application; user: string; permission: string }) {
  const t = useTranslations('applications.query.examples');
  const panelId = useId();
  const [tab, setTab] = useState<'key' | 'oauth'>('key');
  const origin = useOrigin() || 'https://isbp.example.com';
  const base = `${origin}/api/v1`;
  const bearer = `-H "Authorization: Bearer <API key>"`;
  const userUrl = `${base}/role-query/users/${pathSegment(user)}?application=${app.key}`;
  const checkBody = JSON.stringify({ user, application: app.key, permission });
  const snippets = {
    user: `curl ${bearer} \\\n  "${userUrl}"`,
    check: `curl ${bearer} \\\n  -H "Content-Type: application/json" \\\n  -d ${shellQuote(checkBody)} \\\n  ${base}/role-query/check`,
    members: `curl ${bearer} \\\n  "${base}/role-query/applications/${app.key}/members?page=1&pageSize=100"`,
    token: `curl -u "<client id>:<client secret>" \\\n  -d grant_type=client_credentials -d scope=role-query \\\n  ${base}/oauth/token`,
    useToken: `curl -H "Authorization: Bearer <access_token>" \\\n  "${userUrl}"`,
  };
  return (
    <VStack gap={4}>
      <TabList
        role="tablist"
        aria-label={t('title')}
        value={tab}
        onChange={(v) => setTab(v === 'oauth' ? 'oauth' : 'key')}
        layout="fill"
      >
        <Tab value="key" label={t('apiKey')} icon={<Icon icon={KeyRoundIcon} />} panelId={panelId} />
        <Tab value="oauth" label={t('oauth')} icon={<Icon icon={ShieldCheckIcon} />} panelId={panelId} />
      </TabList>
      <div role="tabpanel" id={panelId} aria-label={tab === 'key' ? t('apiKey') : t('oauth')}>
        {tab === 'key' ? (
          <VStack gap={4}>
            <Text type="supporting">{t('apiKeyHint')}</Text>
            <CodeBlock code={snippets.user} label={t('user')} copyLabel={t('copy', { name: t('user') })} />
            <CodeBlock code={snippets.check} label={t('check')} copyLabel={t('copy', { name: t('check') })} />
            <CodeBlock
              code={snippets.members}
              label={t('members')}
              copyLabel={t('copy', { name: t('members') })}
            />
          </VStack>
        ) : (
          <VStack gap={4}>
            <Text type="supporting">{t('oauthHint')}</Text>
            <CodeBlock code={snippets.token} label={t('token')} copyLabel={t('copy', { name: t('token') })} />
            <CodeBlock
              code={snippets.useToken}
              label={t('useToken')}
              copyLabel={t('copy', { name: t('useToken') })}
            />
          </VStack>
        )}
      </div>
    </VStack>
  );
}

/**
 * Role Query console: pick a person and see exactly what `GET /role-query/users/:user?application=…`
 * returns for this app (or the raw JSON), check one permission, and copy ready-made requests.
 */
export function RoleQueryConsole({ app }: { app: Application }) {
  const t = useTranslations('applications.query');
  const errorText = useErrorText();
  const id = useId();
  const [person, setPerson] = useState<PickedUser | null>(null);
  const [raw, setRaw] = useState(false);
  const [lastPermission, setLastPermission] = useState<string | null>(null);
  const catalog = useApiQuery<{ items: AppPermission[] }>(`/applications/${app.id}/permissions`);
  const query = useApiQuery<RoleQueryResult>(
    person ? `/role-query/users/${encodeURIComponent(person.id)}` : null,
    {
      application: app.key,
    },
  );
  const result = person && query.data?.user.id === person.id ? query.data : undefined;
  const json = result ? JSON.stringify(result, null, 2) : '';
  const exampleUser = result?.user.username ?? person?.email ?? '<username>';
  const examplePermission = lastPermission ?? catalog.data?.items[0]?.key ?? 'invoices.approve';

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('hint', { app: app.name })}</CardDescription>
          <CardAction>
            <Switch label={t('raw')} value={raw} onChange={setRaw} isDisabled={!result} />
          </CardAction>
        </CardHeader>
        <CardContent>
          <VStack gap={5}>
            <div className="sm:max-w-md">
              <Field label={t('person')} inputID={`${id}-person`}>
                <UserPicker
                  id={`${id}-person`}
                  value={person}
                  onChange={setPerson}
                  placeholder={t('personPlaceholder')}
                />
              </Field>
            </div>
            <div aria-live="polite" aria-busy={query.isFetching || undefined}>
              {!person ? (
                <EmptyState
                  icon={<UserSearchIcon />}
                  title={t('empty.title')}
                  description={t('empty.description', { app: app.name })}
                />
              ) : query.error && !result ? (
                <EmptyState
                  icon={<AlertTriangleIcon />}
                  title={t('error')}
                  description={errorText(query.error)}
                />
              ) : !result ? (
                <div className="space-y-4" aria-busy>
                  <Skeleton className="h-10 w-64" />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Skeleton className="h-24" />
                    <Skeleton className="h-24" />
                  </div>
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : raw ? (
                <JsonBlock code={json} language="json" maxHeight={512} width="100%" />
              ) : (
                <ResultView result={result} />
              )}
            </div>
          </VStack>
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>
            <HStack gap={2} vAlign="center">
              <Icon icon={NetworkIcon} color="secondary" />
              {t('check.title')}
            </HStack>
          </CardTitle>
          <CardDescription>
            {person ? t('check.hint', { name: person.displayName }) : t('check.pickFirst')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CheckForm
            app={app}
            person={person}
            catalog={catalog.data?.items ?? NO_PERMISSIONS}
            onChecked={setLastPermission}
          />
        </CardContent>
      </Card>
      <Card className="min-w-0 xl:col-span-2">
        <CardHeader>
          <CardTitle>{t('examples.title')}</CardTitle>
          <CardDescription>{t('examples.hint')}</CardDescription>
        </CardHeader>
        <CardContent className="min-w-0">
          <Examples app={app} user={exampleUser} permission={examplePermission} />
        </CardContent>
      </Card>
    </div>
  );
}
