CREATE TABLE "projects"."report_narratives" (
	"hash" varchar(64) PRIMARY KEY NOT NULL,
	"locale" varchar(10) NOT NULL,
	"period_key" varchar(10) NOT NULL,
	"template_id" uuid,
	"state" varchar(10) NOT NULL,
	"mode" varchar(10),
	"model" varchar(200),
	"input" jsonb,
	"content" jsonb,
	"error" text,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects"."report_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" varchar(40) NOT NULL,
	"name" jsonb NOT NULL,
	"description" jsonb,
	"sections" jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects"."status_schedule" (
	"id" varchar(20) PRIMARY KEY DEFAULT 'default' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"cadence" varchar(10) DEFAULT 'weekly' NOT NULL,
	"due_weekday" smallint DEFAULT 5 NOT NULL,
	"time_zone" varchar(64) DEFAULT 'Asia/Taipei' NOT NULL,
	"managers" boolean DEFAULT true NOT NULL,
	"group_key" varchar(100),
	"remind_days_before" smallint DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "status_schedule_singleton_ck" CHECK ("projects"."status_schedule"."id" = 'default'),
	CONSTRAINT "status_schedule_weekday_ck" CHECK ("projects"."status_schedule"."due_weekday" between 1 and 5),
	CONSTRAINT "status_schedule_remind_ck" CHECK ("projects"."status_schedule"."remind_days_before" between 0 and 3)
);
--> statement-breakpoint
CREATE TABLE "projects"."status_updates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"author_id" uuid,
	"period_key" varchar(10) NOT NULL,
	"cadence" varchar(10) NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"state" varchar(10) DEFAULT 'pending' NOT NULL,
	"expected" boolean DEFAULT true NOT NULL,
	"status" varchar(20),
	"progress" smallint,
	"forecast_date" date,
	"summary" text,
	"done" text,
	"next" text,
	"blockers" text,
	"asks" text,
	"signals" jsonb,
	"draft_mode" varchar(10),
	"submitted_at" timestamp with time zone,
	"edited_at" timestamp with time zone,
	"reminder_stage" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "status_updates_progress_ck" CHECK ("projects"."status_updates"."progress" is null or "projects"."status_updates"."progress" between 0 and 100),
	CONSTRAINT "status_updates_submitted_ck" CHECK ("projects"."status_updates"."state" <> 'submitted' or ("projects"."status_updates"."status" is not null and "projects"."status_updates"."summary" is not null and "projects"."status_updates"."submitted_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "projects"."report_narratives" ADD CONSTRAINT "report_narratives_template_id_report_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "projects"."report_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects"."report_narratives" ADD CONSTRAINT "report_narratives_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects"."report_templates" ADD CONSTRAINT "report_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects"."status_schedule" ADD CONSTRAINT "status_schedule_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects"."status_updates" ADD CONSTRAINT "status_updates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects"."status_updates" ADD CONSTRAINT "status_updates_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_narratives_created_idx" ON "projects"."report_narratives" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "report_templates_key_uq" ON "projects"."report_templates" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "status_updates_project_author_period_uq" ON "projects"."status_updates" USING btree ("project_id","author_id","period_key");--> statement-breakpoint
CREATE INDEX "status_updates_author_idx" ON "projects"."status_updates" USING btree ("author_id","state","due_at");--> statement-breakpoint
CREATE INDEX "status_updates_period_idx" ON "projects"."status_updates" USING btree ("period_key","state");--> statement-breakpoint
CREATE INDEX "status_updates_project_idx" ON "projects"."status_updates" USING btree ("project_id","submitted_at");