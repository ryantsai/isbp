CREATE SCHEMA "itsm";
--> statement-breakpoint
CREATE SEQUENCE "itsm"."change_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "itsm"."incident_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "itsm"."problem_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "itsm"."service_request_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "itsm"."business_calendars" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"hours" jsonb NOT NULL,
	"holidays" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"always_open" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "itsm"."catalog_items" (
	"form_key" varchar(64) PRIMARY KEY NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"category_id" uuid,
	"group_id" uuid,
	"priority" smallint DEFAULT 3 NOT NULL,
	"fulfil_on" varchar(16) DEFAULT 'approved' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "itsm"."categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" varchar(64) NOT NULL,
	"name" jsonb NOT NULL,
	"parent_id" uuid,
	"ticket_types" text[] DEFAULT '{incident,service_request}'::text[] NOT NULL,
	"default_group_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "itsm"."changes" (
	"ticket_id" uuid PRIMARY KEY NOT NULL,
	"change_type" varchar(16) DEFAULT 'normal' NOT NULL,
	"risk" varchar(8) DEFAULT 'medium' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"planned_start" timestamp with time zone,
	"planned_end" timestamp with time zone,
	"implementation_plan" text DEFAULT '' NOT NULL,
	"backout_plan" text DEFAULT '' NOT NULL,
	"test_plan" text DEFAULT '' NOT NULL,
	"approval_instance_id" uuid
);
--> statement-breakpoint
CREATE TABLE "itsm"."problems" (
	"ticket_id" uuid PRIMARY KEY NOT NULL,
	"root_cause" text DEFAULT '' NOT NULL,
	"workaround" text DEFAULT '' NOT NULL,
	"known_error" boolean DEFAULT false NOT NULL,
	"kb_article_id" uuid,
	"kb_article" jsonb
);
--> statement-breakpoint
CREATE TABLE "itsm"."sla_policies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"ticket_types" text[] NOT NULL,
	"condition" jsonb,
	"targets" jsonb NOT NULL,
	"calendar_id" uuid NOT NULL,
	"pause_statuses" text[] DEFAULT '{on_hold}'::text[] NOT NULL,
	"warn_at" double precision DEFAULT 0.75 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "itsm"."ticket_activities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ticket_id" uuid NOT NULL,
	"kind" varchar(16) NOT NULL,
	"public" boolean DEFAULT false NOT NULL,
	"author_id" uuid,
	"author_name" varchar(200),
	"author_ai" boolean DEFAULT false NOT NULL,
	"body" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "itsm"."ticket_cis" (
	"ticket_id" uuid NOT NULL,
	"ci_id" uuid NOT NULL,
	CONSTRAINT "ticket_cis_ticket_id_ci_id_pk" PRIMARY KEY("ticket_id","ci_id")
);
--> statement-breakpoint
CREATE TABLE "itsm"."ticket_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"type" varchar(20) NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "itsm"."ticket_slas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ticket_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"metric" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'running' NOT NULL,
	"target_minutes" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"warn_at" timestamp with time zone NOT NULL,
	"paused_at" timestamp with time zone,
	"paused_ms" bigint DEFAULT 0 NOT NULL,
	"stopped_at" timestamp with time zone,
	"warned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "itsm"."tickets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" varchar(20) NOT NULL,
	"number" bigint NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" varchar(24) NOT NULL,
	"impact" smallint DEFAULT 2 NOT NULL,
	"urgency" smallint DEFAULT 2 NOT NULL,
	"priority" smallint DEFAULT 3 NOT NULL,
	"priority_overridden" boolean DEFAULT false NOT NULL,
	"category_id" uuid,
	"requester_id" uuid,
	"requested_for_id" uuid,
	"department_id" uuid,
	"assignment_group_id" uuid,
	"assignee_id" uuid,
	"channel" varchar(16) DEFAULT 'portal' NOT NULL,
	"source" jsonb,
	"answers" jsonb,
	"major" boolean DEFAULT false NOT NULL,
	"resolution_code" varchar(32),
	"resolution_notes" text,
	"satisfaction" smallint,
	"satisfaction_comment" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"manual_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"triaged_at" timestamp with time zone,
	"triaged_by" jsonb,
	"first_response_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "itsm"."catalog_items" ADD CONSTRAINT "catalog_items_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "itsm"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itsm"."catalog_items" ADD CONSTRAINT "catalog_items_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "core"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itsm"."categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "itsm"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itsm"."categories" ADD CONSTRAINT "categories_default_group_id_groups_id_fk" FOREIGN KEY ("default_group_id") REFERENCES "core"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itsm"."changes" ADD CONSTRAINT "changes_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "itsm"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itsm"."problems" ADD CONSTRAINT "problems_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "itsm"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itsm"."sla_policies" ADD CONSTRAINT "sla_policies_calendar_id_business_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "itsm"."business_calendars"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itsm"."ticket_activities" ADD CONSTRAINT "ticket_activities_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "itsm"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itsm"."ticket_activities" ADD CONSTRAINT "ticket_activities_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itsm"."ticket_cis" ADD CONSTRAINT "ticket_cis_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "itsm"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itsm"."ticket_cis" ADD CONSTRAINT "ticket_cis_ci_id_cis_id_fk" FOREIGN KEY ("ci_id") REFERENCES "cmdb"."cis"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itsm"."ticket_links" ADD CONSTRAINT "ticket_links_source_id_tickets_id_fk" FOREIGN KEY ("source_id") REFERENCES "itsm"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itsm"."ticket_links" ADD CONSTRAINT "ticket_links_target_id_tickets_id_fk" FOREIGN KEY ("target_id") REFERENCES "itsm"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itsm"."ticket_links" ADD CONSTRAINT "ticket_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itsm"."ticket_slas" ADD CONSTRAINT "ticket_slas_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "itsm"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itsm"."ticket_slas" ADD CONSTRAINT "ticket_slas_policy_id_sla_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "itsm"."sla_policies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itsm"."tickets" ADD CONSTRAINT "tickets_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "itsm"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itsm"."tickets" ADD CONSTRAINT "tickets_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itsm"."tickets" ADD CONSTRAINT "tickets_requested_for_id_users_id_fk" FOREIGN KEY ("requested_for_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itsm"."tickets" ADD CONSTRAINT "tickets_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "core"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itsm"."tickets" ADD CONSTRAINT "tickets_assignment_group_id_groups_id_fk" FOREIGN KEY ("assignment_group_id") REFERENCES "core"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itsm"."tickets" ADD CONSTRAINT "tickets_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itsm"."tickets" ADD CONSTRAINT "tickets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_key_uq" ON "itsm"."categories" USING btree ("key");--> statement-breakpoint
CREATE INDEX "categories_parent_idx" ON "itsm"."categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "changes_window_idx" ON "itsm"."changes" USING btree ("planned_start","planned_end") WHERE "itsm"."changes"."planned_start" is not null;--> statement-breakpoint
CREATE INDEX "changes_instance_idx" ON "itsm"."changes" USING btree ("approval_instance_id") WHERE "itsm"."changes"."approval_instance_id" is not null;--> statement-breakpoint
CREATE INDEX "sla_policies_order_idx" ON "itsm"."sla_policies" USING btree ("active","sort_order");--> statement-breakpoint
CREATE INDEX "ticket_activities_ticket_idx" ON "itsm"."ticket_activities" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "ticket_cis_ci_idx" ON "itsm"."ticket_cis" USING btree ("ci_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_links_uq" ON "itsm"."ticket_links" USING btree ("source_id","target_id","type");--> statement-breakpoint
CREATE INDEX "ticket_links_target_idx" ON "itsm"."ticket_links" USING btree ("target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_slas_ticket_metric_uq" ON "itsm"."ticket_slas" USING btree ("ticket_id","metric");--> statement-breakpoint
CREATE INDEX "ticket_slas_due_idx" ON "itsm"."ticket_slas" USING btree ("due_at") WHERE "itsm"."ticket_slas"."status" = 'running';--> statement-breakpoint
CREATE INDEX "ticket_slas_warn_idx" ON "itsm"."ticket_slas" USING btree ("warn_at") WHERE "itsm"."ticket_slas"."status" = 'running' and "itsm"."ticket_slas"."warned_at" is null;--> statement-breakpoint
CREATE INDEX "ticket_slas_breached_idx" ON "itsm"."ticket_slas" USING btree ("ticket_id") WHERE "itsm"."ticket_slas"."status" = 'breached';--> statement-breakpoint
CREATE INDEX "ticket_slas_policy_idx" ON "itsm"."ticket_slas" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "ticket_slas_started_idx" ON "itsm"."ticket_slas" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_type_number_uq" ON "itsm"."tickets" USING btree ("type","number");--> statement-breakpoint
CREATE INDEX "tickets_queue_idx" ON "itsm"."tickets" USING btree ("type","status","priority");--> statement-breakpoint
CREATE INDEX "tickets_group_status_idx" ON "itsm"."tickets" USING btree ("assignment_group_id","status");--> statement-breakpoint
CREATE INDEX "tickets_assignee_status_idx" ON "itsm"."tickets" USING btree ("assignee_id","status");--> statement-breakpoint
CREATE INDEX "tickets_requester_idx" ON "itsm"."tickets" USING btree ("requester_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tickets_requested_for_idx" ON "itsm"."tickets" USING btree ("requested_for_id") WHERE "itsm"."tickets"."requested_for_id" is not null;--> statement-breakpoint
CREATE INDEX "tickets_created_idx" ON "itsm"."tickets" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tickets_resolved_idx" ON "itsm"."tickets" USING btree ("resolved_at") WHERE "itsm"."tickets"."resolved_at" is not null;--> statement-breakpoint
CREATE INDEX "tickets_title_trgm" ON "itsm"."tickets" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "tickets_department_idx" ON "itsm"."tickets" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "tickets_category_idx" ON "itsm"."tickets" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "tickets_major_idx" ON "itsm"."tickets" USING btree ("status") WHERE "itsm"."tickets"."major";--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_source_uq" ON "itsm"."tickets" USING btree (("source"->>'id')) WHERE "itsm"."tickets"."source" is not null;