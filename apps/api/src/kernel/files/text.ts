import { aiDocuments, files, fileTexts, type FileTextStatus } from '@isbp/db/schema';
import { type Db, HttpError, type RecordRef } from '@isbp/sdk/server';
import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { AiConfig } from '../ai/config';
import type { AiGateway } from '../ai/gateway';
import { type Extracted, extractBuiltin, fileKind } from './extract/builtin';
import { extractWithService, serviceReads } from './extract/services';
import type { FileStore } from './store';

/** Attempts at one file before it stays `failed` (until an administrator retries). */
const MAX_ATTEMPTS = 3;

/** Errors worth retrying: the service is down, busy or timed out. */
function transient(err: unknown): boolean {
  if (!(err instanceof HttpError)) return true;
  const reason = String((err.details as { reason?: string } | undefined)?.reason ?? '');
  return (
    reason === 'unreachable' || reason === 'rate_limited' || reason === 'timeout' || /^status_5/.test(reason)
  );
}

export interface ExtractionSummary {
  status: FileTextStatus | 'skipped';
  producer?: string | null;
  pages?: number;
  chunks?: number;
  reason?: string;
}

/**
 * Attachments as search text (Phase 10). Only files of records whose indexed document asks for them
 * (`attachments` on `ctx.ai.index.upsert`) are read: the extraction job turns each into Markdown pages (builtin
 * readers, or the configured document-extraction service for scans, images and layout), keeps them in
 * `core.file_texts`, and indexes them as chunks of that document, with its ACL.
 */
export class FileTextService {
  constructor(
    private readonly deps: {
      db: Db;
      files: FileStore;
      ai: AiGateway;
      logger: FastifyBaseLogger;
      /** Queues the `extract-file` job (core). */
      enqueue: (fileId: string) => Promise<void>;
    },
  ) {}

  /** A file was attached: read it if its record's document indexes attachments. */
  async onAttached(fileId: string, record: RecordRef) {
    if (await this.deps.ai.index.documentForFiles(record)) await this.deps.enqueue(fileId);
  }

  async onDeleted(fileId: string) {
    await this.deps.ai.index.removeFile(fileId);
  }

  /**
   * A document that indexes its record's attachments was (re)indexed: index the texts already extracted (with the
   * current embedding model) and queue the files never read.
   */
  async syncRecord(record: RecordRef) {
    const parent = await this.deps.ai.index.documentForFiles(record);
    if (!parent) return;
    const config = await this.deps.ai.config();
    if (!config.documents.enabled) return;
    const embedder = this.deps.ai.embedder(config, 'core', 'core.files.index');
    const rows = await this.deps.db
      .select({ id: files.id, name: files.name, status: fileTexts.status, pages: fileTexts.pages })
      .from(files)
      .leftJoin(fileTexts, eq(fileTexts.fileId, files.id))
      .where(and(eq(files.recordType, record.type), eq(files.recordId, record.id), isNull(files.deletedAt)));
    for (const r of rows) {
      if (!r.status) await this.deps.enqueue(r.id);
      else if (r.status === 'done' && !(await this.deps.ai.index.fileIndexed(r.id, embedder.model)))
        await this.deps.ai.index.upsertFile({ id: r.id, name: r.name }, r.pages ?? [], parent, embedder);
    }
  }

