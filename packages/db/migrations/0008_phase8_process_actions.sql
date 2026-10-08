CREATE TABLE "core"."process_action_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"submission_id" uuid NOT NULL,
	"form_version" integer NOT NULL,
	"action_id" varchar(64) NOT NULL,
	"type" varchar(100) NOT NULL,
	"outcome" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"decided_by" uuid,
	"result" jsonb,
	"error" text,
	"error_code" varchar(64),
	"next_attempt_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core"."process_action_runs" ADD CONSTRAINT "process_action_runs_submission_id_form_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "core"."form_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."process_action_runs" ADD CONSTRAINT "process_action_runs_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "process_action_runs_submission_action_uq" ON "core"."process_action_runs" USING btree ("submission_id","action_id");--> statement-breakpoint
CREATE INDEX "process_action_runs_status_idx" ON "core"."process_action_runs" USING btree ("status","next_attempt_at");