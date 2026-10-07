ALTER TABLE "projects"."project_updates" ADD COLUMN "author_name" varchar(200);--> statement-breakpoint
ALTER TABLE "projects"."project_updates" ADD COLUMN "via" jsonb;--> statement-breakpoint
ALTER TABLE "projects"."task_activity" ADD COLUMN "actor_name" varchar(200);--> statement-breakpoint
ALTER TABLE "projects"."task_activity" ADD COLUMN "via" jsonb;--> statement-breakpoint
ALTER TABLE "projects"."task_comments" ADD COLUMN "author_name" varchar(200);--> statement-breakpoint
ALTER TABLE "projects"."task_comments" ADD COLUMN "author_email" varchar(320);--> statement-breakpoint
ALTER TABLE "projects"."task_comments" ADD COLUMN "via" jsonb;--> statement-breakpoint
CREATE INDEX "tasks_project_updated_idx" ON "projects"."tasks" USING btree ("project_id","updated_at","id");