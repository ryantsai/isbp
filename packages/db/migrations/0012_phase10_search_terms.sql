DROP INDEX "core"."ai_chunks_content_trgm_idx";--> statement-breakpoint
DROP INDEX "core"."ai_chunks_title_trgm_idx";--> statement-breakpoint
ALTER TABLE "core"."ai_chunks" ADD COLUMN "terms" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."ai_chunks" ADD COLUMN "title_terms" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."ai_chunks" ADD COLUMN "terms_version" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "ai_chunks_terms_idx" ON "core"."ai_chunks" USING gin ("terms");--> statement-breakpoint
CREATE INDEX "ai_chunks_terms_version_idx" ON "core"."ai_chunks" USING btree ("terms_version");