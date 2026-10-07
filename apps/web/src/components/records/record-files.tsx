'use client';

import type { FileInfoDto, RecordPanelSlotProps, ResolvedRecordInfo } from '@isbp/contracts';
import { ApiError, useApi } from '@isbp/sdk/web';
import { cn } from '@isbp/ui';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@isbp/ui/alert-dialog';
import { Button } from '@isbp/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@isbp/ui/dialog';
import { invalidatePaths, useApiMutation, useApiQuery, useErrorText } from '@isbp/ui/query';
import { RelativeTime } from '@isbp/ui/relative-time';
import { Skeleton } from '@isbp/ui/skeleton';
import { toast } from '@isbp/ui/sonner';
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
import { type DragEvent, useId, useRef, useState } from 'react';

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
  const inputId = useId();
  const api = useApi();
  const client = useQueryClient();
  const errorText = useErrorText();
  const size = useFileSize();
  const input = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
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

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (editable && e.dataTransfer.files.length) void uploadAll(e.dataTransfer.files);
  };
  const dragProps = editable
    ? {
        onDragOver: (e: DragEvent) => {
          e.preventDefault();
          setDragging(true);
        },
        onDragLeave: () => setDragging(false),
        onDrop,
      }
    : {};

  const uploadButton = editable && (
    <>
      <input
        ref={input}
        id={inputId}
        type="file"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          if (e.target.files?.length) void uploadAll(e.target.files);
          e.target.value = '';
        }}
      />
      <Button size="sm" variant="outline" onClick={() => input.current?.click()}>
        <UploadIcon />
        {t('upload')}
      </Button>
    </>
  );

  const body = (
    <div
      {...dragProps}
      className={cn(
        'grid gap-2 rounded-lg transition-colors',
        dragging && 'bg-primary/5 ring-2 ring-primary/40 ring-dashed',
      )}
    >
      {data.files.length === 0 && uploads.length === 0 ? (
        <div
          className={cn(
            'rounded-lg px-4 py-5 text-center text-sm text-muted-foreground',
            editable && 'border border-dashed',
          )}
        >
          {editable ? (
            <>
              <p>{t('dropHint')}</p>
              <p className="mt-1 text-xs">{t('limits', { size: size(maxBytes) })}</p>
            </>
          ) : (
            t('empty')
          )}
        </div>
      ) : (
        <ul className="divide-y">
          <AnimatePresence initial={false}>
            {data.files.map((f) => {
              const Icon = iconFor(f.contentType);
              return (
                <motion.li
                  key={f.id}
                  layout
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="flex min-w-0 items-center gap-3 py-2"
                >
                  {f.previewable ? (
                    <button
                      type="button"
                      onClick={() => setPreview(f)}
                      className="size-10 shrink-0 overflow-hidden rounded-md border bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                      aria-label={t('preview', { name: f.name })}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- same-origin API image, sized thumbnail */}
                      <img src={`${f.href}?inline=1`} alt="" className="size-full object-cover" />
                    </button>
                  ) : (
                    <span className="grid size-10 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                      <Icon className="size-5" aria-hidden />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <a
                      href={f.href}
                      download={f.name}
                      className="block truncate text-sm font-medium hover:underline focus-visible:underline focus-visible:outline-none"
                    >
                      {f.name}
                    </a>
                    <p className="truncate text-xs text-muted-foreground">
                      {size(f.size)}
                      {f.uploadedBy && <> · {f.uploadedBy.name}</>} · <RelativeTime date={f.createdAt} />
                    </p>
                  </div>
                  <Button asChild size="icon-sm" variant="ghost" className="text-muted-foreground">
                    <a href={f.href} download={f.name} aria-label={t('download', { name: f.name })}>
                      <DownloadIcon />
                    </a>
                  </Button>
                  {editable && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setConfirm(f)}
                      aria-label={t('delete', { name: f.name })}
                    >
                      <Trash2Icon />
                    </Button>
                  )}
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
                className="flex min-w-0 items-center gap-3 py-2"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                  <UploadIcon className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{u.name}</p>
                  <div
                    role="progressbar"
                    aria-label={t('uploading', { name: u.name })}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(u.progress * 100)}
                    className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"
                  >
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-200"
                      style={{ width: `${Math.round(u.progress * 100)}%` }}
                    />
                  </div>
                </div>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {Math.round(u.progress * 100)}%
                </span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="truncate">{preview?.name}</DialogTitle>
          </DialogHeader>
          {preview && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- same-origin API image at natural size */}
              <img
                src={`${preview.href}?inline=1`}
                alt={preview.name}
                className="max-h-[70vh] w-full rounded-md object-contain"
              />
            </>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('deleteBody', { name: confirm?.name ?? '' })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirm) remove.mutate(confirm);
                setConfirm(null);
              }}
            >
              {t('deleteConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );

  if (bare)
    return (
      <div className="grid gap-2">
        {uploadButton && <div className="flex justify-end">{uploadButton}</div>}
        {body}
      </div>
    );
  return (
    <Card role="region" aria-labelledby={headingId} className="min-w-0">
      <CardHeader>
        <CardTitle id={headingId} className="flex items-center gap-2">
          <PaperclipIcon className="size-4 text-muted-foreground" aria-hidden />
          {t('title')}
          {data.files.length > 0 && (
            <span className="text-sm font-normal text-muted-foreground">({data.files.length})</span>
          )}
        </CardTitle>
        {uploadButton && <CardAction>{uploadButton}</CardAction>}
      </CardHeader>
      <CardContent className="min-w-0">{body}</CardContent>
    </Card>
  );
}
