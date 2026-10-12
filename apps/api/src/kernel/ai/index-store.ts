import { createHash } from 'node:crypto';
import { aiChunks, aiDocuments } from '@isbp/db/schema';
import type { AiIndexDocument, AiSearchHit, AiSearchOptions, Db } from '@isbp/sdk/server';
import { and, desc, eq, gte, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { chunkText } from './chunk';
import { BUILTIN_DIMENSIONS } from './embedder';
import { idf, queryTerms, searchTerms, TERMS_VERSION } from './terms';

export type VectorMode = 'pgvector' | 'portable';

export interface Embedder {
  model: string;
  embed(texts: string[]): Promise<number[][]>;
}

/** Scores documents against a query, in input order (higher is more relevant). */
export interface Reranker {
  model: string;
  rerank(query: string, documents: string[]): Promise<number[]>;
}

const RRF_K = 60;
const CANDIDATES = 40;
/** Fused documents a reranker sees (best first); the rest keep their fused order below them. */
const RERANK_POOL = 30;
/** Characters of a document's best chunk sent to the reranker. */
const RERANK_CHARS = 2_000;
/** A term in more than this share of the index adds to the score but doesn't select candidates on its own. */
const COMMON_SHARE = 0.2;
/** `source_type` of attachment chunks (their `parent_*` columns name the document they belong to). */
export const FILE_TYPE = 'core.file';
/** Characters of one attachment that are indexed (about 500 chunks; the rest of a huge file is left out). */
const MAX_FILE_CHARS = 400_000;

export type IndexedDocument = typeof aiDocuments.$inferSelect;

/** The record whose attachments a document indexes: `attachments: true` means the document's own record. */
function filesRecordOf(doc: AiIndexDocument): { type: string; id: string } | null {
  if (!doc.attachments) return null;
  return doc.attachments === true ? { type: doc.type, id: doc.id } : doc.attachments;
}

/** `{"a","b"}` for a `::text[]` cast: Drizzle would expand a JS array into a parameter list. */
export function textArray(values: readonly string[]): string {
  return `{${values.map((v) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`;
}

/**
 * The shared semantic index (`core.ai_chunks`): chunking, embedding, ACL-filtered hybrid search.
 * The embedding column type decides the vector mode (see migration 0005).
 */
export class SemanticIndex {
  private mode?: VectorMode;
  private indexedDims = new Set<number>([BUILTIN_DIMENSIONS]);
  private totalCache?: { at: number; n: number };

  constructor(
    private readonly db: Db,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async vectorMode(): Promise<VectorMode> {
    if (this.mode) return this.mode;
    const res = await this.db.execute<{ t: string }>(sql`
      select format_type(atttypid, atttypmod) as t from pg_attribute
      where attrelid = 'core.ai_chunks'::regclass and attname = 'embedding'`);
    this.mode = res.rows[0]?.t === 'vector' ? 'pgvector' : 'portable';
    if (this.mode === 'portable' && process.env.NODE_ENV === 'production')
      this.logger.warn(
        'pgvector is not installed: semantic search uses the slow portable fallback. Use a Postgres image with pgvector (e.g. pgvector/pgvector:pg17) and re-run migrations on a fresh database.',
      );
    return this.mode;
  }

  private vectorLiteral(v: number[], mode: VectorMode): SQL {
    const body = v.map((x) => (Number.isFinite(x) ? x.toFixed(6) : '0')).join(',');
    return mode === 'pgvector' ? sql`${`[${body}]`}::vector` : sql`${`{${body}}`}::real[]`;
  }

  /** HNSW index per embedding size (pgvector mode); idempotent. */
  async ensureVectorIndex(dims: number) {
    if ((await this.vectorMode()) !== 'pgvector' || this.indexedDims.has(dims)) return;
    if (!Number.isInteger(dims) || dims < 1 || dims > 4000) return;
    await this.db.execute(
      sql.raw(
        `create index if not exists ai_chunks_hnsw_${dims} on core.ai_chunks using hnsw ((embedding::vector(${dims})) vector_cosine_ops) where dims = ${dims}`,
      ),
    );
    this.indexedDims.add(dims);
  }

  async upsert(doc: AiIndexDocument, embedder: Embedder): Promise<void> {
    const mode = await this.vectorMode();
    const chunks = chunkText(doc.title, doc.text);
    const hashes = chunks.map((c) =>
      createHash('sha256').update(`${embedder.model}\n${c.text}`).digest('hex'),
    );
    const existing = await this.db
      .select({ chunkNo: aiChunks.chunkNo, contentHash: aiChunks.contentHash })
      .from(aiChunks)
      .where(and(eq(aiChunks.sourceType, doc.type), eq(aiChunks.sourceId, doc.id)));
    const known = new Map(existing.map((e) => [e.chunkNo, e.contentHash]));
    const stale = chunks.filter((c, i) => known.get(c.no) !== hashes[i]);
    const vectors = stale.length ? await embedder.embed(stale.map((c) => c.text)) : [];
    const vectorOf = new Map(stale.map((c, i) => [c.no, vectors[i]!]));
    const dims = vectors[0]?.length;
    if (dims) await this.ensureVectorIndex(dims).catch((err) => this.logger.warn({ err }, 'vector index'));
    // Chunk text starts with the title, so its terms include the title's.
    const titleTerms = searchTerms(doc.title);

    await this.db.transaction(async (tx) => {
      for (const [i, c] of chunks.entries()) {
        const terms = searchTerms(c.text);
        const meta = {
          title: doc.title.slice(0, 500),
          locale: doc.locale ?? null,
          href: doc.href ?? null,
          aclPermission: doc.acl.permission,
          aclScope: doc.acl.scope ?? null,
          aclUsers: doc.acl.users?.length ? doc.acl.users : null,
          metadata: doc.metadata ?? {},
          terms,
          titleTerms,
          termsVersion: TERMS_VERSION,
        };
        const vec = vectorOf.get(c.no);
        if (!vec) {
          // Same text and model: refresh ACL, metadata and terms only.
          await tx
            .update(aiChunks)
            .set(meta)
            .where(
              and(
                eq(aiChunks.sourceType, doc.type),
                eq(aiChunks.sourceId, doc.id),
                eq(aiChunks.chunkNo, c.no),
              ),
            );
          continue;
        }
        await tx.execute(sql`
          insert into core.ai_chunks (id, source_type, source_id, chunk_no, title, content, locale, href,
            acl_permission, acl_scope, acl_users, metadata, model, dims, content_hash, embedding, terms,
            title_terms, terms_version, updated_at)
          values (gen_random_uuid(), ${doc.type}, ${doc.id}, ${c.no}, ${meta.title}, ${c.text}, ${meta.locale},
            ${meta.href}, ${meta.aclPermission}, ${meta.aclScope ? JSON.stringify(meta.aclScope) : null}::jsonb,
            ${meta.aclUsers ? sql`${`{${meta.aclUsers.join(',')}}`}::uuid[]` : sql`null`},
            ${JSON.stringify(meta.metadata)}::jsonb, ${embedder.model}, ${vec.length}, ${hashes[i]!},
            ${this.vectorLiteral(vec, mode)}, ${textArray(terms)}::text[], ${textArray(titleTerms)}::text[],
            ${TERMS_VERSION}, now())
          on conflict (source_type, source_id, chunk_no) do update set
            title = excluded.title, content = excluded.content, locale = excluded.locale, href = excluded.href,
            acl_permission = excluded.acl_permission, acl_scope = excluded.acl_scope,
            acl_users = excluded.acl_users, metadata = excluded.metadata, model = excluded.model,
            dims = excluded.dims, content_hash = excluded.content_hash, embedding = excluded.embedding,
            terms = excluded.terms, title_terms = excluded.title_terms, terms_version = excluded.terms_version,
            updated_at = now()`);
      }
      await tx
        .delete(aiChunks)
        .where(
          and(
            eq(aiChunks.sourceType, doc.type),
            eq(aiChunks.sourceId, doc.id),
            gte(aiChunks.chunkNo, chunks.length),
          ),
        );

      // The document's row, and its attachments' chunks follow its title, ACL and metadata (or go).
      const files = filesRecordOf(doc);
      const row = {
        sourceType: doc.type,
        sourceId: doc.id,
        title: doc.title.slice(0, 500),
        locale: doc.locale ?? null,
        href: doc.href ?? null,
        aclPermission: doc.acl.permission,
        aclScope: doc.acl.scope ?? null,
        aclUsers: doc.acl.users?.length ? doc.acl.users : null,
        metadata: doc.metadata ?? {},
        filesRecordType: files?.type ?? null,
        filesRecordId: files?.id ?? null,
      };
      await tx
        .insert(aiDocuments)
        .values(row)
        .onConflictDoUpdate({
          target: [aiDocuments.sourceType, aiDocuments.sourceId],
          set: { ...row, updatedAt: new Date() },
        });
      const ofParent = and(eq(aiChunks.parentType, doc.type), eq(aiChunks.parentId, doc.id));
      if (!files) await tx.delete(aiChunks).where(ofParent);
      else
        await tx
          .update(aiChunks)
          .set({
            title: row.title,
            locale: row.locale,
            href: row.href,
            aclPermission: row.aclPermission,
            aclScope: row.aclScope,
            aclUsers: row.aclUsers,
            metadata: row.metadata,
          })
          .where(ofParent);
    });
  }

  /** Removes a document, its row and its attachments' chunks. */
  async remove(type: string, id: string) {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(aiChunks)
        .where(
          or(
            and(eq(aiChunks.sourceType, type), eq(aiChunks.sourceId, id)),
            and(eq(aiChunks.parentType, type), eq(aiChunks.parentId, id)),
          ),
        );
      await tx.delete(aiDocuments).where(and(eq(aiDocuments.sourceType, type), eq(aiDocuments.sourceId, id)));
    });
  }

  /** The indexed document whose record's attachments are indexed with it, if any. */
  async documentForFiles(record: { type: string; id: string }): Promise<IndexedDocument | null> {
    const [row] = await this.db
      .select()
      .from(aiDocuments)
      .where(and(eq(aiDocuments.filesRecordType, record.type), eq(aiDocuments.filesRecordId, record.id)))
      .orderBy(desc(aiDocuments.updatedAt))
      .limit(1);
    return row ?? null;
  }

  /** Whether a file already has chunks (with the current embedding model). */
  async fileIndexed(fileId: string, model: string): Promise<boolean> {
    const [row] = await this.db
      .select({ n: aiChunks.chunkNo })
      .from(aiChunks)
      .where(
        and(eq(aiChunks.sourceType, FILE_TYPE), eq(aiChunks.sourceId, fileId), eq(aiChunks.model, model)),
      )
      .limit(1);
    return Boolean(row);
  }

  /**
   * Indexes an attachment's text as chunks of `parent` (its record's indexed document): per page, each chunk
   * prefixed with the document title and file name, carrying the document's ACL and metadata. Unchanged chunks
   * aren't re-embedded. Search returns the parent document, with the file and page.
   */
  async upsertFile(
    file: { id: string; name: string },
    pages: string[],
    parent: IndexedDocument,
    embedder: Embedder,
    maxChars = MAX_FILE_CHARS,
  ): Promise<number> {
    const mode = await this.vectorMode();
    const heading = `${parent.title} · ${file.name}`;
    const chunks: { no: number; text: string; page: number }[] = [];
    let budget = maxChars;
    for (const [i, text] of pages.entries()) {
      if (budget <= 0) break;
      const body = text.slice(0, budget);
      budget -= body.length;
      if (!body.trim()) continue;
      for (const c of chunkText(heading, body)) chunks.push({ no: chunks.length, text: c.text, page: i + 1 });
    }
    if (!chunks.length) {
      await this.removeFile(file.id);
      return 0;
    }
    const hashes = chunks.map((c) =>
      createHash('sha256').update(`${embedder.model}\n${c.text}`).digest('hex'),
    );
    const existing = await this.db
      .select({ chunkNo: aiChunks.chunkNo, contentHash: aiChunks.contentHash })
      .from(aiChunks)
      .where(and(eq(aiChunks.sourceType, FILE_TYPE), eq(aiChunks.sourceId, file.id)));
    const known = new Map(existing.map((e) => [e.chunkNo, e.contentHash]));
    const stale = chunks.filter((c, i) => known.get(c.no) !== hashes[i]);
    const vectors: number[][] = [];
    for (let i = 0; i < stale.length; i += 64)
      vectors.push(...(await embedder.embed(stale.slice(i, i + 64).map((c) => c.text))));
    const vectorOf = new Map(stale.map((c, i) => [c.no, vectors[i]!]));
    const dims = vectors[0]?.length;
    if (dims) await this.ensureVectorIndex(dims).catch((err) => this.logger.warn({ err }, 'vector index'));
    const titleTerms = searchTerms(heading);

    await this.db.transaction(async (tx) => {
      for (const [i, c] of chunks.entries()) {
        const vec = vectorOf.get(c.no);
        const terms = searchTerms(c.text);
        if (!vec) {
          await tx
            .update(aiChunks)
            .set({ terms, titleTerms, termsVersion: TERMS_VERSION, page: c.page, fileName: file.name })
            .where(
              and(
                eq(aiChunks.sourceType, FILE_TYPE),
                eq(aiChunks.sourceId, file.id),
                eq(aiChunks.chunkNo, c.no),
              ),
            );
          continue;
        }
        await tx.execute(sql`
          insert into core.ai_chunks (id, source_type, source_id, chunk_no, title, content, locale, href,
            acl_permission, acl_scope, acl_users, metadata, model, dims, content_hash, embedding, terms,
            title_terms, terms_version, parent_type, parent_id, file_name, page, updated_at)
          values (gen_random_uuid(), ${FILE_TYPE}, ${file.id}, ${c.no}, ${parent.title}, ${c.text},
            ${parent.locale}, ${parent.href}, ${parent.aclPermission},
            ${parent.aclScope ? JSON.stringify(parent.aclScope) : null}::jsonb,
            ${parent.aclUsers?.length ? sql`${`{${parent.aclUsers.join(',')}}`}::uuid[]` : sql`null`},
            ${JSON.stringify(parent.metadata ?? {})}::jsonb, ${embedder.model}, ${vec.length}, ${hashes[i]!},
            ${this.vectorLiteral(vec, mode)}, ${textArray(terms)}::text[], ${textArray(titleTerms)}::text[],
            ${TERMS_VERSION}, ${parent.sourceType}, ${parent.sourceId}, ${file.name.slice(0, 255)}, ${c.page}, now())
          on conflict (source_type, source_id, chunk_no) do update set
            title = excluded.title, content = excluded.content, locale = excluded.locale, href = excluded.href,
            acl_permission = excluded.acl_permission, acl_scope = excluded.acl_scope,
            acl_users = excluded.acl_users, metadata = excluded.metadata, model = excluded.model,
            dims = excluded.dims, content_hash = excluded.content_hash, embedding = excluded.embedding,
            terms = excluded.terms, title_terms = excluded.title_terms, terms_version = excluded.terms_version,
            parent_type = excluded.parent_type, parent_id = excluded.parent_id, file_name = excluded.file_name,
            page = excluded.page, updated_at = now()`);
      }
      await tx
        .delete(aiChunks)
        .where(
          and(
            eq(aiChunks.sourceType, FILE_TYPE),
            eq(aiChunks.sourceId, file.id),
            gte(aiChunks.chunkNo, chunks.length),
          ),
        );
    });
    return chunks.length;
  }

  async removeFile(fileId: string) {
    await this.db
      .delete(aiChunks)
      .where(and(eq(aiChunks.sourceType, FILE_TYPE), eq(aiChunks.sourceId, fileId)));
  }

  /** ACL permissions used by these document types that the caller holds at some scope. */
  private async visiblePermissions(types: string[], opts: AiSearchOptions): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ p: aiChunks.aclPermission })
      .from(aiChunks)
      .where(inArray(aiChunks.sourceType, types));
    return rows.map((r) => r.p).filter((p) => opts.auth.permissions.hasAny(p));
  }

  /** Chunks in the index (cached for a few minutes: it only scales the term weights). */
  private async totalChunks(): Promise<number> {
    if (this.totalCache && Date.now() - this.totalCache.at < 300_000) return this.totalCache.n;
    const res = await this.db.execute<{ n: number }>(sql`select count(*)::int as n from core.ai_chunks`);
    this.totalCache = { at: Date.now(), n: Number(res.rows[0]?.n ?? 0) };
    return this.totalCache.n;
  }

  /** How many chunks contain each term (GIN index lookups, one round trip). */
  private async documentFrequencies(terms: string[]): Promise<Map<string, number>> {
    const res = await this.db.execute<{ t: string; df: number }>(sql`
      select t, (select count(*)::int from core.ai_chunks where terms @> array[t]) as df
      from unnest(${textArray(terms)}::text[]) as t`);
    return new Map(res.rows.map((r) => [r.t, Number(r.df)]));
  }

  async search(
    query: string,
    opts: AiSearchOptions,
    embedder: Embedder,
    reranker?: Reranker | null,
  ): Promise<AiSearchHit[]> {
    const q = query.trim();
    if (!q || !opts.types.length) return [];
    const limit = Math.min(opts.limit ?? 5, 50);
    const mode = await this.vectorMode();
    const userId = opts.auth.user?.id ?? null;
    const permissions = await this.visiblePermissions(opts.types, opts);
    if (!permissions.length && !userId) return [];

    const aclFilter = sql`(${
      permissions.length
        ? sql`acl_permission in (${sql.join(
            permissions.map((p) => sql`${p}`),
            sql`, `,
          )})`
        : sql`false`
    }${userId ? sql` or acl_users @> ${`{${userId}}`}::uuid[]` : sql``})`;
    const where = sql.join(
      [
        // A document's own chunks, and its attachments' chunks (which carry its ACL and metadata).
        sql`(source_type in (${sql.join(
          opts.types.map((t) => sql`${t}`),
          sql`, `,
        )}) or parent_type in (${sql.join(
          opts.types.map((t) => sql`${t}`),
          sql`, `,
        )}))`,
        aclFilter,
        opts.filter && Object.keys(opts.filter).length
          ? sql`metadata @> ${JSON.stringify(opts.filter)}::jsonb`
          : sql`true`,
        opts.excludeIds?.length
          ? sql`coalesce(parent_id, source_id) not in (${sql.join(
              opts.excludeIds.map((i) => sql`${i}`),
              sql`, `,
            )})`
          : sql`true`,
      ],
      sql` and `,
    );

    const [qvec] = await embedder.embed([q]);
    const dims = qvec!.length;
    const lit = this.vectorLiteral(qvec!, mode);
    const distance =
      mode === 'pgvector'
        ? sql`(embedding::vector(${sql.raw(String(dims))}) <=> ${lit}::vector(${sql.raw(String(dims))}))`
        : sql`core.isbp_cosine_distance(embedding, ${lit})`;

    type Row = {
      id: string;
      source_type: string;
      source_id: string;
      title: string;
      content: string;
      locale: string | null;
      href: string | null;
      acl_permission: string;
      acl_scope: Record<string, string> | null;
      acl_users: string[] | null;
      metadata: Record<string, unknown>;
      parent_type: string | null;
      parent_id: string | null;
      file_name: string | null;
      page: number | null;
      dist: number;
    };
    const cols = sql`id, source_type, source_id, title, content, locale, href, acl_permission, acl_scope,
      acl_users, metadata, parent_type, parent_id, file_name, page, ${distance} as dist`;
    const vectorRows = await this.db.execute<Row>(sql`
      select ${cols} from core.ai_chunks
      where ${where} and model = ${embedder.model} and dims = ${dims}
      order by dist asc limit ${CANDIDATES}`);

    // Keyword arm: chunks sharing the query's terms, scored by the summed inverse document frequency of the terms
    // they contain (a title match counts double), so rare, specific words decide and common ones barely count.
    const terms = queryTerms(q);
    let keywordRows: Row[] = [];
    if (terms.length) {
      const [total, frequencies] = await Promise.all([this.totalChunks(), this.documentFrequencies(terms)]);
      const present = terms.filter((t) => (frequencies.get(t) ?? 0) > 0);
      const df = (t: string) => frequencies.get(t) ?? 0;
      // Common terms don't select candidates (that would score most of the index); the rarest ones always do.
      let selective = present.filter((t) => df(t) <= Math.max(50, total * COMMON_SHARE));
      if (!selective.length) selective = [...present].sort((a, b) => df(a) - df(b)).slice(0, 3);
      if (selective.length) {
        const score = sql.join(
          present.map((t) => {
            const one = sql`${textArray([t])}::text[]`;
            const w = idf(df(t), total);
            return sql`(case when terms @> ${one} then ${w}::float8 * (case when title_terms @> ${one} then 2 else 1 end) else 0 end)`;
          }),
          sql` + `,
        );
        keywordRows = (
          await this.db.execute<Row & { kscore: number }>(sql`
            select ${cols}, (${score}) as kscore from core.ai_chunks
            where ${where} and model = ${embedder.model} and dims = ${dims}
              and terms && ${textArray(selective)}::text[]
            order by kscore desc, dist asc limit ${CANDIDATES}`)
        ).rows;
      }
    }

    // Reciprocal Rank Fusion over documents: each list ranks a document once, at its best chunk (a long
    // document must not win by having many matching chunks).
    const docs = new Map<string, { row: Row; score: number; similarity: number; rerank?: number }>();
    const visible = (r: Row) =>
      (userId && r.acl_users?.includes(userId)) || opts.auth.can(r.acl_permission, r.acl_scope ?? undefined);
    const add = (rows: Row[]) => {
      const ranked = new Set<string>();
      for (const r of rows) {
        if (!visible(r)) continue;
        // An attachment's chunk counts for the document it belongs to.
        const key = `${r.parent_type ?? r.source_type}:${r.parent_id ?? r.source_id}`;
        const similarity = Math.max(0, Math.min(1, 1 - Number(r.dist)));
        const cur = docs.get(key);
        if (cur && similarity > cur.similarity) {
          cur.similarity = similarity;
          cur.row = r;
        }
        if (ranked.has(key)) continue;
        const s = 1 / (RRF_K + ranked.size + 1);
        ranked.add(key);
        if (cur) cur.score += s;
        else docs.set(key, { row: r, score: s, similarity });
      }
    };
    add(vectorRows.rows);
    add(keywordRows);

    const max = 2 / (RRF_K + 1);
    let ranked = [...docs.values()].sort((a, b) => b.score - a.score || b.similarity - a.similarity);

    // A reranker reads the query and each document's best chunk together, which beats both lists' rankings; if it
    // fails, search keeps the fused order rather than failing.
    if (reranker && ranked.length > 1) {
      const pool = ranked.slice(0, RERANK_POOL);
      try {
        const scores = await reranker.rerank(
          q,
          pool.map((d) => plainText(d.row.content).slice(0, RERANK_CHARS)),
        );
        pool.forEach((d, i) => (d.rerank = scores[i]));
        pool.sort((a, b) => (b.rerank ?? 0) - (a.rerank ?? 0));
        ranked = [...pool, ...ranked.slice(RERANK_POOL)];
      } catch (err) {
        this.logger.warn({ err }, 'reranker failed; keeping the fused order');
      }
    }

    return ranked.slice(0, limit).map(({ row, score, similarity, rerank }) => ({
      type: row.parent_type ?? row.source_type,
      id: row.parent_id ?? row.source_id,
      title: row.title,
      href: row.href,
      locale: row.locale,
      snippet: snippet(row.content, row.title, terms),
      score: rerank !== undefined ? Math.max(0, Math.min(1, rerank)) : Math.min(1, score / max),
      similarity,
      ...(rerank !== undefined ? { reranked: true } : {}),
      // The best passage was in an attachment: say which, and where.
      ...(row.source_type === FILE_TYPE
        ? { file: { id: row.source_id, name: row.file_name ?? '', page: row.page ?? null } }
        : {}),
      metadata: row.metadata ?? {},
    }));
  }

  /** Documents embedded with another model than the current one (re-embedded by the reindex job). */
  async staleDocuments(model: string, limit: number) {
    const res = await this.db.execute<{ source_type: string; source_id: string }>(sql`
      select distinct source_type, source_id from core.ai_chunks where model <> ${model} limit ${limit}`);
    return res.rows;
  }

  /**
   * Re-derives the search terms of chunks made by an older tokenizer, in batches until `budgetMs` is spent. Text and
   * vectors are untouched. Returns how many chunks were updated.
   */
  async retokenize(budgetMs = 30_000, batch = 500): Promise<number> {
    const started = Date.now();
    let done = 0;
    while (Date.now() - started < budgetMs) {
      const rows = await this.db
        .select({ id: aiChunks.id, title: aiChunks.title, content: aiChunks.content })
        .from(aiChunks)
        .where(lt(aiChunks.termsVersion, TERMS_VERSION))
        .limit(batch);
      if (!rows.length) break;
      await this.db.transaction(async (tx) => {
        for (const r of rows)
          await tx
            .update(aiChunks)
            .set({
              terms: searchTerms(r.content),
              titleTerms: searchTerms(r.title),
              termsVersion: TERMS_VERSION,
            })
            .where(eq(aiChunks.id, r.id));
      });
      done += rows.length;
    }
    return done;
  }

  async stats() {
    const res = await this.db.execute<{
      source_type: string;
      model: string;
      docs: number;
      chunks: number;
    }>(sql`
      select source_type, model, count(distinct source_id)::int as docs, count(*)::int as chunks
      from core.ai_chunks group by source_type, model order by source_type`);
    return res.rows;
  }

  /** Re-embeds every chunk of a document with the current embedder (text is kept). */
  async reembed(type: string, id: string, embedder: Embedder) {
    const mode = await this.vectorMode();
    const rows = await this.db
      .select({ chunkNo: aiChunks.chunkNo, content: aiChunks.content })
      .from(aiChunks)
      .where(and(eq(aiChunks.sourceType, type), eq(aiChunks.sourceId, id)));
    if (!rows.length) return;
    const vectors = await embedder.embed(rows.map((r) => r.content));
    if (vectors[0]) await this.ensureVectorIndex(vectors[0].length).catch(() => undefined);
    for (const [i, r] of rows.entries()) {
      const v = vectors[i]!;
      const hash = createHash('sha256').update(`${embedder.model}\n${r.content}`).digest('hex');
      await this.db.execute(sql`
        update core.ai_chunks set embedding = ${this.vectorLiteral(v, mode)}, model = ${embedder.model},
          dims = ${v.length}, content_hash = ${hash}, updated_at = now()
        where source_type = ${type} and source_id = ${id} and chunk_no = ${r.chunkNo}`);
    }
  }
}

/** Markdown → readable plain text for snippets (links keep their text, markers and emphasis go). */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/(\*\*|__|\*|_|~~|`)(?=\S)([^\n]*?\S)\1/g, '$2')
    .replace(/\|/g, ' ')
    .replace(/^[-:\s]{3,}$/gm, '');
}

/** The chunk text around the first matching term (without the repeated title line). */
function snippet(content: string, title: string, terms: string[]): string {
  // Chunks start with the title line (an attachment's adds the file name to it).
  const nl = content.indexOf('\n');
  const body = plainText(content.startsWith(title) ? (nl >= 0 ? content.slice(nl + 1).trim() : '') : content);
  const lower = body.normalize('NFKC').toLowerCase();
  const at =
    terms
      .map((t) => lower.indexOf(t))
      .filter((i) => i >= 0)
      .sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, at - 80);
  const text = body
    .slice(start, start + 320)
    .replace(/\s+/g, ' ')
    .trim();
  return `${start > 0 ? '…' : ''}${text}${start + 320 < body.length ? '…' : ''}`;
}
