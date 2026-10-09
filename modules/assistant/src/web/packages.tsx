'use client';

import { localize } from '@isbp/sdk';
import { ApiError } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { Label } from '@isbp/ui/label';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import { CircleAlertIcon, FileJsonIcon, type LucideIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useId, useState } from 'react';
import { CHANGE_SET_PACKAGE_FORMAT } from '../contracts';
import { usePermissionList } from './change-set/permission-names';
import {
  type ChangeSetDetailDto,
  IMPORT_PATH,
  INVALIDATE,
  isRecord,
  MAX_PACKAGE_BYTES,
  useCatalogText,
} from './lib';

/*
 * Pieces of the process packs page: package problems in words, and "Import a file" (a change-set package exported
 * from another environment).
 */

const SHOWN_ISSUES = 12;

/** An icon and text in a status colour (never colour alone), wrapping instead of truncating. */
export function Note({
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
export function useModuleName() {
  const text = useCatalogText();
  return (id: string) => {
    const key = `${id}.meta.name`;
    const name = text(key);
    return name === key ? id : name;
  };
}

/** Why an install or import was refused, by code: the package's problems as the API listed them. */
export function PackageError({ error }: { error: unknown }) {
  const t = useTranslations('assistant.packages.errors');
  const errorText = useErrorText();
  const moduleName = useModuleName();
  const permissionList = usePermissionList();
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
      title = t('forbidden', { permissions: permissionList(d.permissions) });
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

type Parsed =
  | { ok: true; body: Record<string, unknown>; title: string | null; count: number | null }
  | { ok: false; reason: 'unreadable' | 'notPackage' | 'tooLarge' };

/** A package file chosen here, read in the browser and sent as it is: the API checks it and lists its problems. */
export function ImportFile({ onCreated }: { onCreated: (detail: ChangeSetDetailDto) => void }) {
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
