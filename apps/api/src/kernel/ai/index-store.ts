import { createHash } from 'node:crypto';
import { aiChunks } from '@isbp/db/schema';
import type { AiIndexDocument, AiSearchHit, AiSearchOptions, Db } from '@isbp/sdk/server';
import { and, eq, gte, inArray, sql, type SQL } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { chunkText } from './chunk';
import { BUILTIN_DIMENSIONS, stem } from './embedder';

export type VectorMode = 'pgvector' | 'portable';

export interface Embedder {
  model: string;
  embed(texts: string[]): Promise<number[][]>;
}

const RRF_K = 60;
const CANDIDATES = 40;
const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯]/;

/** Search terms that work in every language: Latin words (3+ chars) and CJK bigrams. */
export function keywordTerms(query: string): string[] {
  const terms = new Set<string>();
  for (const token of query
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)) {
    if (!token) continue;
    if (CJK.test(token)) {
      const chars = [...token];
      if (chars.length === 1) terms.add(token);
      for (let i = 0; i + 1 < chars.length; i++) terms.add(chars[i]! + chars[i + 1]!);
    } else if (token.length >= 3) terms.add(stem(token));
  }
  return [...terms].slice(0, 12);
}

/**
 * The shared semantic index (`core.ai_chunks`): chunking, embedding, ACL-filtered hybrid search.
 * The embedding column type decides the vector mode (see migration 0005).
 */
export class SemanticIndex {
  private mode?: VectorMode;
  private indexedDims = new Set<number>([BUILTIN_DIMENSIONS]);

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

    await this.db.transaction(async (tx) => {
      for (const [i, c] of chunks.entries()) {
        const meta = {
          title: doc.title.slice(0, 500),
          locale: doc.locale ?? null,
          href: doc.href ?? null,
          aclPermission: doc.acl.permission,
          aclScope: doc.acl.scope ?? null,
          aclUsers: doc.acl.users?.length ? doc.acl.users : null,
          metadata: doc.metadata ?? {},
        };
        const vec = vectorOf.get(c.no);
        if (!vec) {
          // Same text and model: refresh ACL/metadata only.
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
            acl_permission, acl_scope, acl_users, metadata, model, dims, content_hash, embedding, updated_at)
          values (gen_random_uuid(), ${doc.type}, ${doc.id}, ${c.no}, ${meta.title}, ${c.text}, ${meta.locale},
            ${meta.href}, ${meta.aclPermission}, ${meta.aclScope ? JSON.stringify(meta.aclScope) : null}::jsonb,
            ${meta.aclUsers ? sql`${`{${meta.aclUsers.join(',')}}`}::uuid[]` : sql`null`},
            ${JSON.stringify(meta.metadata)}::jsonb, ${embedder.model}, ${vec.length}, ${hashes[i]!},
            ${this.vectorLiteral(vec, mode)}, now())
          on conflict (source_type, source_id, chunk_no) do update set
            title = excluded.title, content = excluded.content, locale = excluded.locale, href = excluded.href,
            acl_permission = excluded.acl_permission, acl_scope = excluded.acl_scope,
            acl_users = excluded.acl_users, metadata = excluded.metadata, model = excluded.model,
            dims = excluded.dims, content_hash = excluded.content_hash, embedding = excluded.embedding,
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
    });
  }

  async remove(type: string, id: string) {
    await this.db.delete(aiChunks).where(and(eq(aiChunks.sourceType, type), eq(aiChunks.sourceId, id)));
  }

  /** ACL permissions used by these document types that the caller holds at some scope. */
  private async visiblePermissions(types: string[], opts: AiSearchOptions): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ p: aiChunks.aclPermission })
      .from(aiChunks)
      .where(inArray(aiChunks.sourceType, types));
    return rows.map((r) => r.p).filter((p) => opts.auth.permissions.hasAny(p));
  }

  async search(query: string, opts: AiSearchOptions, embedder: Embedder): Promise<AiSearchHit[]> {
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
        sql`source_type in (${sql.join(
          opts.types.map((t) => sql`${t}`),
          sql`, `,
        )})`,
        aclFilter,
        opts.filter && Object.keys(opts.filter).length
          ? sql`metadata @> ${JSON.stringify(opts.filter)}::jsonb`
          : sql`true`,
        opts.excludeIds?.length
          ? sql`source_id not in (${sql.join(
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
      dist: number;
    };
    const cols = sql`id, source_type, source_id, title, content, locale, href, acl_permission, acl_scope,
      acl_users, metadata, ${distance} as dist`;
    const vectorRows = await this.db.execute<Row>(sql`
      select ${cols} from core.ai_chunks
      where ${where} and model = ${embedder.model} and dims = ${dims}
      order by dist asc limit ${CANDIDATES}`);

    const terms = keywordTerms(q);
    const keywordRows = terms.length
      ? await this.db.execute<Row & { hits: number }>(sql`
          select ${cols}, (${sql.join(
            terms.map(
              (t) =>
                sql`(case when title ilike ${`%${t}%`} then 2 else 0 end + case when content ilike ${`%${t}%`} then 1 else 0 end)`,
            ),
            sql` + `,
          )}) as hits
          from core.ai_chunks
          where ${where} and model = ${embedder.model} and dims = ${dims}
            and (${sql.join(
              terms.map((t) => sql`content ilike ${`%${t}%`} or title ilike ${`%${t}%`}`),
              sql` or `,
            )})
          order by hits desc, dist asc limit ${CANDIDATES}`)
      : { rows: [] as (Row & { hits: number })[] };

    // Reciprocal Rank Fusion per document (best chunk wins the snippet).
    const docs = new Map<string, { row: Row; score: number; similarity: number }>();
    const visible = (r: Row) =>
      (userId && r.acl_users?.includes(userId)) || opts.auth.can(r.acl_permission, r.acl_scope ?? undefined);
    // Reciprocal Rank Fusion over documents: each list ranks a document once, at its best chunk (a long
    // document must not win by having many matching chunks).
    const add = (rows: Row[]) => {
      const ranked = new Set<string>();
      for (const r of rows) {
        if (!visible(r)) continue;
        const key = `${r.source_type}:${r.source_id}`;
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
    add(keywordRows.rows);

    const max = 2 / (RRF_K + 1);
    return [...docs.values()]
      .sort((a, b) => b.score - a.score || b.similarity - a.similarity)
      .slice(0, limit)
      .map(({ row, score, similarity }) => ({
        type: row.source_type,
        id: row.source_id,
        title: row.title,
        href: row.href,
        locale: row.locale,
        snippet: snippet(row.content, row.title, terms),
        score: Math.min(1, score / max),
        similarity,
        metadata: row.metadata ?? {},
      }));
  }

  /** Documents embedded with another model than the current one (re-embedded by the reindex job). */
  async staleDocuments(model: string, limit: number) {
    const res = await this.db.execute<{ source_type: string; source_id: string }>(sql`
      select distinct source_type, source_id from core.ai_chunks where model <> ${model} limit ${limit}`);
    return res.rows;
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
  const body = plainText(content.startsWith(title) ? content.slice(title.length).trim() : content);
  const lower = body.toLowerCase();
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
