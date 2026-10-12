CREATE TABLE "core"."ai_documents" (
	"source_type" varchar(64) NOT NULL,
	"source_id" varchar(64) NOT NULL,
	"title" varchar(500) NOT NULL,
	"locale" varchar(10),
	"href" varchar(500),
	"acl_permission" varchar(150) NOT NULL,
	"acl_scope" jsonb,
	"acl_users" uuid[],
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"files_record_type" varchar(120),
	"files_record_id" varchar(64),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_documents_source_type_source_id_pk" PRIMARY KEY("source_type","source_id")
);
--> statement-breakpoint
CREATE TABLE "core"."file_texts" (
	"file_id" uuid PRIMARY KEY NOT NULL,
	"status" varchar(20) NOT NULL,
	"producer" varchar(60),
	"pages" text[] DEFAULT '{}'::text[] NOT NULL,
	"chars" integer DEFAULT 0 NOT NULL,
	"error" varchar(300),
	"attempts" integer DEFAULT 0 NOT NULL,
	"extracted_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core"."ai_chunks" ADD COLUMN "parent_type" varchar(64);--> statement-breakpoint
ALTER TABLE "core"."ai_chunks" ADD COLUMN "parent_id" varchar(64);--> statement-breakpoint
ALTER TABLE "core"."ai_chunks" ADD COLUMN "file_name" varchar(255);--> statement-breakpoint
ALTER TABLE "core"."ai_chunks" ADD COLUMN "page" integer;--> statement-breakpoint
ALTER TABLE "core"."file_texts" ADD CONSTRAINT "file_texts_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "core"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_documents_files_idx" ON "core"."ai_documents" USING btree ("files_record_type","files_record_id");--> statement-breakpoint
CREATE INDEX "file_texts_status_idx" ON "core"."file_texts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ai_chunks_parent_idx" ON "core"."ai_chunks" USING btree ("parent_type","parent_id");--> statement-breakpoint
-- Documents indexed before Phase 10: one row each, from their first chunk (no attachments until re-indexed).
INSERT INTO "core"."ai_documents" ("source_type", "source_id", "title", "locale", "href", "acl_permission", "acl_scope", "acl_users", "metadata")
SELECT DISTINCT ON ("source_type", "source_id") "source_type", "source_id", "title", "locale", "href", "acl_permission", "acl_scope", "acl_users", "metadata"
FROM "core"."ai_chunks" ORDER BY "source_type", "source_id", "chunk_no"
ON CONFLICT DO NOTHING;
