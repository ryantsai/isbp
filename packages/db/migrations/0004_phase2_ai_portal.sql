CREATE TABLE "core"."ai_chunks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_type" varchar(64) NOT NULL,
	"source_id" varchar(64) NOT NULL,
	"chunk_no" integer NOT NULL,
	"title" varchar(500) NOT NULL,
	"content" text NOT NULL,
	"locale" varchar(10),
	"href" varchar(500),
	"acl_permission" varchar(150) NOT NULL,
	"acl_scope" jsonb,
	"acl_users" uuid[],
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"model" varchar(150) NOT NULL,
	"dims" integer NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."ai_usage" (
	"id" uuid PRIMARY KEY NOT NULL,
	"module_id" varchar(64) NOT NULL,
	"feature" varchar(120) NOT NULL,
	"kind" varchar(20) NOT NULL,
	"principal_type" varchar(20) NOT NULL,
	"user_id" uuid,
	"principal_name" varchar(200),
	"provider" varchar(40) NOT NULL,
	"model" varchar(150),
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"status" varchar(20) NOT NULL,
	"error" varchar(300),
	"masked" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."portal_items" (
	"kind" varchar(64) NOT NULL,
	"entity_id" varchar(64) NOT NULL,
	"module_id" varchar(64) NOT NULL,
	"reference" varchar(40) NOT NULL,
	"title" jsonb NOT NULL,
	"state" varchar(10) NOT NULL,
	"status_key" varchar(150) NOT NULL,
	"tone" varchar(10),
	"href" varchar(500) NOT NULL,
	"icon" varchar(64),
	"people" uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_items_kind_entity_id_pk" PRIMARY KEY("kind","entity_id")
);
--> statement-breakpoint
ALTER TABLE "core"."form_submissions" ADD COLUMN "fulfilment" jsonb;--> statement-breakpoint
ALTER TABLE "core"."ai_usage" ADD CONSTRAINT "ai_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_chunks_source_uq" ON "core"."ai_chunks" USING btree ("source_type","source_id","chunk_no");--> statement-breakpoint
CREATE INDEX "ai_chunks_type_idx" ON "core"."ai_chunks" USING btree ("source_type","model");--> statement-breakpoint
CREATE INDEX "ai_chunks_content_trgm_idx" ON "core"."ai_chunks" USING gin ("content" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "ai_chunks_title_trgm_idx" ON "core"."ai_chunks" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "ai_chunks_metadata_idx" ON "core"."ai_chunks" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "ai_usage_created_idx" ON "core"."ai_usage" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ai_usage_feature_idx" ON "core"."ai_usage" USING btree ("feature","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "portal_items_people_idx" ON "core"."portal_items" USING gin ("people");