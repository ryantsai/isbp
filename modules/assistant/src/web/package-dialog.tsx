'use client';

import { localize } from '@isbp/sdk';
import { ApiError } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@isbp/ui/dialog';
import { EmptyState } from '@isbp/ui/empty-state';
import { Label } from '@isbp/ui/label';
import { useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import { Skeleton } from '@isbp/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@isbp/ui/tabs';
import {
  CircleAlertIcon,
  FileJsonIcon,
  type LucideIcon,
  PackageIcon,
  PackageOpenIcon,
  ShieldAlertIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useId, useState } from 'react';
import { CHANGE_SET_PACKAGE_FORMAT, changeSetHref } from '../contracts';
import {
  type AssistantStatusDto,
  type ChangeSetDetailDto,
  IMPORT_PATH,
  INVALIDATE,
  installPackagePath,
  isRecord,
  MAX_PACKAGE_BYTES,
  PACKAGES_PATH,
  type PackageInfoDto,
  STATUS_PATH,
  useCatalogText,
  useKindLabel,
} from './lib';

type Tab = 'builtin' | 'file';
const SHOWN_ISSUES = 12;

/** An icon and text in a status colour (never colour alone), wrapping instead of truncating. */
function Note({
  icon: Icon,
  tone,
  children,
}: {
  icon: LucideIcon;
  tone: 'info' | 'warning' | 'destructive';
  children: ReactNode;
}) {
  return (
    <p
      className={cn(
        'flex items-start gap-1.5 text-xs font-medium',
        tone === 'info' && 'text-info',
        tone === 'warning' && 'text-warning-foreground',
        tone === 'destructive' && 'text-destructive',
      )}
    >
      <Icon className="mt-px size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

/** A module's name from its catalog (`<module>.meta.name`), or its id. */
function useModuleName() {
  const text = useCatalogText();
  return (id: string) => {
    const key = `${id}.meta.name`;
    const name = text(key);
    return name === key ? id : name;
  };
}

/** Why an install or import was refused, by code: the package's problems as the API listed them. */
function PackageError({ error }: { error: unknown }) {
  const t = useTranslations('assistant.packages.errors');
  const errorText = useErrorText();
  const moduleName = useModuleName();
  let title: string;
  let lines: string[] = [];
  let more = 0;
  if (error instanceof ApiError) {
    const d = (isRecord(error.details) ? error.details : {}) as {
      issues?: { path?: string; message?: string }[];
      missingModules?: string[];
      unknownKinds?: string[];
      permissions?: string[];
    };
    if (error.code === 'PACKAGE_UNSUPPORTED') {
      title = t('unsupported');
      if (d.missingModules?.length)
        lines.push(t('missingModules', { modules: d.missingModules.map(moduleName).join(', ') }));
      if (d.unknownKinds?.length) lines.push(t('unknownKinds', { kinds: d.unknownKinds.join(', ') }));
    } else if (error.code === 'FORBIDDEN' && d.permissions?.length) {
      title = t('forbidden', { permissions: d.permissions.join(', ') });
    } else if (error.code === 'VALIDATION_FAILED') {
      title = t('invalid');
      const issues = d.issues ?? [];
      lines = issues
        .slice(0, SHOWN_ISSUES)
        .map((i) => (i.path ? `${i.path}: ${i.message ?? ''}` : (i.message ?? '')));
      more = Math.max(0, issues.length - SHOWN_ISSUES);
    } else if (error.status === 413) {
      title = t('tooLarge');
    } else title = errorText(error);
  } else title = errorText(error);
  return (
    <div
      role="alert"
      className="grid gap-1.5 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      <p className="flex items-start gap-2 font-medium">
        <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span className="min-w-0 break-words">{title}</span>
      </p>
      {lines.length > 0 && (
        <ul className="grid gap-0.5 pl-6 text-xs text-foreground">
          {lines.map((line, i) => (
            <li key={i} className="list-disc break-words">
              {line}
            </li>
          ))}
          {more > 0 && <li className="list-disc">{t('more', { count: more })}</li>}
        </ul>
      )}
    </div>
  );
}

/** The built-in packages of enabled modules: what each holds, whether the viewer may install it, and Install. */
function BuiltinPackages({ onCreated }: { onCreated: (detail: ChangeSetDetailDto) => void }) {
  const t = useTranslations('assistant.packages.builtin');
  const text = useCatalogText();
  const moduleName = useModuleName();
  const id = useId();
  const list = useApiQuery<{ items: PackageInfoDto[] }>(PACKAGES_PATH);
  const status = useApiQuery<AssistantStatusDto>(STATUS_PATH);
  const kindLabel = useKindLabel(status.data?.kinds);
  const [installing, setInstalling] = useState<string | null>(null);
  const install = useApiMutation(
    (api, p: PackageInfoDto) => api.post<ChangeSetDetailDto>(installPackagePath(p.moduleId, p.key), {}),
    {
      invalidate: INVALIDATE,
      silent: true,
      success: (d) => t('installed', { reference: d.reference }),
      onSuccess: (d) => onCreated(d),
    },
  );

  if (list.isLoading)
    return (
      <div className="grid gap-3" aria-busy="true">
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    );
  if (list.error) return <PackageError error={list.error} />;
  const items = list.data?.items ?? [];
  if (!items.length)
    return (
      <div className="rounded-lg border border-dashed">
        <EmptyState icon={<PackageOpenIcon />} title={t('empty')} description={t('emptyHint')} />
      </div>
    );

  /** Why the viewer can't install it, in words. */
  const reasons = (p: PackageInfoDto): string[] => {
    const r = p.requirements;
    return [
      ...(r.missingModules.length
        ? [t('missingModules', { modules: r.missingModules.map(moduleName).join(', ') })]
        : []),
      ...(r.unknownKinds.length ? [t('unknownKinds', { kinds: r.unknownKinds.join(', ') })] : []),
      ...(r.unreadableKinds.length
        ? [
            t('unreadable', {
              permissions: [...new Set(r.unreadableKinds.map((k) => k.permission))].join(', '),
            }),
          ]
        : []),
      ...(r.unsupported.length ? [t('unsupported')] : []),
    ];
  };

  return (
    <div className="grid gap-3">
      <ul className="grid gap-3" aria-label={t('listLabel')}>
        {items.map((p) => {
          const nameId = `${id}-${p.moduleId}-${p.key}`;
          const why = reasons(p);
          return (
            <li
              key={`${p.moduleId}/${p.key}`}
              className="grid min-w-0 grid-cols-1 gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start"
            >
              <div className="min-w-0 space-y-1">
                <p id={nameId} className="flex items-start gap-2 font-medium">
                  <PackageIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  <span className="min-w-0 break-words">{text(p.name)}</span>
                </p>
                <p className="text-sm break-words text-muted-foreground">{text(p.description)}</p>
                <p className="text-xs text-muted-foreground">
                  {t('meta', { count: p.itemCount, module: moduleName(p.moduleId) })}
                </p>
                {p.kinds.length > 0 && (
                  <p className="text-xs break-words text-muted-foreground">
                    {t('kinds', { kinds: p.kinds.map((k) => kindLabel(k)).join(', ') })}
                  </p>
                )}
                {why.map((w) => (
                  <Note key={w} icon={CircleAlertIcon} tone="warning">
                    {w}
                  </Note>
                ))}
                {p.canPropose && !p.canApply && (
                  <Note icon={ShieldAlertIcon} tone="info">
                    {t('needsReviewer')}
                  </Note>
                )}
              </div>
              <Button
                size="sm"
                className="justify-self-start"
                disabled={!p.canPropose || install.isPending}
                loading={install.isPending && installing === `${p.moduleId}/${p.key}`}
                aria-describedby={nameId}
                onClick={() => {
                  setInstalling(`${p.moduleId}/${p.key}`);
                  install.mutate(p);
                }}
              >
                {t('install')}
              </Button>
            </li>
          );
        })}
      </ul>
      {install.error ? <PackageError error={install.error} /> : null}
    </div>
  );
}

type Parsed =
  | { ok: true; body: Record<string, unknown>; title: string | null; count: number | null }
  | { ok: false; reason: 'unreadable' | 'notPackage' | 'tooLarge' };

/** A package file chosen here, read in the browser and sent as it is: the API checks it and lists its problems. */
function ImportFile({ onCreated }: { onCreated: (detail: ChangeSetDetailDto) => void }) {
  const t = useTranslations('assistant.packages.file');
  const locale = useLocale();
  const id = useId();
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const run = useApiMutation(
    (api, body: Record<string, unknown>) => api.post<ChangeSetDetailDto>(IMPORT_PATH, body),
    {
      invalidate: INVALIDATE,
      silent: true,
      success: (d) => t('imported', { reference: d.reference }),
      onSuccess: (d) => onCreated(d),
    },
  );

  /** Reads the file; the API checks the package itself. */
  const read = async (file: File): Promise<Parsed> => {
    if (file.size > MAX_PACKAGE_BYTES) return { ok: false, reason: 'tooLarge' };
    let json: unknown;
    try {
      json = JSON.parse(await file.text());
    } catch {
      return { ok: false, reason: 'unreadable' };
    }
    if (!isRecord(json) || json.format !== CHANGE_SET_PACKAGE_FORMAT)
      return { ok: false, reason: 'notPackage' };
    const title = isRecord(json.title) ? localize(json.title, locale) || null : null;
    return { ok: true, body: json, title, count: Array.isArray(json.items) ? json.items.length : null };
  };
  const choose = async (file: File | undefined) => {
    run.reset();
    setFileName(file?.name ?? null);
    setParsed(file ? await read(file) : null);
  };

  const ok = parsed?.ok ? parsed : null;
  return (
    <div className="grid min-w-0 gap-3">
      <p className="text-sm text-muted-foreground">{t('hint')}</p>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-file`}>{t('label')}</Label>
        <input
          id={`${id}-file`}
          type="file"
          accept=".json,application/json"
          disabled={run.isPending}
          aria-describedby={`${id}-file-hint`}
          onChange={(e) => void choose(e.target.files?.[0])}
          className="block w-full min-w-0 rounded-md border bg-background text-sm file:mr-3 file:border-0 file:border-r file:bg-muted file:px-3 file:py-2 file:text-sm file:font-medium focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        />
        <p id={`${id}-file-hint`} className="text-xs text-muted-foreground">
          {t('fileHint')}
        </p>
      </div>
      <div role="status" aria-live="polite" className="grid gap-2 text-sm">
        {parsed && !parsed.ok && (
          <p className="flex items-start gap-2 text-destructive">
            <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="min-w-0">{t(`problems.${parsed.reason}`)}</span>
          </p>
        )}
        {ok && (
          <p className="flex items-start gap-2">
            <FileJsonIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <span className="min-w-0 break-words">
              <span className="font-medium break-all">{fileName}</span>
              {': '}
              {ok.title ? t('parsed', { title: ok.title, count: ok.count ?? 0 }) : t('parsedUntitled')}
            </span>
          </p>
        )}
      </div>
      {run.error ? <PackageError error={run.error} /> : null}
      <Button
        className="justify-self-start"
        disabled={!ok || run.isPending}
        loading={run.isPending}
        onClick={() => ok && run.mutate(ok.body)}
      >
        {t('import')}
      </Button>
    </div>
  );
}

/**
 * "From a package" on the change sets page: install one of the modules' built-in packages, or import a package
 * file (exported from another environment). Either makes a new draft change set, which opens with its dry run.
 */
export function PackageDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('assistant.packages');
  const tc = useTranslations('common');
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('builtin');
  const created = (detail: ChangeSetDetailDto) => {
    onOpenChange(false);
    router.push(changeSetHref(detail.id));
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('close')} className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        {open && (
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="min-w-0">
            <TabsList aria-label={t('tabsLabel')}>
              <TabsTrigger value="builtin">{t('builtin.tab')}</TabsTrigger>
              <TabsTrigger value="file">{t('file.tab')}</TabsTrigger>
            </TabsList>
            <TabsContent value="builtin" className="min-w-0 pt-2">
              <BuiltinPackages onCreated={created} />
            </TabsContent>
            <TabsContent value="file" className="min-w-0 pt-2">
              <ImportFile onCreated={created} />
            </TabsContent>
          </Tabs>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tc('close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