  /** The `extract-file` job: read one attachment, keep its text and index it. Idempotent. */
  async extract(fileId: string): Promise<ExtractionSummary> {
    const { db, ai } = this.deps;
    const [file] = await db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), isNull(files.deletedAt)));
    if (!file) return { status: 'skipped', reason: 'deleted' };
    const parent = await ai.index.documentForFiles({ type: file.recordType, id: file.recordId });
    if (!parent) return { status: 'skipped', reason: 'not_indexed' };
    const config = await ai.config();
    if (!config.documents.enabled) return { status: 'skipped', reason: 'disabled' };

    const [previous] = await db.select().from(fileTexts).where(eq(fileTexts.fileId, fileId));
    const attempts = (previous?.attempts ?? 0) + 1;
    await this.save(fileId, { status: 'pending', attempts });

    const kind = fileKind(file.contentType, file.name);
    const service = config.documents.service;
    const useService = service.provider !== 'none' && serviceReads(service.provider, kind);
    let out: Extracted | null = null;
    try {
      const data = await readAll(await this.deps.files.open(fileId));
      if (useService && service.mode === 'always') out = await this.viaService(config, file, kind, data);
      else {
        out = await extractBuiltin(kind, data);
        // A scan, an image or an unreadable text layer: the service reads it if there is one.
        if ((!out || out.needsOcr) && useService)
          out = (await this.viaService(config, file, kind, data)) ?? out;
      }
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
      this.deps.logger.warn({ err, fileId }, 'file text extraction failed');
      await this.save(fileId, { status: 'failed', error: message, attempts });
      // Let the queue retry a service that is down; a file it can't read stays failed.
      if (transient(err) && attempts < MAX_ATTEMPTS) throw err;
      return { status: 'failed', reason: message };
    }

    if (!out) {
      await this.save(fileId, { status: 'unsupported', attempts, pages: [], chars: 0, producer: null });
      await ai.index.removeFile(fileId);
      return { status: 'unsupported' };
    }
    const pages = out.pages.slice(0, config.documents.maxPages);
    const chars = pages.reduce((n, p) => n + p.trim().length, 0);
    if (!chars) {
      // No text: a scan or an image with no service to read it (kept so an administrator can retry later).
      await this.save(fileId, { status: 'empty', attempts, pages: [], chars: 0, producer: out.producer });
      await ai.index.removeFile(fileId);
      return { status: 'empty', producer: out.producer };
    }
    await this.save(fileId, {
      status: 'done',
      attempts,
      pages,
      chars,
      producer: out.producer,
      error: out.pages.length > pages.length ? `truncated to ${pages.length} pages` : null,
      extractedAt: new Date(),
    });
    const embedder = ai.embedder(config, 'core', 'core.files.index');
    const chunks = await ai.index.upsertFile({ id: fileId, name: file.name }, pages, parent, embedder);
    return { status: 'done', producer: out.producer, pages: pages.length, chunks };
  }

  private async viaService(
    config: AiConfig,
    file: { id: string; name: string; contentType: string },
    kind: ReturnType<typeof fileKind>,
    data: Buffer,
  ): Promise<Extracted | null> {
    const service = config.documents.service;
    if (service.provider === 'none') return null;
    const started = Date.now();
    const usage = {
      moduleId: 'core',
      feature: 'core.files.extract',
      kind: 'extract' as const,
      principal: { type: 'system' as const, id: null, name: 'Document extraction' },
      provider: service.provider,
      model: service.model || null,
    };
    try {
      const out = await extractWithService(service, {
        name: file.name,
        contentType: file.contentType,
        kind,
        data,
        languages: config.documents.languages,
        maxPages: config.documents.maxPages,
      });
      await this.deps.ai.logUsage({
        ...usage,
        costUsd: (out.pages.length * service.price) / 1000,
        latencyMs: Date.now() - started,
        status: 'ok',
      });
      return out;
    } catch (err) {
      await this.deps.ai.logUsage({
        ...usage,
        latencyMs: Date.now() - started,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  private async save(
    fileId: string,
    values: Partial<typeof fileTexts.$inferInsert> & { status: FileTextStatus },
  ) {
    await this.deps.db
      .insert(fileTexts)
      .values({ fileId, ...values })
      .onConflictDoUpdate({ target: fileTexts.fileId, set: { ...values, updatedAt: new Date() } });
  }

  /**
   * Files of records whose document indexes attachments that still need reading: never read, or (with a service
   * configured) scans and failures that may read now. Queued in batches; returns how many.
   */
  async backlog(limit = 200, opts: { retry?: boolean } = {}): Promise<number> {
    const config = await this.deps.ai.config();
    if (!config.documents.enabled) return 0;
    const hasService = config.documents.service.provider !== 'none';
    const again: FileTextStatus[] = opts.retry
      ? ['failed', 'empty', 'unsupported']
      : hasService
        ? ['empty']
        : [];
    const rows = await this.deps.db
      .select({ id: files.id })
      .from(files)
      .innerJoin(
        aiDocuments,
        and(eq(aiDocuments.filesRecordType, files.recordType), eq(aiDocuments.filesRecordId, files.recordId)),
      )
      .leftJoin(fileTexts, eq(fileTexts.fileId, files.id))
      .where(
        and(
          isNull(files.deletedAt),
          or(
            isNull(fileTexts.status),
            again.length
              ? and(
                  inArray(fileTexts.status, again),
                  opts.retry ? sql`true` : lt(fileTexts.attempts, MAX_ATTEMPTS),
                )
              : sql`false`,
          ),
        ),
      )
      .limit(limit);
    if (opts.retry && rows.length)
      await this.deps.db
        .update(fileTexts)
        .set({ attempts: 0 })
        .where(
          inArray(
            fileTexts.fileId,
            rows.map((r) => r.id),
          ),
        );
    for (const r of rows) await this.deps.enqueue(r.id);
    return rows.length;
  }

  /** How the attachments of indexed records stand (Administration → AI → Index). */
  async stats() {
    const res = await this.deps.db.execute<{ status: string | null; n: number; pages: number }>(sql`
      select t.status, count(*)::int as n, coalesce(sum(cardinality(t.pages)), 0)::int as pages
      from core.files f
      join core.ai_documents d on d.files_record_type = f.record_type and d.files_record_id = f.record_id
      left join core.file_texts t on t.file_id = f.id
      where f.deleted_at is null
      group by t.status`);
    const by = Object.fromEntries(res.rows.map((r) => [r.status ?? 'waiting', r.n]));
    return {
      files: res.rows.reduce((n, r) => n + r.n, 0),
      searchable: by.done ?? 0,
      waiting: (by.waiting ?? 0) + (by.pending ?? 0),
      needsOcr: by.empty ?? 0,
      unsupported: by.unsupported ?? 0,
      failed: by.failed ?? 0,
      pages: res.rows.find((r) => r.status === 'done')?.pages ?? 0,
    };
  }

  /** A file's extraction state, for the attachments panel. */
  async statusOf(fileIds: string[]): Promise<Map<string, FileTextStatus>> {
    if (!fileIds.length) return new Map();
    const rows = await this.deps.db
      .select({ id: fileTexts.fileId, status: fileTexts.status })
      .from(fileTexts)
      .where(inArray(fileTexts.fileId, fileIds));
    return new Map(rows.map((r) => [r.id, r.status]));
  }
}

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of stream) parts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  return Buffer.concat(parts);
}
