CREATE TABLE "core"."form_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"form_id" uuid NOT NULL,
	"title" varchar(300) NOT NULL,
	"assignee_user_id" uuid,
	"assignee_group_id" uuid,
	"period_key" varchar(32),
	"due_at" timestamp with time zone NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"submission_id" uuid,
	"source" jsonb NOT NULL,
	"dedupe_key" varchar(300),
	"note" text,
	"last_reminded_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."scheduled_reminders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"module_id" varchar(64) NOT NULL,
	"type" varchar(128) NOT NULL,
	"recipients" jsonb NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"href" text,
	"due_at" timestamp with time zone NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"source" jsonb,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core"."approval_tasks" ADD COLUMN "data" jsonb;--> statement-breakpoint
ALTER TABLE "core"."form_assignments" ADD CONSTRAINT "form_assignments_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "core"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."form_assignments" ADD CONSTRAINT "form_assignments_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."form_assignments" ADD CONSTRAINT "form_assignments_assignee_group_id_groups_id_fk" FOREIGN KEY ("assignee_group_id") REFERENCES "core"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."form_assignments" ADD CONSTRAINT "form_assignments_submission_id_form_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "core"."form_submissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."form_assignments" ADD CONSTRAINT "form_assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "form_assignments_dedupe_uq" ON "core"."form_assignments" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "form_assignments_status_due_idx" ON "core"."form_assignments" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "form_assignments_user_idx" ON "core"."form_assignments" USING btree ("assignee_user_id","status");--> statement-breakpoint
CREATE INDEX "form_assignments_group_idx" ON "core"."form_assignments" USING btree ("assignee_group_id","status");--> statement-breakpoint
CREATE INDEX "form_assignments_form_idx" ON "core"."form_assignments" USING btree ("form_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "scheduled_reminders_due_idx" ON "core"."scheduled_reminders" USING btree ("status","due_at");