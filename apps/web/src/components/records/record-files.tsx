'use client';

import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Badge } from '@astryxdesign/core/Badge';
import { FileInput } from '@astryxdesign/core/FileInput';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Layout';
import { Lightbox } from '@astryxdesign/core/Lightbox';
import { Link } from '@astryxdesign/core/Link';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { Text } from '@astryxdesign/core/Text';
import { Thumbnail } from '@astryxdesign/core/Thumbnail';
import type { FileInfoDto, RecordPanelSlotProps, ResolvedRecordInfo } from '@isbp/contracts';
import { ApiError, useApi } from '@isbp/sdk/web';
import { Card, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { DownloadButton } from '@isbp/ui/download-button';
import { IconTile } from '@isbp/ui/icon-tile';
import { invalidatePaths, useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { toast } from '@isbp/ui/toast';
import { useQueryClient } from '@tanstack/react-query';
import {
  DownloadIcon,
  FileArchiveIcon,
  FileIcon,
  FileImageIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  PaperclipIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useFormatter, useTranslations } from 'next-intl';
import { useId, useState } from 'react';

interface FilesResponse {
  record: ResolvedRecordInfo;
  files: FileInfoDto[];
  limits: { maxBytes: number; blockedExtensions: string[] };
}

interface Upload {
  key: string;
  name: string;
  progress: number;
}

const filesPath = (record: { type: string; id: string }) => `/records/${record.type}/${record.id}/files`;

function iconFor(type: string) {
  if (type.startsWith('image/')) return FileImageIcon;
  if (type === 'application/pdf' || type.startsWith('text/')) return FileTextIcon;
  if (type.includes('spreadsheet') || type === 'text/csv' || type.includes('excel'))
    return FileSpreadsheetIcon;
  if (type.includes('zip') || type.includes('compressed') || type.includes('x-7z')) return FileArchiveIcon;
  return FileIcon;
}

/** "1.2 MB" in the viewer's locale. */
function useFileSize() {
  const format = useFormatter();
  return (bytes: number) => {
    const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const;
    let value = bytes;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
      value /= 1024;
      i++;
    }
    return format.number(value, { style: 'unit', unit: units[i], maximumFractionDigits: i ? 1 : 0 });
  };
}

/**
 * Core panel for `<Slot name="core.record.files" props={{ record }} />`: a record's attachments. Upload by
 * button or drag-and-drop (progress per file), preview images, download, delete.
 */
export default function RecordFiles({ record: ref, bare }: RecordPanelSlotProps) {
  const t = useTranslations('records.files');
  const headingId = useId();
  const api = useApi();
  const client = useQueryClient();
  const errorText = useErrorText();
  const size = useFileSize();
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [preview, setPreview] = useState<FileInfoDto | null>(null);
  const [confirm, setConfirm] = useState<FileInfoDto | null>(null);
  const [announce, setAnnounce] = useState('');
  const { data, isPending } = useApiQuery<FilesResponse>(filesPath(ref));
  const remove = useApiMutation((a, file: FileInfoDto) => a.delete(`/files/${file.id}`), {
    invalidate: [filesPath(ref)],
    success: t('deleted'),
  });

  if (isPending || !data) return bare ? null : <Skeleton className="h-28 w-full" />;
  const { editable } = data.record;
  const { maxBytes, blockedExtensions } = data.limits;

  async function uploadAll(list: FileList | File[]) {
    for (const file of Array.from(list)) {
      const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
      if (ext && blockedExtensions.includes(ext)) {
        toast.error(t('blocked', { name: file.name, ext }));
        continue;
      }
      if (file.size > maxBytes) {
        toast.error(t('tooLarge', { name: file.name, size: size(maxBytes) }));
        continue;
      }
      const key = `${file.name}-${file.size}-${Date.now()}`;
      setUploads((u) => [...u, { key, name: file.name, progress: 0 }]);
      setAnnounce(t('uploading', { name: file.name }));
      const form = new FormData();
      form.append('file', file, file.name);
      try {
        await api.upload(filesPath(ref), form, (p) =>
          setUploads((u) => u.map((x) => (x.key === key ? { ...x, progress: p } : x))),
        );
        setAnnounce(t('uploaded', { name: file.name }));
        toast.success(t('uploaded', { name: file.name }));
      } catch (err) {
        const reason =
          err instanceof ApiError && err.code === 'FILE_REJECTED'
            ? (err.details as { reason?: string } | undefined)?.reason
            : undefined;
        const message = reason && t.has(`reasons.${reason}`) ? t(`reasons.${reason}`) : errorText(err);
        toast.error(t('failed', { name: file.name, reason: message }));
      } finally {
        setUploads((u) => u.filter((x) => x.key !== key));
      }
    }
    await invalidatePaths(client, [filesPath(ref)]);
  }

  const upload = editable && (
    <FileInput
      mode="dropzone"
      isMultiple
      label={t('upload')}
      description={t('limits', { size: size(maxBytes) })}
      placeholder={t('dropHint')}
      value={null}
      onChange={(files) => {
        const list = files === null ? [] : Array.isArray(files) ? files : [files];
        if (list.length) void uploadAll(list);
      }}
    />
  );

  const body = (
    <VStack gap={3}>
      {(data.files.length > 0 || uploads.length > 0) && (
        <ul className="divide-y">
          <AnimatePresence initial={false}>
            {data.files.map((f) => {
              const FileTypeIcon = iconFor(f.contentType);
              return (
                <motion.li
                  key={f.id}
                  layout
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="py-2"
                >
                  <HStack gap={3} vAlign="center">
                    {f.previewable ? (
                      <Thumbnail
                        src={`${f.href}?inline=1`}
                        label={t('preview', { name: f.name })}
                        onClick={() => setPreview(f)}
                      />
                    ) : (
                      <IconTile variant="outline" aria-hidden>
                        <FileTypeIcon />
                      </IconTile>
                    )}
                    <StackItem size="fill">
                      <VStack gap={0.5}>
                        <Link href={f.href} download={f.name} maxLines={1} weight="medium" color="primary">
                          {f.name}
                        </Link>
                        <Text type="supporting" maxLines={1}>
                          {size(f.size)}
                          {f.uploadedBy && <> · {f.uploadedBy.name}</>} · <RelativeTime date={f.createdAt} />
                        </Text>
                      </VStack>
                    </StackItem>
                    <DownloadButton
                      href={f.href}
                      download={f.name}
                      label={t('download', { name: f.name })}
                      isIconOnly
                      variant="ghost"
                      size="sm"
                      icon={<Icon icon={DownloadIcon} />}
                    />
                    {editable && (
                      <IconButton
                        label={t('delete', { name: f.name })}
                        variant="ghost"
                        size="sm"
                        icon={<Icon icon={Trash2Icon} />}
                        onClick={() => setConfirm(f)}
                      />
                    )}
                  </HStack>
                </motion.li>
              );
            })}
            {uploads.map((u) => (
              <motion.li
                key={u.key}
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="py-2"
              >
                <HStack gap={3} vAlign="center">
                  <IconTile variant="outline" aria-hidden>
                    <UploadIcon />
                  </IconTile>
                  <StackItem size="fill">
                    <VStack gap={1}>
                      <Text maxLines={1}>{u.name}</Text>
                      <ProgressBar
                        label={t('uploading', { name: u.name })}
                        isLabelHidden
                        value={Math.round(u.progress * 100)}
                        hasValueLabel
                      />
                    </VStack>
                  </StackItem>
                </HStack>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      {data.files.length === 0 && uploads.length === 0 && !editable && (
        <Text color="secondary">{t('empty')}</Text>
      )}
      {upload}
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      {preview && (
        <Lightbox
          isOpen
          onOpenChange={(open) => !open && setPreview(null)}
          media={{ src: `${preview.href}?inline=1`, alt: preview.name }}
        />
      )}
      <AlertDialog
        isOpen={!!confirm}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t('deleteTitle')}
        description={t('deleteBody', { name: confirm?.name ?? '' })}
        actionLabel={t('deleteConfirm')}
        cancelLabel={t('cancel')}
        onAction={() => {
          if (confirm) remove.mutate(confirm);
          setConfirm(null);
        }}
      />
    </VStack>
  );

  if (bare) return body;
  return (
    <Card role="region" aria-labelledby={headingId} className="min-w-0">
      <CardHeader>
        <CardTitle id={headingId}>
          <HStack gap={2} vAlign="center">
            <Icon icon={PaperclipIcon} color="secondary" />
            {t('title')}
            {data.files.length > 0 && <Badge variant="neutral" label={data.files.length} />}
          </HStack>
        </CardTitle>
      </CardHeader>
      <CardContent className="min-w-0">{body}</CardContent>
    </Card>
  );
}
