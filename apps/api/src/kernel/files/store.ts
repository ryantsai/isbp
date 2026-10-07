import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { files, users } from '@isbp/db/schema';
import {
  type Db,
  ErrorCodes,
  type FileInfo,
  type FilesService,
  HttpError,
  type ModuleContext,
  type Principal,
  type RecordRef,
} from '@isbp/sdk/server';
import { and, asc, eq, isNotNull, isNull, lte, ne, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { fileTypeFromBuffer } from 'file-type';
import { currentPrincipal } from '../context';
import {
  DANGEROUS_MIME,
  extensionOf,
  type FilePolicy,
  PREVIEWABLE,
  sanitizeFileName,
  TEXT_TYPES,
} from './policy';
import type { ClamdScanner } from './scanner';
import type { BlobStorage } from './storage';

const actingUser = (p: Principal) => (p.type === 'user' ? p.id : (p.onBehalfOf?.id ?? null));

const reject = (reason: string, message: string) =>
  new HttpError(422, ErrorCodes.FILE_REJECTED, message, { reason });

/**
 * Attachments on records: policy (size, blocked types, content sniffing, malware scan), storage and
 * audit. Uploads stream through a temp file, so memory use doesn't grow with file size.
 */
export class FileStore {
  constructor(
    private readonly deps: {
      db: Db;
      storage: BlobStorage;
      scanner: ClamdScanner | null;
      core: () => ModuleContext;
      logger: FastifyBaseLogger;
    },
  ) {}

  get storageKind() {
    return this.deps.storage.kind;
  }

  async policy(): Promise<FilePolicy> {
    const settings = this.deps.core().settings;
    const mb = Number(await settings.get<number>('files.maxSizeMb')) || 25;
    const blocked = String((await settings.get<string>('files.blockedExtensions')) ?? '')
      .split(/[\s,]+/)
      .map((e) => e.replace(/^\./, '').toLowerCase())
      .filter(Boolean);
    return { maxBytes: Math.min(Math.max(mb, 1), 50) * 1024 * 1024, blockedExtensions: blocked };
  }

  private toInfo(row: typeof files.$inferSelect & { uploaderName?: string | null }): FileInfo & {
    previewable: boolean;
  } {
    return {
      id: row.id,
      record: { type: row.recordType, id: row.recordId },
      name: row.name,
      contentType: row.contentType,
      size: row.size,
      sha256: row.sha256,
      uploadedBy: row.uploadedBy ? { id: row.uploadedBy, name: row.uploaderName ?? '' } : null,
      createdAt: row.createdAt,
      href: `/api/v1/files/${row.id}`,
      previewable: PREVIEWABLE.has(row.contentType),
    };
  }

  private select() {
    return this.deps.db
      .select({ file: files, uploaderName: users.displayName })
      .from(files)
      .leftJoin(users, eq(users.id, files.uploadedBy));
  }

  async list(ref: RecordRef) {
    const rows = await this.select()
      .where(and(eq(files.recordType, ref.type), eq(files.recordId, ref.id), isNull(files.deletedAt)))
      .orderBy(asc(files.createdAt));
    return rows.map((r) => this.toInfo({ ...r.file, uploaderName: r.uploaderName }));
  }

  async get(id: string) {
    const [row] = await this.select().where(and(eq(files.id, id), isNull(files.deletedAt)));
    return row ? this.toInfo({ ...row.file, uploaderName: row.uploaderName }) : null;
  }

  async open(id: string): Promise<Readable> {
    const [row] = await this.deps.db
      .select({ key: files.storageKey })
      .from(files)
      .where(and(eq(files.id, id), isNull(files.deletedAt)));
    if (!row) throw new HttpError(404, ErrorCodes.NOT_FOUND, 'File not found');
    return this.deps.storage.get(row.key);
  }

  async attach(ref: RecordRef, file: { name: string; contentType?: string; data: Buffer | Readable }) {
    const policy = await this.policy();
    const name = sanitizeFileName(file.name);
    const ext = extensionOf(name);
    if (ext && policy.blockedExtensions.includes(ext))
      throw reject('blocked_type', `Files of type .${ext} can't be uploaded`);

    const dir = join(tmpdir(), 'isbp-uploads');
    await mkdir(dir, { recursive: true });
    const temp = join(dir, randomUUID());
    try {
      const hash = createHash('sha256');
      let size = 0;
      const head: Buffer[] = [];
      let headLength = 0;
      const meter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          size += chunk.length;
          if (size > policy.maxBytes) {
            cb(
              new HttpError(413, ErrorCodes.FILE_TOO_LARGE, 'The file is too large', {
                maxBytes: policy.maxBytes,
              }),
            );
            return;
          }
          hash.update(chunk);
          if (headLength < 4100) {
            head.push(chunk);
            headLength += chunk.length;
          }
          cb(null, chunk);
        },
      });
      const source = Buffer.isBuffer(file.data) ? Readable.from([file.data]) : file.data;
      await pipeline(source, meter, createWriteStream(temp, { mode: 0o600 }));
      // @fastify/multipart truncates at its own limit instead of failing; treat that as too large.
      if ((source as Readable & { truncated?: boolean }).truncated)
        throw new HttpError(413, ErrorCodes.FILE_TOO_LARGE, 'The file is too large', {
          maxBytes: policy.maxBytes,
        });
      if (size === 0) throw reject('empty', 'The file is empty');

      const sniffed = await fileTypeFromBuffer(Buffer.concat(head).subarray(0, 4100));
      if (sniffed && (DANGEROUS_MIME.has(sniffed.mime) || policy.blockedExtensions.includes(sniffed.ext)))
        throw reject('blocked_type', `Files of type ${sniffed.mime} can't be uploaded`);
      const contentType = sniffed?.mime ?? TEXT_TYPES[ext] ?? 'application/octet-stream';

      if (this.deps.scanner) {
        const result = await this.deps.scanner.scan(temp).catch((err: unknown) => {
          this.deps.logger.error({ err }, 'malware scanner unavailable');
          throw reject('scan_unavailable', 'The file could not be scanned for malware');
        });
        if (!result.clean) {
          await this.deps.core().audit.record({
            action: 'core.file.rejected',
            category: 'security',
            outcome: 'denied',
            entityType: 'file',
            entityLabel: name,
            metadata: { record: ref, signature: result.signature, size },
          });
          throw reject('malware', 'Malware was found in the file');
        }
      }

      const now = new Date();
      const id = randomUUID();
      const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}`;
      await this.deps.storage.put(key, temp, { contentType, size });
      const principal = currentPrincipal();
      const core = this.deps.core();
      const row = await this.deps.db.transaction(async (txRaw) => {
        const tx = txRaw as unknown as Db;
        const [inserted] = await tx
          .insert(files)
          .values({
            recordType: ref.type,
            recordId: ref.id,
            name,
            contentType,
            size,
            sha256: hash.digest('hex'),
            storage: this.deps.storage.kind,
            storageKey: key,
            uploadedBy: actingUser(principal),
          })
          .returning();
        await core.audit.record(
          {
            action: 'core.file.uploaded',
            entityType: 'file',
            entityId: inserted!.id,
            entityLabel: name,
            metadata: { record: ref, size, contentType },
          },
          { tx },
        );
        await core.events.publish(
          'core.file.attached',
          { fileId: inserted!.id, record: ref, name, size },
          { tx },
        );
        return inserted!;
      });
      const [uploader] = row.uploadedBy
        ? await this.deps.db
            .select({ name: users.displayName })
            .from(users)
            .where(eq(users.id, row.uploadedBy))
        : [];
      return this.toInfo({ ...row, uploaderName: uploader?.name ?? null });
    } finally {
      await rm(temp, { force: true });
    }
  }

  async remove(id: string): Promise<boolean> {
    const principal = currentPrincipal();
    const core = this.deps.core();
    const row = await this.deps.db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as Db;
      const [deleted] = await tx
        .update(files)
        .set({ deletedAt: new Date(), deletedBy: actingUser(principal) })
        .where(and(eq(files.id, id), isNull(files.deletedAt)))
        .returning();
      if (!deleted) return null;
      const ref = { type: deleted.recordType, id: deleted.recordId };
      await core.audit.record(
        {
          action: 'core.file.deleted',
          entityType: 'file',
          entityId: deleted.id,
          entityLabel: deleted.name,
          metadata: { record: ref },
        },
        { tx },
      );
      await core.events.publish(
        'core.file.deleted',
        { fileId: deleted.id, record: ref, name: deleted.name },
        { tx },
      );
      return deleted;
    });
    if (!row) return false;
    await this.purgeOne(row.id, row.storageKey);
    return true;
  }

  /** Marks a deleted record's files as deleted; the purge job removes the bytes. */
  async forgetRecord(ref: RecordRef, tx: Db) {
    await tx
      .update(files)
      .set({ deletedAt: new Date() })
      .where(and(eq(files.recordType, ref.type), eq(files.recordId, ref.id), isNull(files.deletedAt)));
  }

  private async purgeOne(id: string, key: string) {
    try {
      await this.deps.storage.delete(key);
      await this.deps.db.update(files).set({ storageKey: '' }).where(eq(files.id, id));
    } catch (err) {
      this.deps.logger.warn({ err, fileId: id }, 'could not delete file bytes (the purge job retries)');
    }
  }

  /** Deletes the bytes of files deleted more than `graceMs` ago (rows stay for the audit trail). */
  async purge(graceMs = 60 * 60 * 1000): Promise<number> {
    const rows = await this.deps.db
      .select({ id: files.id, key: files.storageKey })
      .from(files)
      .where(
        and(
          isNotNull(files.deletedAt),
          ne(files.storageKey, ''),
          lte(files.deletedAt, new Date(Date.now() - graceMs)),
        ),
      )
      .limit(500);
    for (const r of rows) await this.purgeOne(r.id, r.key);
    return rows.length;
  }

  /** Totals for Administration (storage used by live files). */
  async usage() {
    const [row] = await this.deps.db
      .select({
        count: sql<number>`count(*)::int`,
        bytes: sql<number>`coalesce(sum(${files.size}), 0)::bigint`,
      })
      .from(files)
      .where(isNull(files.deletedAt));
    return { count: row?.count ?? 0, bytes: Number(row?.bytes ?? 0) };
  }

  /** `ctx.files` for one module. */
  service(): FilesService {
    return {
      list: (ref) => this.list(ref),
      attach: (ref, file) => this.attach(ref, file),
      get: (id) => this.get(id),
      open: (id) => this.open(id),
      remove: (id) => this.remove(id),
    };
  }
}
