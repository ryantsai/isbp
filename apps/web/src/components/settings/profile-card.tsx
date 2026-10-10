'use client';

import { type Me, updateMeSchema } from '@isbp/contracts';
import { usePlatform } from '@isbp/sdk/web';
import { UserAvatar } from '@isbp/ui/avatar';
import { Button } from '@isbp/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@isbp/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@isbp/ui/form';
import { Input } from '@isbp/ui/input';
import { Skeleton } from '@isbp/ui/skeleton';
import { LockIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { problemResolver, type ValidationText, zodProblems } from '@/components/idp/contract-resolver';
import { useDepartments } from '@/components/pickers/use-departments';
import { SourceBadge } from '@/components/status-badge';
import { useApiMutation, useErrorText } from '@/lib/api';

function ReadOnly({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm">{children}</dd>
    </div>
  );
}

export function ProfileCard({ me }: { me: Me | undefined }) {
  const t = useTranslations('settings.profile');
  const tv = useTranslations('settings.validation');
  const tc = useTranslations('common');
  const { user } = usePlatform();
  const router = useRouter();
  const errorText = useErrorText();
  const { byId, isLoading: loadingDepartments } = useDepartments();
  const vt: ValidationText = (key, values) => tv(key, values);

  const form = useForm<{ displayName: string }>({
    defaultValues: { displayName: me?.displayName ?? user.displayName },
    resolver: problemResolver((v) =>
      zodProblems(updateMeSchema.safeParse({ displayName: v.displayName }).error?.issues, vt),
    ),
  });

  const save = useApiMutation((api, displayName: string) => api.patch<Me>('/me', { displayName }), {
    invalidate: ['/me'],
    success: t('saved'),
    onSuccess: (r) => {
      form.reset({ displayName: r.displayName });
      // The shell (avatar, user menu) reads the session from the server.
      router.refresh();
    },
    silent: true,
  });

  const onSubmit = form.handleSubmit(async ({ displayName }) => {
    try {
      await save.mutateAsync(displayName.trim());
    } catch (err) {
      form.setError('displayName', { message: errorText(err) });
    }
  });

  const typed = useWatch({ control: form.control, name: 'displayName' });
  const liveName = typed?.trim() || user.displayName;
  const departmentId = me?.departmentId ?? user.departmentId;
  const department = departmentId ? byId.get(departmentId)?.name : null;

  return (
    <Card id="profile" className="scroll-mt-20">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center gap-4">
          <UserAvatar name={liveName} src={user.avatarUrl} className="size-16 text-lg" />
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">{liveName}</p>
            <p className="truncate text-sm text-muted-foreground">{me?.jobTitle || user.email}</p>
          </div>
        </div>

        <Form {...form}>
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <FormField
              control={form.control}
              name="displayName"
              render={({ field }) => (
                <FormItem className="flex-1">
                  <FormLabel>{t('displayName')}</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="name" maxLength={200} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button
              type="submit"
              className="sm:mt-[1.375rem]"
              loading={save.isPending}
              disabled={!form.formState.isDirty}
            >
              {tc('save')}
            </Button>
          </form>
        </Form>

        <dl className="grid gap-4 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2">
          <ReadOnly label={tc('email')}>{user.email}</ReadOnly>
          <ReadOnly label={t('username')}>
            <code className="font-mono text-xs">{user.username}</code>
          </ReadOnly>
          <ReadOnly label={tc('department')}>
            {departmentId && loadingDepartments ? (
              <Skeleton className="h-4 w-32" />
            ) : (
              (department ?? <span className="text-muted-foreground">{tc('none')}</span>)
            )}
          </ReadOnly>
          <ReadOnly label={t('signIn')}>
            {me ? <SourceBadge source={me.authSource} /> : <Skeleton className="h-5 w-16" />}
          </ReadOnly>
        </dl>
        <p className="-mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <LockIcon className="size-3.5 shrink-0" aria-hidden />
          {t('managedHint')}
        </p>
      </CardContent>
    </Card>
  );
}
