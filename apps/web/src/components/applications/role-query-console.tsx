'use client';

import type {
  Application,
  AppPermission,
  RoleQueryCheckInput,
  RoleQueryCheckResult,
  RoleQueryResult,
} from '@isbp/contracts';
import { UserAvatar } from '@isbp/ui/avatar';
import { Badge } from '@isbp/ui/badge';
import { Button } from '@isbp/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { EmptyState } from '@isbp/ui/empty-state';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { Skeleton } from '@isbp/ui/skeleton';
import { Switch } from '@isbp/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import {
  AlertTriangleIcon,
  CircleCheckIcon,
  CircleXIcon,
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
import { type ReactNode, useId, useState } from 'react';
import { DepartmentSelect } from '@/components/pickers/department-select';
import { type PickedUser, UserPicker } from '@/components/pickers/user-picker';
import { RelativeTime } from '@/components/relative-time';
import { ExpiryCell, ScopeBadge } from '@/components/roles/assignment-parts';
import { useApiMutation, useApiQuery, useErrorText } from '@/lib/api';
import { CodeBlock, CopyButton, shellQuote, useOrigin } from './app-parts';
import { PermissionChip } from './app-permission-picker';

type QueryRole = RoleQueryResult['roles'][number];
type QueryScope = QueryRole['scope'];

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
      <Badge variant="outline" className="max-w-full font-normal">
        <UsersRoundIcon aria-hidden />
        <span className="truncate">{t('group', { name: role.group?.name ?? '?' })}</span>
      </Badge>
    );
  if (role.source === 'everyone')
    return (
      <Badge variant="outline" className="font-normal">
        <UsersIcon aria-hidden />
        {t('everyone')}
      </Badge>
    );
  return (
    <Badge variant="outline" className="font-normal">
      <UserIcon aria-hidden />
      {t('direct')}
    </Badge>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h3 className="flex items-baseline gap-2 text-sm font-medium">
        {title}
        {count !== undefined && <span className="text-xs text-muted-foreground tabular-nums">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

function ResultView({ result }: { result: RoleQueryResult }) {
  const t = useTranslations('applications.query');
  const tc = useTranslations('common');
  const u = result.user;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <UserAvatar name={u.displayName} className="size-10" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{u.displayName}</p>
          <p className="truncate text-xs text-muted-foreground">
            <code className="font-mono">{u.username}</code> · {u.email}
            {u.department && <> · {u.department.name}</>}
          </p>
        </div>
        <span className="text-xs text-muted-foreground">
          {t('evaluated')} <RelativeTime date={result.evaluatedAt} />
        </span>
      </div>

      {!result.active && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning-foreground"
        >
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t('inactive', {
            status: tc.has(`status_values.${u.status}`) ? tc(`status_values.${u.status}`) : u.status,
          })}
        </p>
      )}

      <Section title={t('roles')} count={result.roles.length}>
        {result.roles.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
            {t('noRoles', { app: result.application.name })}
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {result.roles.map((r, i) => (
              <motion.li
                key={`${r.key}-${r.scope.type}-${r.scope.departmentId}-${r.scope.recordId}-${r.group?.key}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="space-y-2 rounded-lg border bg-card p-3"
              >
                <div className="flex items-start gap-2.5">
                  <span
                    className="grid size-7 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"
                    aria-hidden
                  >
                    <ShieldCheckIcon className="size-3.5" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.name}</p>
                    <code className="block truncate font-mono text-xs text-muted-foreground">{r.key}</code>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <QueryScopeBadge scope={r.scope} />
                  <ViaBadge role={r} />
                  {r.expiresAt ? (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <ClockIcon className="size-3" aria-hidden />
                      <ExpiryCell expiresAt={r.expiresAt} expired={false} />
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{t('noExpiry')}</span>
                  )}
                </div>
              </motion.li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('permissions')} count={result.permissions.length}>
        {result.permissions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noPermissions')}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {result.permissions.map((p) => (
              <PermissionChip key={p} value={p} className="text-xs" />
            ))}
          </div>
        )}
      </Section>

      {result.scopedPermissions.length > 0 && (
        <Section title={t('scoped')} count={result.scopedPermissions.length}>
          <ul className="space-y-1.5">
            {result.scopedPermissions.map((s) => (
              <li
                key={`${s.permission}-${s.scope.type}-${s.scope.departmentId}-${s.scope.recordId}`}
                className="flex flex-wrap items-center gap-2 text-xs"
              >
                <PermissionChip value={s.permission} />
                <span className="text-muted-foreground">{t('within')}</span>
                <QueryScopeBadge scope={s.scope} />
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
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
  const [permission, setPermission] = useState('');
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const check = useApiMutation(
    (api, body: RoleQueryCheckInput) => api.post<RoleQueryCheckResult>('/role-query/check', body),
    { silent: true },
  );
  const result = check.data;
  const stale =
    result &&
    (result.user.id !== person?.id ||
      result.permission !== permission.trim() ||
      check.variables?.departmentId !== (departmentId ?? undefined));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const p = permission.trim();
        if (!person || !p) return;
        onChecked(p);
        check.mutate({
          user: person.id,
          application: app.key,
          permission: p,
          departmentId: departmentId ?? undefined,
        });
      }}
      className="space-y-4"
      noValidate
    >
      <div className="grid gap-2">
        <Label htmlFor={`${id}-perm`}>{t('permission')}</Label>
        <Input
          id={`${id}-perm`}
          list={`${id}-catalog`}
          value={permission}
          onChange={(e) => setPermission(e.target.value)}
          placeholder={catalog[0]?.key ?? 'invoices.approve'}
          spellCheck={false}
          autoComplete="off"
          className="font-mono text-sm"
        />
        <datalist id={`${id}-catalog`}>
          {catalog.map((p) => (
            <option key={p.id} value={p.key}>
              {p.description}
            </option>
          ))}
        </datalist>
        <p className="text-xs text-muted-foreground">{t('permissionHint')}</p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${id}-dept`}>{t('department')}</Label>
        <DepartmentSelect
          id={`${id}-dept`}
          value={departmentId}
          onChange={setDepartmentId}
          noneLabel={t('anyDepartment')}
        />
        <p className="text-xs text-muted-foreground">{t('departmentHint')}</p>
      </div>
      <Button
        type="submit"
        className="w-full"
        disabled={!person || !permission.trim()}
        loading={check.isPending}
      >
        <ScanSearchIcon /> {t('submit')}
      </Button>
      <div aria-live="polite" className="min-h-0">
        <AnimatePresence mode="wait" initial={false}>
          {check.error ? (
            <motion.p
              key="error"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              {errorText(check.error)}
            </motion.p>
          ) : result ? (
            <motion.div
              key={`${result.allowed}-${result.evaluatedAt}`}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 30 }}
              className={`space-y-2 rounded-lg border p-3 ${result.allowed ? 'border-success/30 bg-success/5' : 'border-destructive/30 bg-destructive/5'} ${stale ? 'opacity-60' : ''}`}
            >
              <p
                className={`flex items-center gap-2 font-medium ${result.allowed ? 'text-success' : 'text-destructive'}`}
              >
                {result.allowed ? (
                  <CircleCheckIcon className="size-5" aria-hidden />
                ) : (
                  <CircleXIcon className="size-5" aria-hidden />
                )}
                {result.allowed ? t('allowed') : t('denied')}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('summary', { user: result.user.username, permission: result.permission })}
              </p>
              {result.allowed && result.matchedRoles.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-muted-foreground">{t('matched')}</span>
                  {result.matchedRoles.map((r) => (
                    <Badge key={r} variant="outline" className="font-mono font-normal">
                      {r}
                    </Badge>
                  ))}
                </div>
              )}
              {stale && <p className="text-xs text-muted-foreground">{t('stale')}</p>}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
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
    <Tabs defaultValue="key">
      <TabsList className="w-full">
        <TabsTrigger value="key" className="flex-1">
          <KeyRoundIcon /> {t('apiKey')}
        </TabsTrigger>
        <TabsTrigger value="oauth" className="flex-1">
          <ShieldCheckIcon /> {t('oauth')}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="key" className="space-y-4">
        <p className="text-xs text-muted-foreground">{t('apiKeyHint')}</p>
        <CodeBlock code={snippets.user} label={t('user')} copyLabel={t('copy', { name: t('user') })} />
        <CodeBlock code={snippets.check} label={t('check')} copyLabel={t('copy', { name: t('check') })} />
        <CodeBlock
          code={snippets.members}
          label={t('members')}
          copyLabel={t('copy', { name: t('members') })}
        />
      </TabsContent>
      <TabsContent value="oauth" className="space-y-4">
        <p className="text-xs text-muted-foreground">{t('oauthHint')}</p>
        <CodeBlock code={snippets.token} label={t('token')} copyLabel={t('copy', { name: t('token') })} />
        <CodeBlock
          code={snippets.useToken}
          label={t('useToken')}
          copyLabel={t('copy', { name: t('useToken') })}
        />
      </TabsContent>
    </Tabs>
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
          <CardAction className="flex items-center gap-2">
            <Switch id={`${id}-raw`} checked={raw} onCheckedChange={setRaw} disabled={!result} />
            <Label htmlFor={`${id}-raw`} className="text-sm font-normal whitespace-nowrap">
              {t('raw')}
            </Label>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-2">
            <Label htmlFor={`${id}-person`}>{t('person')}</Label>
            <UserPicker
              id={`${id}-person`}
              value={person}
              onChange={setPerson}
              placeholder={t('personPlaceholder')}
              className="sm:max-w-md"
            />
          </div>
          <div aria-live="polite" aria-busy={query.isFetching || undefined}>
            {!person ? (
              <EmptyState
                icon={<UserSearchIcon />}
                title={t('empty.title')}
                description={t('empty.description', { app: app.name })}
                className="rounded-lg border border-dashed"
              />
            ) : query.error && !result ? (
              <EmptyState
                icon={<AlertTriangleIcon />}
                title={t('error')}
                description={errorText(query.error)}
                className="rounded-lg border border-dashed"
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
              <div className="relative">
                <pre className="max-h-[32rem] overflow-auto rounded-lg border bg-muted/40 p-3 pr-12 font-mono text-xs leading-relaxed">
                  <code>{json}</code>
                </pre>
                <CopyButton
                  value={json}
                  label={t('copyJson')}
                  className="absolute top-1.5 right-1.5 bg-background/80"
                />
              </div>
            ) : (
              <ResultView result={result} />
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <NetworkIcon className="size-4 text-muted-foreground" aria-hidden />
            {t('check.title')}
          </CardTitle>
          <CardDescription>
            {person ? t('check.hint', { name: person.displayName }) : t('check.pickFirst')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CheckForm
            app={app}
            person={person}
            catalog={catalog.data?.items ?? []}
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
