CREATE SCHEMA "projects";
--> statement-breakpoint
CREATE TABLE "projects"."members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(10) DEFAULT 'member' NOT NULL,
	"allocation_pct" smallint DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_allocation_ck" CHECK ("projects"."members"."allocation_pct" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "projects"."milestones" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"due_date" date,
	"status" varchar(10) DEFAULT 'open' NOT NULL,
	"completed_at" timestamp with time zone,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects"."project_updates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" varchar(10) NOT NULL,
	"from_value" varchar(20),
	"to_value" varchar(20) NOT NULL,
	"note" text,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects"."projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" varchar(10) NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"status" varchar(20) DEFAULT 'proposed' NOT NULL,
	"health" varchar(20) DEFAULT 'on_track' NOT NULL,
	"health_note" text,
	"health_updated_at" timestamp with time zone,
	"priority" varchar(10) DEFAULT 'medium' NOT NULL,
	"owner_id" uuid,
	"department_id" uuid,
	"visibility" varchar(10) DEFAULT 'internal' NOT NULL,
	"start_date" date,
	"target_date" date,
	"completed_at" timestamp with time zone,
	"budget_hours" integer,
	"next_task_number" integer DEFAULT 1 NOT NULL,
	"approval_instance_id" uuid,
	"approval_status" varchar(20),
	"approval_comment" text,
	"approval_decided_at" timestamp with time zone,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_key_ck" CHECK ("projects"."projects"."key" ~ '^[A-Z][A-Z0-9]{1,9}$'),
	CONSTRAINT "projects_budget_ck" CHECK ("projects"."projects"."budget_hours" is null or "projects"."projects"."budget_hours" >= 0)
);
--> statement-breakpoint
CREATE TABLE "projects"."task_activity" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"field" varchar(40),
	"from_value" text,
	"to_value" text,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects"."task_comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "projects"."task_dependencies" (
	"task_id" uuid NOT NULL,
	"depends_on_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_dependencies_pk" PRIMARY KEY("task_id","depends_on_id"),
	CONSTRAINT "task_dependencies_not_self" CHECK ("projects"."task_dependencies"."task_id" <> "projects"."task_dependencies"."depends_on_id")
);
--> statement-breakpoint
CREATE TABLE "projects"."tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" varchar(300) NOT NULL,
	"description" text,
	"type" varchar(10) DEFAULT 'task' NOT NULL,
	"parent_id" uuid,
	"status" varchar(20) DEFAULT 'todo' NOT NULL,
	"priority" varchar(10) DEFAULT 'medium' NOT NULL,
	"assignee_id" uuid,
	"reporter_id" uuid,
	"milestone_id" uuid,
	"start_date" date,
	"due_date" date,
	"estimate_hours" numeric(8, 2),
	"remaining_hours" numeric(8, 2),
	"rank" text COLLATE "C" NOT NULL,
	"labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"completed_at" timestamp with time zone,
	"reminded_due_date" date,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_dates_ck" CHECK ("projects"."tasks"."due_date" is null or "projects"."tasks"."start_date" is null or "projects"."tasks"."due_date" >= "projects"."tasks"."start_date"),
	CONSTRAINT "tasks_hours_ck" CHECK (("projects"."tasks"."estimate_hours" is null or "projects"."tasks"."estimate_hours" >= 0) and ("projects"."tasks"."remaining_hours" is null or "projects"."tasks"."remaining_hours" >= 0))
);
--> statement-breakpoint
ALTER TABLE "projects"."members" ADD CONSTRAINT "members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects"."members" ADD CONSTRAINT "members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects"."milestones" ADD CONSTRAINT "milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects"."project_updates" ADD CONSTRAINT "project_updates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects"."project_updates" ADD CONSTRAINT "project_updates_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects"."projects" ADD CONSTRAINT "projects_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects"."projects" ADD CONSTRAINT "projects_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "core"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects"."projects" ADD CONSTRAINT "projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects"."task_activity" ADD CONSTRAINT "task_activity_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "projects"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects"."task_activity" ADD CONSTRAINT "task_activity_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects"."task_comments" ADD CONSTRAINT "task_comments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "projects"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects"."task_comments" ADD CONSTRAINT "task_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects"."task_dependencies" ADD CONSTRAINT "task_dependencies_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "projects"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects"."task_dependencies" ADD CONSTRAINT "task_dependencies_depends_on_id_tasks_id_fk" FOREIGN KEY ("depends_on_id") REFERENCES "projects"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects"."task_dependencies" ADD CONSTRAINT "task_dependencies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects"."tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects"."tasks" ADD CONSTRAINT "tasks_parent_id_tasks_id_fk" FOREIGN KEY ("parent_id") REFERENCES "projects"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects"."tasks" ADD CONSTRAINT "tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects"."tasks" ADD CONSTRAINT "tasks_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects"."tasks" ADD CONSTRAINT "tasks_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "projects"."milestones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "members_project_user_uq" ON "projects"."members" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX "members_user_idx" ON "projects"."members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "milestones_project_idx" ON "projects"."milestones" USING btree ("project_id","sort");--> statement-breakpoint
CREATE INDEX "project_updates_project_idx" ON "projects"."project_updates" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_key_uq" ON "projects"."projects" USING btree ("key");--> statement-breakpoint
CREATE INDEX "projects_status_idx" ON "projects"."projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "projects_owner_idx" ON "projects"."projects" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "projects_department_idx" ON "projects"."projects" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "projects_updated_idx" ON "projects"."projects" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "projects_name_trgm" ON "projects"."projects" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "projects_attributes_gin" ON "projects"."projects" USING gin ("attributes" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX "task_activity_task_idx" ON "projects"."task_activity" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "task_comments_task_idx" ON "projects"."task_comments" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "task_dependencies_depends_on_idx" ON "projects"."task_dependencies" USING btree ("depends_on_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_project_number_uq" ON "projects"."tasks" USING btree ("project_id","number");--> statement-breakpoint
CREATE INDEX "tasks_board_idx" ON "projects"."tasks" USING btree ("project_id","status","rank");--> statement-breakpoint
CREATE INDEX "tasks_assignee_idx" ON "projects"."tasks" USING btree ("assignee_id","status");--> statement-breakpoint
CREATE INDEX "tasks_due_idx" ON "projects"."tasks" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "tasks_parent_idx" ON "projects"."tasks" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "tasks_milestone_idx" ON "projects"."tasks" USING btree ("milestone_id");--> statement-breakpoint
CREATE INDEX "tasks_updated_idx" ON "projects"."tasks" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "tasks_title_trgm" ON "projects"."tasks" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "tasks_labels_gin" ON "projects"."tasks" USING gin ("labels");--> statement-breakpoint
CREATE INDEX "tasks_attributes_gin" ON "projects"."tasks" USING gin ("attributes" jsonb_path_ops);