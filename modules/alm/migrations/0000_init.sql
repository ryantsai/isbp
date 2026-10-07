CREATE SCHEMA "alm";
--> statement-breakpoint
CREATE TABLE "alm"."applications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" varchar(32) NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"stage" varchar(16) DEFAULT 'planned' NOT NULL,
	"criticality" varchar(16) DEFAULT 'medium' NOT NULL,
	"disposition" varchar(16),
	"business_owner_id" uuid,
	"technical_owner_id" uuid,
	"team_group_id" uuid,
	"support_group_id" uuid,
	"department_id" uuid,
	"vendor" varchar(200),
	"hosting" varchar(16) DEFAULT 'on_prem' NOT NULL,
	"ci_id" uuid,
	"tech_stack" text[] DEFAULT '{}'::text[] NOT NULL,
	"documentation_url" varchar(500),
	"data_classification" varchar(16) DEFAULT 'internal' NOT NULL,
	"go_live_date" date,
	"retire_date" date,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alm"."deployments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"application_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"release_id" uuid,
	"version" varchar(40) NOT NULL,
	"status" varchar(16) NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"deployed_by" uuid,
	"actor_name" varchar(200) NOT NULL,
	"source" varchar(8) DEFAULT 'manual' NOT NULL,
	"change_id" uuid,
	"change_reference" varchar(32),
	"override_reason" text,
	"policy_warning" varchar(32),
	"commit_sha" varchar(64),
	"pipeline_url" varchar(500),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alm"."environments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"application_id" uuid NOT NULL,
	"name" varchar(64) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"url" varchar(500),
	"ci_id" uuid,
	"sort" integer DEFAULT 0 NOT NULL,
	"current_version" varchar(40),
	"current_release_id" uuid,
	"last_deployment_id" uuid,
	"last_deployed_at" timestamp with time zone,
	"last_status" varchar(16),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alm"."releases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"application_id" uuid NOT NULL,
	"version" varchar(40) NOT NULL,
	"name" varchar(200),
	"status" varchar(16) DEFAULT 'planned' NOT NULL,
	"planned_date" date,
	"released_at" timestamp with time zone,
	"notes" text,
	"ready_notified_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alm"."repositories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"application_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"url" varchar(500) NOT NULL,
	"provider" varchar(16) DEFAULT 'other' NOT NULL,
	"default_branch" varchar(200) DEFAULT 'main' NOT NULL,
	"last_commit_sha" varchar(64),
	"last_commit_at" timestamp with time zone,
	"last_commit_message" text,
	"last_commit_author" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alm"."applications" ADD CONSTRAINT "applications_business_owner_id_users_id_fk" FOREIGN KEY ("business_owner_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alm"."applications" ADD CONSTRAINT "applications_technical_owner_id_users_id_fk" FOREIGN KEY ("technical_owner_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alm"."applications" ADD CONSTRAINT "applications_team_group_id_groups_id_fk" FOREIGN KEY ("team_group_id") REFERENCES "core"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alm"."applications" ADD CONSTRAINT "applications_support_group_id_groups_id_fk" FOREIGN KEY ("support_group_id") REFERENCES "core"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alm"."applications" ADD CONSTRAINT "applications_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "core"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alm"."applications" ADD CONSTRAINT "applications_ci_id_cis_id_fk" FOREIGN KEY ("ci_id") REFERENCES "cmdb"."cis"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alm"."applications" ADD CONSTRAINT "applications_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alm"."deployments" ADD CONSTRAINT "deployments_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "alm"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alm"."deployments" ADD CONSTRAINT "deployments_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "alm"."environments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alm"."deployments" ADD CONSTRAINT "deployments_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "alm"."releases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alm"."deployments" ADD CONSTRAINT "deployments_deployed_by_users_id_fk" FOREIGN KEY ("deployed_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alm"."environments" ADD CONSTRAINT "environments_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "alm"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alm"."environments" ADD CONSTRAINT "environments_ci_id_cis_id_fk" FOREIGN KEY ("ci_id") REFERENCES "cmdb"."cis"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alm"."releases" ADD CONSTRAINT "releases_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "alm"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alm"."releases" ADD CONSTRAINT "releases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alm"."repositories" ADD CONSTRAINT "repositories_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "alm"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "applications_code_uq" ON "alm"."applications" USING btree ("code");--> statement-breakpoint
CREATE INDEX "applications_name_idx" ON "alm"."applications" USING btree ("name");--> statement-breakpoint
CREATE INDEX "applications_name_trgm" ON "alm"."applications" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "applications_code_trgm" ON "alm"."applications" USING gin ("code" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "applications_stage_idx" ON "alm"."applications" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "applications_criticality_idx" ON "alm"."applications" USING btree ("criticality");--> statement-breakpoint
CREATE INDEX "applications_hosting_idx" ON "alm"."applications" USING btree ("hosting");--> statement-breakpoint
CREATE INDEX "applications_business_owner_idx" ON "alm"."applications" USING btree ("business_owner_id");--> statement-breakpoint
CREATE INDEX "applications_technical_owner_idx" ON "alm"."applications" USING btree ("technical_owner_id");--> statement-breakpoint
CREATE INDEX "applications_team_idx" ON "alm"."applications" USING btree ("team_group_id");--> statement-breakpoint
CREATE INDEX "applications_ci_idx" ON "alm"."applications" USING btree ("ci_id");--> statement-breakpoint
CREATE INDEX "applications_updated_idx" ON "alm"."applications" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "applications_attributes_gin" ON "alm"."applications" USING gin ("attributes" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX "deployments_app_started_idx" ON "alm"."deployments" USING btree ("application_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "deployments_env_started_idx" ON "alm"."deployments" USING btree ("environment_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "deployments_status_idx" ON "alm"."deployments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "deployments_release_idx" ON "alm"."deployments" USING btree ("release_id") WHERE "alm"."deployments"."release_id" is not null;--> statement-breakpoint
CREATE INDEX "deployments_change_idx" ON "alm"."deployments" USING btree ("change_id") WHERE "alm"."deployments"."change_id" is not null;--> statement-breakpoint
CREATE INDEX "deployments_started_idx" ON "alm"."deployments" USING btree ("started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "environments_app_name_uq" ON "alm"."environments" USING btree ("application_id","name");--> statement-breakpoint
CREATE INDEX "environments_app_sort_idx" ON "alm"."environments" USING btree ("application_id","sort");--> statement-breakpoint
CREATE INDEX "environments_kind_idx" ON "alm"."environments" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "environments_ci_idx" ON "alm"."environments" USING btree ("ci_id");--> statement-breakpoint
CREATE UNIQUE INDEX "releases_app_version_uq" ON "alm"."releases" USING btree ("application_id","version");--> statement-breakpoint
CREATE INDEX "releases_app_created_idx" ON "alm"."releases" USING btree ("application_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "releases_planned_idx" ON "alm"."releases" USING btree ("planned_date") WHERE "alm"."releases"."planned_date" is not null;--> statement-breakpoint
CREATE INDEX "releases_status_idx" ON "alm"."releases" USING btree ("status");--> statement-breakpoint
CREATE INDEX "releases_version_trgm" ON "alm"."releases" USING gin ("version" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "repositories_app_url_uq" ON "alm"."repositories" USING btree ("application_id","url");