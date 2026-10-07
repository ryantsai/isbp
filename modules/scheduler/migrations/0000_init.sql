CREATE SCHEMA "scheduler";
--> statement-breakpoint
CREATE TABLE "scheduler"."job_upstreams" (
	"job_id" uuid NOT NULL,
	"upstream_id" uuid NOT NULL,
	CONSTRAINT "job_upstreams_job_id_upstream_id_pk" PRIMARY KEY("job_id","upstream_id")
);
--> statement-breakpoint
CREATE TABLE "scheduler"."jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" serial NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"owner_id" uuid,
	"owner_group_id" uuid,
	"type" varchar(100) NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"trigger_kind" varchar(16) NOT NULL,
	"cron" varchar(120),
	"timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"interval_minutes" integer,
	"after_mode" varchar(8),
	"enabled" boolean DEFAULT true NOT NULL,
	"disabled_reason" varchar(16),
	"timeout_seconds" integer DEFAULT 3600 NOT NULL,
	"max_attempts" smallint DEFAULT 1 NOT NULL,
	"backoff" varchar(16) DEFAULT 'exponential' NOT NULL,
	"retry_delay_seconds" integer DEFAULT 60 NOT NULL,
	"concurrency" varchar(8) DEFAULT 'skip' NOT NULL,
	"notify_on_failure" boolean DEFAULT true NOT NULL,
	"notify_channels" boolean DEFAULT false NOT NULL,
	"auto_disable_after" smallint DEFAULT 0 NOT NULL,
	"next_run_at" timestamp with time zone,
	"last_queued_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"failure_streak" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_trigger_ck" CHECK ("scheduler"."jobs"."trigger_kind" in ('cron', 'interval', 'after', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "scheduler"."run_logs" (
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"level" varchar(8) DEFAULT 'info' NOT NULL,
	"attempt" smallint DEFAULT 1 NOT NULL,
	"message" text NOT NULL,
	CONSTRAINT "run_logs_run_id_seq_pk" PRIMARY KEY("run_id","seq")
);
--> statement-breakpoint
CREATE TABLE "scheduler"."runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"trigger" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'queued' NOT NULL,
	"skip_reason" varchar(16),
	"attempt" smallint DEFAULT 1 NOT NULL,
	"max_attempts" smallint DEFAULT 1 NOT NULL,
	"attempts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"wake_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"duration_ms" integer,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"cancelled_by" uuid,
	"triggered_by" uuid,
	"upstream_run_id" uuid,
	"summary" text,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"href" varchar(500),
	"error" text,
	"log_count" integer DEFAULT 0 NOT NULL,
	"log_truncated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduler"."job_upstreams" ADD CONSTRAINT "job_upstreams_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "scheduler"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduler"."job_upstreams" ADD CONSTRAINT "job_upstreams_upstream_id_jobs_id_fk" FOREIGN KEY ("upstream_id") REFERENCES "scheduler"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduler"."jobs" ADD CONSTRAINT "jobs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduler"."jobs" ADD CONSTRAINT "jobs_owner_group_id_groups_id_fk" FOREIGN KEY ("owner_group_id") REFERENCES "core"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduler"."jobs" ADD CONSTRAINT "jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduler"."jobs" ADD CONSTRAINT "jobs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduler"."run_logs" ADD CONSTRAINT "run_logs_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "scheduler"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduler"."runs" ADD CONSTRAINT "runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "scheduler"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduler"."runs" ADD CONSTRAINT "runs_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduler"."runs" ADD CONSTRAINT "runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_upstreams_upstream_idx" ON "scheduler"."job_upstreams" USING btree ("upstream_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_name_uq" ON "scheduler"."jobs" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_number_uq" ON "scheduler"."jobs" USING btree ("number");--> statement-breakpoint
CREATE INDEX "jobs_due_idx" ON "scheduler"."jobs" USING btree ("next_run_at") WHERE "scheduler"."jobs"."enabled" and "scheduler"."jobs"."next_run_at" is not null;--> statement-breakpoint
CREATE INDEX "jobs_type_idx" ON "scheduler"."jobs" USING btree ("type");--> statement-breakpoint
CREATE INDEX "jobs_owner_idx" ON "scheduler"."jobs" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "jobs_owner_group_idx" ON "scheduler"."jobs" USING btree ("owner_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_job_slot_uq" ON "scheduler"."runs" USING btree ("job_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "runs_job_created_idx" ON "scheduler"."runs" USING btree ("job_id","created_at");--> statement-breakpoint
CREATE INDEX "runs_created_idx" ON "scheduler"."runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "runs_active_idx" ON "scheduler"."runs" USING btree ("status") WHERE "scheduler"."runs"."status" in ('queued', 'running', 'retrying');