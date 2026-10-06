CREATE SEQUENCE "core"."request_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1000 CACHE 1;--> statement-breakpoint
CREATE TABLE "core"."approval_delegations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"delegate_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" varchar(300),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_delegations_not_self" CHECK ("core"."approval_delegations"."user_id" <> "core"."approval_delegations"."delegate_id"),
	CONSTRAINT "approval_delegations_window" CHECK ("core"."approval_delegations"."ends_at" > "core"."approval_delegations"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "core"."approval_tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"instance_id" uuid NOT NULL,
	"step_id" varchar(64) NOT NULL,
	"slot" integer NOT NULL,
	"assignee_id" uuid NOT NULL,
	"delegated_from_id" uuid,
	"is_escalation" boolean DEFAULT false NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"comment" text,
	"decided_at" timestamp with time zone,
	"decided_by_id" uuid,
	"due_at" timestamp with time zone,
	"remind_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	"breached_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."workflow_definitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" varchar(100) NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"trigger_key" varchar(150) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"draft" jsonb NOT NULL,
	"published_version" integer,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."workflow_events" (
	"seq" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "core"."workflow_events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"instance_id" uuid NOT NULL,
	"task_id" uuid,
	"step_id" varchar(64),
	"type" varchar(40) NOT NULL,
	"actor_id" uuid,
	"actor_name" varchar(200),
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."workflow_instances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"definition_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"trigger_key" varchar(150) NOT NULL,
	"module_id" varchar(64) NOT NULL,
	"subject_type" varchar(100) NOT NULL,
	"subject_id" varchar(200) NOT NULL,
	"subject_label" jsonb NOT NULL,
	"subject_href" varchar(500),
	"requester_id" uuid,
	"subject_user_id" uuid,
	"status" varchar(20) DEFAULT 'running' NOT NULL,
	"facts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" jsonb NOT NULL,
	"outcome_comment" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."workflow_versions" (
	"definition_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"graph" jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" uuid,
	CONSTRAINT "workflow_versions_definition_id_version_pk" PRIMARY KEY("definition_id","version")
);
--> statement-breakpoint
CREATE TABLE "core"."custom_fields" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_type" varchar(100) NOT NULL,
	"key" varchar(64) NOT NULL,
	"field" jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."form_submissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" bigint DEFAULT nextval('core.request_number_seq') NOT NULL,
	"form_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"submitted_by" uuid,
	"data" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'submitted' NOT NULL,
	"workflow_instance_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "core"."form_versions" (
	"form_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"schema" jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" uuid,
	CONSTRAINT "form_versions_form_id_version_pk" PRIMARY KEY("form_id","version")
);
--> statement-breakpoint
CREATE TABLE "core"."forms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" varchar(100) NOT NULL,
	"name" jsonb NOT NULL,
	"description" jsonb,
	"icon" varchar(64) DEFAULT 'file-text' NOT NULL,
	"category" varchar(64),
	"draft" jsonb NOT NULL,
	"published_version" integer,
	"workflow_definition_id" uuid,
	"audience" jsonb DEFAULT '{"type":"everyone"}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."access_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" bigint DEFAULT nextval('core.request_number_seq') NOT NULL,
	"requester_id" uuid,
	"beneficiary_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"scope_type" "core"."scope_type" DEFAULT 'global' NOT NULL,
	"scope_department_id" uuid,
	"duration_days" integer,
	"justification" text NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"workflow_instance_id" uuid,
	"assignment_id" uuid,
	"expires_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."notification_channels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"type" varchar(20) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"secrets" text NOT NULL,
	"host" varchar(255) NOT NULL,
	"locale" varchar(10) DEFAULT 'en' NOT NULL,
	"types" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_delivery_at" timestamp with time zone,
	"last_error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."notification_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"notification_id" uuid,
	"channel_id" uuid,
	"channel" varchar(20) NOT NULL,
	"type" varchar(150) NOT NULL,
	"recipient" varchar(320) NOT NULL,
	"locale" varchar(10) DEFAULT 'en' NOT NULL,
	"title" varchar(300) NOT NULL,
	"body" text,
	"href" varchar(500),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(150) NOT NULL,
	"module_id" varchar(64) NOT NULL,
	"title" varchar(300) NOT NULL,
	"body" text,
	"href" varchar(500),
	"data" jsonb,
	"actor_id" uuid,
	"actor_name" varchar(200),
	"in_app" boolean DEFAULT true NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."api_client_secrets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"api_client_id" uuid NOT NULL,
	"prefix" varchar(24) NOT NULL,
	"secret_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."api_clients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" varchar(64) NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"application_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"all_applications" boolean DEFAULT false NOT NULL,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"allowed_cidrs" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_used_at" timestamp with time zone,
	"last_used_ip" varchar(64),
	"revoked_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core"."departments" ADD COLUMN "attributes" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."groups" ADD COLUMN "attributes" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."applications" ADD COLUMN "homepage_url" varchar(500);--> statement-breakpoint
ALTER TABLE "core"."role_assignments" ADD COLUMN "expiry_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "core"."roles" ADD COLUMN "requestable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."roles" ADD COLUMN "risk_level" varchar(10) DEFAULT 'low' NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."roles" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "core"."roles" ADD COLUMN "max_duration_days" integer;--> statement-breakpoint
ALTER TABLE "core"."roles" ADD COLUMN "request_workflow_id" uuid;--> statement-breakpoint
ALTER TABLE "core"."approval_delegations" ADD CONSTRAINT "approval_delegations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."approval_delegations" ADD CONSTRAINT "approval_delegations_delegate_id_users_id_fk" FOREIGN KEY ("delegate_id") REFERENCES "core"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."approval_tasks" ADD CONSTRAINT "approval_tasks_instance_id_workflow_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "core"."workflow_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."approval_tasks" ADD CONSTRAINT "approval_tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "core"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."approval_tasks" ADD CONSTRAINT "approval_tasks_delegated_from_id_users_id_fk" FOREIGN KEY ("delegated_from_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."approval_tasks" ADD CONSTRAINT "approval_tasks_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."workflow_definitions" ADD CONSTRAINT "workflow_definitions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."workflow_definitions" ADD CONSTRAINT "workflow_definitions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."workflow_events" ADD CONSTRAINT "workflow_events_instance_id_workflow_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "core"."workflow_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."workflow_instances" ADD CONSTRAINT "workflow_instances_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "core"."workflow_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."workflow_instances" ADD CONSTRAINT "workflow_instances_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."workflow_instances" ADD CONSTRAINT "workflow_instances_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."workflow_versions" ADD CONSTRAINT "workflow_versions_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "core"."workflow_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."workflow_versions" ADD CONSTRAINT "workflow_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."custom_fields" ADD CONSTRAINT "custom_fields_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."form_submissions" ADD CONSTRAINT "form_submissions_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "core"."forms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."form_submissions" ADD CONSTRAINT "form_submissions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."form_submissions" ADD CONSTRAINT "form_submissions_workflow_instance_id_workflow_instances_id_fk" FOREIGN KEY ("workflow_instance_id") REFERENCES "core"."workflow_instances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."form_versions" ADD CONSTRAINT "form_versions_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "core"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."form_versions" ADD CONSTRAINT "form_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."forms" ADD CONSTRAINT "forms_workflow_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("workflow_definition_id") REFERENCES "core"."workflow_definitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."forms" ADD CONSTRAINT "forms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."forms" ADD CONSTRAINT "forms_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."access_requests" ADD CONSTRAINT "access_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."access_requests" ADD CONSTRAINT "access_requests_beneficiary_id_users_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "core"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."access_requests" ADD CONSTRAINT "access_requests_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "core"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."access_requests" ADD CONSTRAINT "access_requests_scope_department_id_departments_id_fk" FOREIGN KEY ("scope_department_id") REFERENCES "core"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."access_requests" ADD CONSTRAINT "access_requests_workflow_instance_id_workflow_instances_id_fk" FOREIGN KEY ("workflow_instance_id") REFERENCES "core"."workflow_instances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."notification_channels" ADD CONSTRAINT "notification_channels_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "core"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."notification_deliveries" ADD CONSTRAINT "notification_deliveries_channel_id_notification_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "core"."notification_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."api_client_secrets" ADD CONSTRAINT "api_client_secrets_api_client_id_api_clients_id_fk" FOREIGN KEY ("api_client_id") REFERENCES "core"."api_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."api_client_secrets" ADD CONSTRAINT "api_client_secrets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."api_clients" ADD CONSTRAINT "api_clients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_delegations_user_idx" ON "core"."approval_delegations" USING btree ("user_id","ends_at");--> statement-breakpoint
CREATE INDEX "approval_tasks_assignee_idx" ON "core"."approval_tasks" USING btree ("assignee_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "approval_tasks_instance_idx" ON "core"."approval_tasks" USING btree ("instance_id","step_id");--> statement-breakpoint
CREATE INDEX "approval_tasks_due_idx" ON "core"."approval_tasks" USING btree ("due_at") WHERE "core"."approval_tasks"."status" = 'pending' and "core"."approval_tasks"."due_at" is not null and "core"."approval_tasks"."breached_at" is null;--> statement-breakpoint
CREATE INDEX "approval_tasks_remind_idx" ON "core"."approval_tasks" USING btree ("remind_at") WHERE "core"."approval_tasks"."status" = 'pending' and "core"."approval_tasks"."remind_at" is not null and "core"."approval_tasks"."reminded_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_definitions_key_uq" ON "core"."workflow_definitions" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_definitions_default_uq" ON "core"."workflow_definitions" USING btree ("trigger_key") WHERE "core"."workflow_definitions"."is_default" and "core"."workflow_definitions"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "workflow_definitions_trigger_idx" ON "core"."workflow_definitions" USING btree ("trigger_key");--> statement-breakpoint
CREATE INDEX "workflow_events_instance_idx" ON "core"."workflow_events" USING btree ("instance_id","seq");--> statement-breakpoint
CREATE INDEX "workflow_instances_status_idx" ON "core"."workflow_instances" USING btree ("status","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "workflow_instances_requester_idx" ON "core"."workflow_instances" USING btree ("requester_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "workflow_instances_subject_idx" ON "core"."workflow_instances" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "workflow_instances_trigger_idx" ON "core"."workflow_instances" USING btree ("trigger_key","status");--> statement-breakpoint
CREATE INDEX "workflow_instances_definition_idx" ON "core"."workflow_instances" USING btree ("definition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_fields_entity_key_uq" ON "core"."custom_fields" USING btree ("entity_type","key");--> statement-breakpoint
CREATE INDEX "custom_fields_entity_idx" ON "core"."custom_fields" USING btree ("entity_type","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "form_submissions_number_uq" ON "core"."form_submissions" USING btree ("number");--> statement-breakpoint
CREATE INDEX "form_submissions_submitter_idx" ON "core"."form_submissions" USING btree ("submitted_by","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "form_submissions_form_idx" ON "core"."form_submissions" USING btree ("form_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "form_submissions_status_idx" ON "core"."form_submissions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "forms_key_uq" ON "core"."forms" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "access_requests_number_uq" ON "core"."access_requests" USING btree ("number");--> statement-breakpoint
CREATE INDEX "access_requests_beneficiary_idx" ON "core"."access_requests" USING btree ("beneficiary_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "access_requests_requester_idx" ON "core"."access_requests" USING btree ("requester_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "access_requests_status_idx" ON "core"."access_requests" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "access_requests_role_idx" ON "core"."access_requests" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "access_requests_pending_uq" ON "core"."access_requests" USING btree ("beneficiary_id","role_id","scope_type",coalesce("scope_department_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "core"."access_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "notification_deliveries_created_idx" ON "core"."notification_deliveries" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notification_deliveries_pending_idx" ON "core"."notification_deliveries" USING btree ("created_at") WHERE "core"."notification_deliveries"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "notification_deliveries_notification_idx" ON "core"."notification_deliveries" USING btree ("notification_id");--> statement-breakpoint
CREATE INDEX "notification_deliveries_channel_idx" ON "core"."notification_deliveries" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "core"."notifications" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "core"."notifications" USING btree ("user_id") WHERE "core"."notifications"."read_at" is null and "core"."notifications"."in_app";--> statement-breakpoint
CREATE UNIQUE INDEX "api_client_secrets_hash_uq" ON "core"."api_client_secrets" USING btree ("secret_hash");--> statement-breakpoint
CREATE INDEX "api_client_secrets_client_idx" ON "core"."api_client_secrets" USING btree ("api_client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_clients_client_id_uq" ON "core"."api_clients" USING btree ("client_id");--> statement-breakpoint
ALTER TABLE "core"."roles" ADD CONSTRAINT "roles_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."roles" ADD CONSTRAINT "roles_request_workflow_id_workflow_definitions_id_fk" FOREIGN KEY ("request_workflow_id") REFERENCES "core"."workflow_definitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "departments_attributes_gin" ON "core"."departments" USING gin ("attributes" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX "groups_attributes_gin" ON "core"."groups" USING gin ("attributes" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX "users_attributes_gin" ON "core"."users" USING gin ("attributes" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX "roles_requestable_idx" ON "core"."roles" USING btree ("application_id") WHERE "core"."roles"."requestable";