CREATE SCHEMA "etl";
--> statement-breakpoint
CREATE TABLE "etl"."calls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"version" integer,
	"caller_type" varchar(8) NOT NULL,
	"user_id" uuid,
	"client_id" uuid,
	"caller_name" varchar(200) NOT NULL,
	"status" integer NOT NULL,
	"error_code" varchar(64),
	"error_message" text,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"rows" integer,
	"cached" boolean DEFAULT false NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_id" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "etl"."endpoint_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"connection_id" uuid NOT NULL,
	"columns" jsonb NOT NULL,
	"note" text,
	"status" varchar(16) DEFAULT 'published' NOT NULL,
	"published_by" uuid,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deprecated_at" timestamp with time zone,
	"retired_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "etl"."endpoints" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"connection_id" uuid NOT NULL,
	"draft" jsonb NOT NULL,
	"draft_tested_hash" varchar(64),
	"draft_tested_at" timestamp with time zone,
	"draft_columns" jsonb,
	"allow_users" boolean DEFAULT true NOT NULL,
	"allowed_clients" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"rate_limit_per_minute" integer,
	"latest_version" integer,
	"connection_missing" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "etl"."pipeline_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"trigger" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'queued' NOT NULL,
	"triggered_by" uuid,
	"task_run_id" varchar(64),
	"rows_read" integer DEFAULT 0 NOT NULL,
	"rows_written" integer DEFAULT 0 NOT NULL,
	"rows_rejected" integer DEFAULT 0 NOT NULL,
	"watermark_from" varchar(200),
	"watermark_to" varchar(200),
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"heartbeat_at" timestamp with time zone,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"error" text,
	"log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "etl"."pipelines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"owner_id" uuid,
	"enabled" boolean DEFAULT true NOT NULL,
	"source_connection_id" uuid NOT NULL,
	"source_sql" text NOT NULL,
	"source_params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"watermark_column" varchar(128),
	"watermark_initial" varchar(200),
	"watermark" varchar(200),
	"target_connection_id" uuid NOT NULL,
	"target_schema" varchar(128),
	"target_table" varchar(128) NOT NULL,
	"mode" varchar(16) DEFAULT 'insert' NOT NULL,
	"key_columns" text[] DEFAULT '{}'::text[] NOT NULL,
	"mappings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"batch_size" integer DEFAULT 500 NOT NULL,
	"connection_missing" boolean DEFAULT false NOT NULL,
	"last_run_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "etl"."calls" ADD CONSTRAINT "calls_endpoint_id_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "etl"."endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etl"."endpoint_versions" ADD CONSTRAINT "endpoint_versions_endpoint_id_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "etl"."endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etl"."endpoint_versions" ADD CONSTRAINT "endpoint_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etl"."endpoints" ADD CONSTRAINT "endpoints_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etl"."pipeline_runs" ADD CONSTRAINT "pipeline_runs_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "etl"."pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etl"."pipeline_runs" ADD CONSTRAINT "pipeline_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etl"."pipelines" ADD CONSTRAINT "pipelines_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etl"."pipelines" ADD CONSTRAINT "pipelines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calls_endpoint_created_idx" ON "etl"."calls" USING btree ("endpoint_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "calls_created_idx" ON "etl"."calls" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "calls_user_idx" ON "etl"."calls" USING btree ("user_id") WHERE "etl"."calls"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "calls_client_idx" ON "etl"."calls" USING btree ("client_id") WHERE "etl"."calls"."client_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "endpoint_versions_uq" ON "etl"."endpoint_versions" USING btree ("endpoint_id","version");--> statement-breakpoint
CREATE INDEX "endpoint_versions_connection_idx" ON "etl"."endpoint_versions" USING btree ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "endpoints_slug_uq" ON "etl"."endpoints" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "endpoints_name_idx" ON "etl"."endpoints" USING btree ("name");--> statement-breakpoint
CREATE INDEX "endpoints_connection_idx" ON "etl"."endpoints" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "endpoints_updated_idx" ON "etl"."endpoints" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "pipeline_runs_pipeline_created_idx" ON "etl"."pipeline_runs" USING btree ("pipeline_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "pipeline_runs_status_idx" ON "etl"."pipeline_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pipeline_runs_created_idx" ON "etl"."pipeline_runs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "pipelines_name_uq" ON "etl"."pipelines" USING btree ("name");--> statement-breakpoint
CREATE INDEX "pipelines_source_idx" ON "etl"."pipelines" USING btree ("source_connection_id");--> statement-breakpoint
CREATE INDEX "pipelines_target_idx" ON "etl"."pipelines" USING btree ("target_connection_id");