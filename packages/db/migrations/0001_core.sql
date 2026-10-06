CREATE SCHEMA "core";
--> statement-breakpoint
CREATE TYPE "core"."auth_source" AS ENUM('local', 'oidc', 'saml', 'ldap');--> statement-breakpoint
CREATE TYPE "core"."group_source" AS ENUM('local', 'oidc', 'saml', 'ldap', 'system');--> statement-breakpoint
CREATE TYPE "core"."idp_type" AS ENUM('oidc', 'saml', 'ldap');--> statement-breakpoint
CREATE TYPE "core"."scope_type" AS ENUM('global', 'department', 'record');--> statement-breakpoint
CREATE TYPE "core"."user_status" AS ENUM('pending', 'active', 'suspended', 'offboarded');--> statement-breakpoint
CREATE TABLE "core"."departments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" varchar(64) NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"parent_id" uuid,
	"path" text NOT NULL,
	"manager_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."group_members" (
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"source" varchar(20) DEFAULT 'manual' NOT NULL,
	"added_by" uuid,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_members_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "core"."groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" varchar(100) NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"source" "core"."group_source" DEFAULT 'local' NOT NULL,
	"external_id" varchar(512),
	"idp_id" uuid,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."identity_providers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" varchar(64) NOT NULL,
	"name" varchar(200) NOT NULL,
	"type" "core"."idp_type" NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"config" jsonb NOT NULL,
	"secrets" text,
	"jit_provisioning" boolean DEFAULT true NOT NULL,
	"default_department_id" uuid,
	"group_mappings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sync_enabled" boolean DEFAULT false NOT NULL,
	"sync_cron" varchar(100),
	"last_sync_at" timestamp with time zone,
	"last_sync_status" varchar(20),
	"last_sync_message" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"user_id" uuid NOT NULL,
	"csrf_token" varchar(64) NOT NULL,
	"idp_id" uuid,
	"ip" varchar(64),
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "core"."user_identities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"idp_id" uuid NOT NULL,
	"subject" varchar(512) NOT NULL,
	"email" varchar(320),
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" varchar(320) NOT NULL,
	"username" varchar(100) NOT NULL,
	"display_name" varchar(200) NOT NULL,
	"given_name" varchar(100),
	"family_name" varchar(100),
	"job_title" varchar(200),
	"phone" varchar(50),
	"employee_id" varchar(64),
	"avatar_url" text,
	"locale" varchar(10) DEFAULT 'en' NOT NULL,
	"timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"status" "core"."user_status" DEFAULT 'active' NOT NULL,
	"auth_source" "core"."auth_source" DEFAULT 'local' NOT NULL,
	"password_hash" text,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"department_id" uuid,
	"manager_id" uuid,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_login_at" timestamp with time zone,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"onboarded_at" timestamp with time zone,
	"offboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."applications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" varchar(64) NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"owner_id" uuid,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."permissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"application_id" uuid NOT NULL,
	"key" varchar(200) NOT NULL,
	"module_id" varchar(64),
	"description" text DEFAULT '' NOT NULL,
	"scopes" jsonb DEFAULT '["global"]'::jsonb NOT NULL,
	"deprecated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."role_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"role_id" uuid NOT NULL,
	"user_id" uuid,
	"group_id" uuid,
	"scope_type" "core"."scope_type" DEFAULT 'global' NOT NULL,
	"scope_department_id" uuid,
	"scope_record_type" varchar(100),
	"scope_record_id" varchar(200),
	"expires_at" timestamp with time zone,
	"source" varchar(20) DEFAULT 'manual' NOT NULL,
	"reason" text,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_assignments_uq" UNIQUE NULLS NOT DISTINCT("role_id","user_id","group_id","scope_type","scope_department_id","scope_record_type","scope_record_id"),
	CONSTRAINT "role_assignments_one_principal" CHECK (("core"."role_assignments"."user_id" is null) <> ("core"."role_assignments"."group_id" is null)),
	CONSTRAINT "role_assignments_scope_shape" CHECK (("core"."role_assignments"."scope_type" = 'global' and "core"."role_assignments"."scope_department_id" is null and "core"."role_assignments"."scope_record_id" is null)
       or ("core"."role_assignments"."scope_type" = 'department' and "core"."role_assignments"."scope_department_id" is not null)
       or ("core"."role_assignments"."scope_type" = 'record' and "core"."role_assignments"."scope_record_type" is not null and "core"."role_assignments"."scope_record_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "core"."role_permissions" (
	"role_id" uuid NOT NULL,
	"permission" varchar(200) NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_pk" PRIMARY KEY("role_id","permission")
);
--> statement-breakpoint
CREATE TABLE "core"."roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"application_id" uuid NOT NULL,
	"key" varchar(100) NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"module_id" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."audit_logs" (
	"seq" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "core"."audit_logs_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"event_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" varchar(20) NOT NULL,
	"actor_id" uuid,
	"actor_name" varchar(200),
	"on_behalf_of_id" uuid,
	"action" varchar(200) NOT NULL,
	"category" varchar(20) DEFAULT 'data' NOT NULL,
	"module_id" varchar(64),
	"entity_type" varchar(100),
	"entity_id" varchar(200),
	"entity_label" varchar(300),
	"changes" jsonb,
	"metadata" jsonb,
	"outcome" varchar(20) DEFAULT 'success' NOT NULL,
	"ip" varchar(64),
	"user_agent" text,
	"request_id" varchar(64),
	"trace_id" varchar(64),
	"hash" varchar(64) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."module_settings" (
	"module_id" varchar(64) NOT NULL,
	"key" varchar(200) NOT NULL,
	"value" jsonb,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "module_settings_module_id_key_pk" PRIMARY KEY("module_id","key")
);
--> statement-breakpoint
CREATE TABLE "core"."modules" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"version" varchar(32) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"system" boolean DEFAULT false NOT NULL,
	"manifest" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"enabled_changed_at" timestamp with time zone,
	"enabled_changed_by" uuid
);
--> statement-breakpoint
CREATE TABLE "core"."outbox_events" (
	"seq" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "core"."outbox_events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"event_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"module_id" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"actor" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "core"."departments" ADD CONSTRAINT "departments_parent_id_departments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "core"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."departments" ADD CONSTRAINT "departments_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "core"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."group_members" ADD CONSTRAINT "group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."groups" ADD CONSTRAINT "groups_idp_id_identity_providers_id_fk" FOREIGN KEY ("idp_id") REFERENCES "core"."identity_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."identity_providers" ADD CONSTRAINT "identity_providers_default_department_id_departments_id_fk" FOREIGN KEY ("default_department_id") REFERENCES "core"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."sessions" ADD CONSTRAINT "sessions_idp_id_identity_providers_id_fk" FOREIGN KEY ("idp_id") REFERENCES "core"."identity_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."user_identities" ADD CONSTRAINT "user_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."user_identities" ADD CONSTRAINT "user_identities_idp_id_identity_providers_id_fk" FOREIGN KEY ("idp_id") REFERENCES "core"."identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."users" ADD CONSTRAINT "users_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "core"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."users" ADD CONSTRAINT "users_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."applications" ADD CONSTRAINT "applications_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."permissions" ADD CONSTRAINT "permissions_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "core"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."role_assignments" ADD CONSTRAINT "role_assignments_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "core"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."role_assignments" ADD CONSTRAINT "role_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."role_assignments" ADD CONSTRAINT "role_assignments_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "core"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."role_assignments" ADD CONSTRAINT "role_assignments_scope_department_id_departments_id_fk" FOREIGN KEY ("scope_department_id") REFERENCES "core"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."role_assignments" ADD CONSTRAINT "role_assignments_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "core"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."roles" ADD CONSTRAINT "roles_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "core"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."module_settings" ADD CONSTRAINT "module_settings_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "core"."modules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "departments_code_uq" ON "core"."departments" USING btree ("code");--> statement-breakpoint
CREATE INDEX "departments_parent_idx" ON "core"."departments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "departments_path_idx" ON "core"."departments" USING btree ("path" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "group_members_user_idx" ON "core"."group_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_key_uq" ON "core"."groups" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_external_uq" ON "core"."groups" USING btree ("idp_id","external_id") WHERE "core"."groups"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "groups_name_trgm" ON "core"."groups" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "identity_providers_key_uq" ON "core"."identity_providers" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_uq" ON "core"."sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "core"."sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "core"."sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_identities_subject_uq" ON "core"."user_identities" USING btree ("idp_id","subject");--> statement-breakpoint
CREATE INDEX "user_identities_user_idx" ON "core"."user_identities" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "core"."users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_uq" ON "core"."users" USING btree (lower("username"));--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "core"."users" USING btree ("status");--> statement-breakpoint
CREATE INDEX "users_department_idx" ON "core"."users" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "users_manager_idx" ON "core"."users" USING btree ("manager_id");--> statement-breakpoint
CREATE INDEX "users_created_idx" ON "core"."users" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "users_display_name_trgm" ON "core"."users" USING gin ("display_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "users_email_trgm" ON "core"."users" USING gin ("email" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "applications_key_uq" ON "core"."applications" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "permissions_app_key_uq" ON "core"."permissions" USING btree ("application_id","key");--> statement-breakpoint
CREATE INDEX "role_assignments_user_idx" ON "core"."role_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "role_assignments_group_idx" ON "core"."role_assignments" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "role_assignments_role_idx" ON "core"."role_assignments" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "role_assignments_expires_idx" ON "core"."role_assignments" USING btree ("expires_at") WHERE "core"."role_assignments"."expires_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "roles_app_key_uq" ON "core"."roles" USING btree ("application_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_logs_event_uq" ON "core"."audit_logs" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "audit_logs_occurred_idx" ON "core"."audit_logs" USING btree ("occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "core"."audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "core"."audit_logs" USING btree ("actor_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "core"."audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_logs_module_idx" ON "core"."audit_logs" USING btree ("module_id");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_events_event_uq" ON "core"."outbox_events" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "outbox_events_pending_idx" ON "core"."outbox_events" USING btree ("seq") WHERE "core"."outbox_events"."dispatched_at" is null;