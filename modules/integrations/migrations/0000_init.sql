CREATE SCHEMA "integrations";
--> statement-breakpoint
CREATE TABLE "integrations"."comment_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"link_id" uuid NOT NULL,
	"local_id" varchar(200) NOT NULL,
	"remote_id" varchar(200) NOT NULL,
	"origin" varchar(8) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations"."conflicts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"link_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"entity" varchar(100) NOT NULL,
	"local_id" varchar(200) NOT NULL,
	"remote_ref" varchar(200),
	"status" varchar(12) DEFAULT 'open' NOT NULL,
	"fields" jsonb NOT NULL,
	"choices" jsonb,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conflicts_status_ck" CHECK ("integrations"."conflicts"."status" in ('open', 'resolved', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE "integrations"."connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"type" varchar(100) NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secrets_sealed" text,
	"secret_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"webhook_secret_hash" varchar(64),
	"webhook_rotated_at" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"allow_insecure_http" boolean DEFAULT false NOT NULL,
	"health" varchar(16) DEFAULT 'unknown' NOT NULL,
	"health_message" text,
	"account" varchar(300),
	"last_checked_at" timestamp with time zone,
	"failing_notified_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connections_health_ck" CHECK ("integrations"."connections"."health" in ('unknown', 'ok', 'failing'))
);
--> statement-breakpoint
CREATE TABLE "integrations"."links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"entity" varchar(100) NOT NULL,
	"local_id" varchar(200),
	"local_ref" varchar(100),
	"local_title" varchar(500),
	"remote_id" varchar(200) NOT NULL,
	"remote_ref" varchar(200),
	"remote_title" varchar(500),
	"remote_url" text,
	"remote_version" varchar(200),
	"remote_updated_at" timestamp with time zone,
	"origin" varchar(8) NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" varchar(12) DEFAULT 'ok' NOT NULL,
	"last_error" jsonb,
	"last_synced_at" timestamp with time zone,
	"rev" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "links_state_ck" CHECK ("integrations"."links"."state" in ('ok', 'conflict', 'error', 'orphaned'))
);
--> statement-breakpoint
CREATE TABLE "integrations"."pending_pushes" (
	"profile_id" uuid NOT NULL,
	"local_id" varchar(200) NOT NULL,
	"kind" varchar(8) NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations"."profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"connection_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"object_type" varchar(64) NOT NULL,
	"remote_scope" varchar(300),
	"remote_scope_name" varchar(300),
	"entity" varchar(100) NOT NULL,
	"container_id" varchar(200),
	"container_label" varchar(300),
	"direction" varchar(8) DEFAULT 'pull' NOT NULL,
	"create_local" boolean DEFAULT true NOT NULL,
	"create_remote" boolean DEFAULT false NOT NULL,
	"match_rule" jsonb,
	"push_filter" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mappings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conflict_policy" varchar(8) DEFAULT 'manual' NOT NULL,
	"comments" boolean DEFAULT false NOT NULL,
	"interval_minutes" integer DEFAULT 15 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"cursor" text,
	"next_run_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_direction_ck" CHECK ("integrations"."profiles"."direction" in ('pull', 'push', 'both')),
	CONSTRAINT "profiles_policy_ck" CHECK ("integrations"."profiles"."conflict_policy" in ('manual', 'remote', 'local', 'newest'))
);
--> statement-breakpoint
CREATE TABLE "integrations"."runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"kind" varchar(12) NOT NULL,
	"trigger" varchar(12) NOT NULL,
	"status" varchar(12) DEFAULT 'queued' NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"counts" jsonb NOT NULL,
	"log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"log_dropped" integer DEFAULT 0 NOT NULL,
	"error" text,
	"error_code" varchar(64),
	"triggered_by" uuid,
	"resume_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runs_status_ck" CHECK ("integrations"."runs"."status" in ('queued', 'running', 'waiting', 'succeeded', 'partial', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "integrations"."comment_links" ADD CONSTRAINT "comment_links_link_id_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "integrations"."links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations"."conflicts" ADD CONSTRAINT "conflicts_link_id_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "integrations"."links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations"."conflicts" ADD CONSTRAINT "conflicts_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "integrations"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations"."conflicts" ADD CONSTRAINT "conflicts_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "integrations"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations"."conflicts" ADD CONSTRAINT "conflicts_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations"."connections" ADD CONSTRAINT "connections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations"."connections" ADD CONSTRAINT "connections_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations"."links" ADD CONSTRAINT "links_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "integrations"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations"."links" ADD CONSTRAINT "links_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "integrations"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations"."pending_pushes" ADD CONSTRAINT "pending_pushes_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "integrations"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations"."profiles" ADD CONSTRAINT "profiles_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "integrations"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations"."profiles" ADD CONSTRAINT "profiles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations"."profiles" ADD CONSTRAINT "profiles_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations"."runs" ADD CONSTRAINT "runs_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "integrations"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations"."runs" ADD CONSTRAINT "runs_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "integrations"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations"."runs" ADD CONSTRAINT "runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comment_links_local_uq" ON "integrations"."comment_links" USING btree ("link_id","local_id");--> statement-breakpoint
CREATE UNIQUE INDEX "comment_links_remote_uq" ON "integrations"."comment_links" USING btree ("link_id","remote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conflicts_open_uq" ON "integrations"."conflicts" USING btree ("link_id") WHERE "integrations"."conflicts"."status" = 'open';--> statement-breakpoint
CREATE INDEX "conflicts_connection_status_idx" ON "integrations"."conflicts" USING btree ("connection_id","status","created_at");--> statement-breakpoint
CREATE INDEX "conflicts_profile_status_idx" ON "integrations"."conflicts" USING btree ("profile_id","status");--> statement-breakpoint
CREATE INDEX "conflicts_status_created_idx" ON "integrations"."conflicts" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "connections_name_uq" ON "integrations"."connections" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "connections_type_idx" ON "integrations"."connections" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "links_profile_remote_uq" ON "integrations"."links" USING btree ("profile_id","remote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "links_profile_local_uq" ON "integrations"."links" USING btree ("profile_id","local_id");--> statement-breakpoint
CREATE INDEX "links_record_idx" ON "integrations"."links" USING btree ("entity","local_id");--> statement-breakpoint
CREATE INDEX "links_connection_state_idx" ON "integrations"."links" USING btree ("connection_id","state");--> statement-breakpoint
CREATE INDEX "links_profile_state_idx" ON "integrations"."links" USING btree ("profile_id","state");--> statement-breakpoint
CREATE INDEX "links_connection_remote_idx" ON "integrations"."links" USING btree ("connection_id","entity","remote_id");--> statement-breakpoint
CREATE INDEX "links_synced_idx" ON "integrations"."links" USING btree ("connection_id","last_synced_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pending_pushes_uq" ON "integrations"."pending_pushes" USING btree ("profile_id","local_id","kind");--> statement-breakpoint
CREATE INDEX "pending_pushes_queued_idx" ON "integrations"."pending_pushes" USING btree ("queued_at");--> statement-breakpoint
CREATE INDEX "profiles_connection_idx" ON "integrations"."profiles" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "profiles_entity_idx" ON "integrations"."profiles" USING btree ("entity");--> statement-breakpoint
CREATE INDEX "profiles_due_idx" ON "integrations"."profiles" USING btree ("next_run_at") WHERE "integrations"."profiles"."enabled" and "integrations"."profiles"."interval_minutes" > 0;--> statement-breakpoint
CREATE INDEX "runs_profile_created_idx" ON "integrations"."runs" USING btree ("profile_id","created_at");--> statement-breakpoint
CREATE INDEX "runs_connection_created_idx" ON "integrations"."runs" USING btree ("connection_id","created_at");--> statement-breakpoint
CREATE INDEX "runs_created_idx" ON "integrations"."runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "runs_active_idx" ON "integrations"."runs" USING btree ("status") WHERE "integrations"."runs"."status" in ('queued', 'running', 'waiting');--> statement-breakpoint
CREATE UNIQUE INDEX "runs_one_sync_uq" ON "integrations"."runs" USING btree ("profile_id") WHERE "integrations"."runs"."status" in ('queued', 'running', 'waiting') and "integrations"."runs"."kind" in ('pull', 'export');