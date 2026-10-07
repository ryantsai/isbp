-- Embedding storage for core.ai_chunks. pgvector when the server has it (production images:
-- pgvector/pgvector), otherwise a portable real[] column with a SQL cosine distance (embedded dev Postgres).
-- The column is not declared in the Drizzle schema; the AI gateway reads and writes it with raw SQL and
-- detects the mode from the column's type.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    CREATE EXTENSION IF NOT EXISTS vector;
    ALTER TABLE core.ai_chunks ADD COLUMN embedding vector;
    -- HNSW needs a fixed dimension: one partial expression index per embedding size. The builtin
    -- embedder (384) gets one here; the gateway creates others when an admin picks another model.
    EXECUTE 'CREATE INDEX ai_chunks_hnsw_384 ON core.ai_chunks USING hnsw ((embedding::vector(384)) vector_cosine_ops) WHERE dims = 384';
  ELSE
    ALTER TABLE core.ai_chunks ADD COLUMN embedding real[];
  END IF;
END
$$;
--> statement-breakpoint
-- Cosine distance for the portable mode (inputs are unit-length, so this is 1 - dot product).
CREATE OR REPLACE FUNCTION core.isbp_cosine_distance(a real[], b real[]) RETURNS double precision
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT 1 - coalesce(sum(x * y), 0) FROM unnest(a, b) AS t(x, y)
$$;
