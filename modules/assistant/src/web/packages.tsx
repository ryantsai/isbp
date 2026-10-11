'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { FileInput } from '@astryxdesign/core/FileInput';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { Text } from '@astryxdesign/core/Text';
import { localize } from '@isbp/sdk';
import { ApiError } from '@isbp/sdk/web';
import { useApiMutation, useErrorText } from '@isbp/ui/query';
import { CircleAlertIcon, FileJsonIcon, type LucideIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { CHANGE_SET_PACKAGE_FORMAT } from '../contracts';
import { ToneText } from './badges';
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
  icon,
  tone,
  children,
}: {
  icon: LucideIcon;
  tone: 'info' | 'warning' | 'destructive';
  children: string;
}) {
  return <ToneText meta={{ icon, tone }} label={children} wrap />;
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
    <Banner status="error" title={title} collapsible={false}>
      {lines.length > 0 && (
        <List listStyle="disc" density="compact">
          {lines.map((line, i) => (
            <ListItem key={i} label={line} />
          ))}
          {more > 0 && <ListItem label={t('more', { count: more })} />}
        </List>
      )}
    </Banner>
  );
}

type Parsed =
  | { ok: true; body: Record<string, unknown>; title: string | null; count: number | null }
  | { ok: false; reason: 'unreadable' | 'notPackage' | 'tooLarge' };

/** A package file chosen here, read in the browser and sent as it is: the API checks it and lists its problems. */
export function ImportFile({ onCreated }: { onCreated: (detail: ChangeSetDetailDto) => void }) {
  const t = useTranslations('assistant.packages.file');
  const locale = useLocale();
  const [fileName, setFileName] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
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
  const choose = async (picked: File | File[] | null) => {
    const next = Array.isArray(picked) ? (picked[0] ?? null) : picked;
    run.reset();
    setFile(next);
    setFileName(next?.name ?? null);
    setParsed(next ? await read(next) : null);
  };

  const ok = parsed?.ok ? parsed : null;
  return (
    <VStack gap={3} className="min-w-0">
      <Text color="secondary">{t('hint')}</Text>
      <FileInput
        label={t('label')}
        description={t('fileHint')}
        accept=".json,application/json"
        isDisabled={run.isPending}
        value={file}
        onChange={(picked) => void choose(picked)}
      />
      <div role="status" aria-live="polite">
        {parsed && !parsed.ok && (
          <ToneText
            meta={{ icon: CircleAlertIcon, tone: 'destructive' }}
            label={t(`problems.${parsed.reason}`)}
            wrap
          />
        )}
        {ok && (
          <HStack gap={2} vAlign="start">
            <Icon icon={FileJsonIcon} color="accent" />
            <Text wordBreak="break-word">
              <Text weight="medium" wordBreak="break-all">
                {fileName}
              </Text>
              {': '}
              {ok.title ? t('parsed', { title: ok.title, count: ok.count ?? 0 }) : t('parsedUntitled')}
            </Text>
          </HStack>
        )}
      </div>
      {run.error ? <PackageError error={run.error} /> : null}
      <HStack>
        <Button
          label={t('import')}
          variant="primary"
          isLoading={run.isPending}
          isDisabled={!ok || run.isPending}
          onClick={() => ok && run.mutate(ok.body)}
        />
      </HStack>
    </VStack>
  );
}
