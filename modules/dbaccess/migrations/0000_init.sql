CREATE SCHEMA "dbaccess";
--> statement-breakpoint
CREATE SEQUENCE "dbaccess"."request_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "dbaccess"."review_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "dbaccess"."accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"server_id" uuid NOT NULL,
	"user_id" uuid,
	"name" varchar(160) NOT NULL,
	"auth_mode" varchar(16) NOT NULL,
	"created_by_platform" boolean DEFAULT false NOT NULL,
	"status" varchar(12) DEFAULT 'active' NOT NULL,
	"disabled_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dbaccess"."grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"server_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"user_id" uuid,
	"request_id" uuid,
	"account_id" uuid,
	"account_name" varchar(160),
	"source" varchar(12) DEFAULT 'request' NOT NULL,
	"status" varchar(16) DEFAULT 'provisioning' NOT NULL,
	"operation" varchar(8) DEFAULT 'grant' NOT NULL,
	"expires_at" timestamp with time zone,
	"granted_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"end_reason" varchar(16),
	"end_note" text,
	"ended_by" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_error" text,
	"expiry_reminded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dbaccess"."inventory_accounts" (
	"server_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"kind" varchar(60),
	"enabled" boolean DEFAULT true NOT NULL,
	"created_on" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"synced_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dbaccess"."inventory_memberships" (
	"server_id" uuid NOT NULL,
	"database" varchar(128) DEFAULT '' NOT NULL,
	"role_name" varchar(128) NOT NULL,
	"member_name" varchar(160) NOT NULL,
	"synced_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dbaccess"."inventory_roles" (
	"server_id" uuid NOT NULL,
	"database" varchar(128) DEFAULT '' NOT NULL,
	"name" varchar(128) NOT NULL,
	"synced_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dbaccess"."roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"server_id" uuid NOT NULL,
	"database" varchar(128) DEFAULT '' NOT NULL,
	"role_name" varchar(128) NOT NULL,
	"name" jsonb NOT NULL,
	"description" jsonb,
	"owner_user_id" uuid,
	"owner_group_id" uuid,
	"risk" varchar(8) DEFAULT 'medium' NOT NULL,
	"default_days" integer,
	"max_days" integer,
	"allow_permanent" boolean DEFAULT false NOT NULL,
	"justification_required" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dbaccess"."requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" integer DEFAULT nextval('dbaccess.request_number_seq') NOT NULL,
	"requester_id" uuid,
	"role_id" uuid NOT NULL,
	"server_id" uuid NOT NULL,
	"expires_on" date,
	"time_zone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"justification" text DEFAULT '' NOT NULL,
	"status" varchar(12) DEFAULT 'pending' NOT NULL,
	"extension_of" uuid,
	"instance_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_comment" text,
	"grant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dbaccess"."reveals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"grant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"secret_sealed" text,
	"expires_at" timestamp with time zone NOT NULL,
	"viewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dbaccess"."review_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"review_id" uuid NOT NULL,
	"grant_id" uuid NOT NULL,
	"reviewer_user_id" uuid,
	"reviewer_group_id" uuid,
	"decision" varchar(8),
	"comment" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"outcome" varchar(8),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dbaccess"."reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" integer DEFAULT nextval('dbaccess.review_number_seq') NOT NULL,
	"name" varchar(200) NOT NULL,
	"server_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"min_risk" varchar(8) DEFAULT 'low' NOT NULL,
	"reviewer_rule" varchar(8) DEFAULT 'owner' NOT NULL,
	"start_on" date NOT NULL,
	"due_on" date NOT NULL,
	"policy" varchar(8) DEFAULT 'revoke' NOT NULL,
	"recurrence" varchar(12) DEFAULT 'none' NOT NULL,
	"status" varchar(12) DEFAULT 'scheduled' NOT NULL,
	"started_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	"previous_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dbaccess"."servers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"connection_id" uuid NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"engine" varchar(16) NOT NULL,
	"environment" varchar(16) DEFAULT 'production' NOT NULL,
	"account_pattern" varchar(60) DEFAULT '{username}' NOT NULL,
	"auth_mode" varchar(16) DEFAULT 'password' NOT NULL,
	"windows_domain" varchar(15),
	"password_length" integer DEFAULT 24 NOT NULL,
	"auto_sync" boolean DEFAULT true NOT NULL,
	"owner_group_id" uuid,
	"last_sync_at" timestamp with time zone,
	"last_sync_status" varchar(8),
	"last_sync_error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dbaccess"."accounts" ADD CONSTRAINT "accounts_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "dbaccess"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dbaccess"."accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dbaccess"."grants" ADD CONSTRAINT "grants_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "dbaccess"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dbaccess"."grants" ADD CONSTRAINT "grants_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "dbaccess"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dbaccess"."grants" ADD CONSTRAINT "grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dbaccess"."grants" ADD CONSTRAINT "grants_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "dbaccess"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dbaccess"."grants" ADD CONSTRAINT "grants_ended_by_users_id_fk" FOREIGN KEY ("ended_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dbaccess"."inventory_accounts" ADD CONSTRAINT "inventory_accounts_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "dbaccess"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dbaccess"."inventory_memberships" ADD CONSTRAINT "inventory_memberships_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "dbaccess"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dbaccess"."inventory_roles" ADD CONSTRAINT "inventory_roles_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "dbaccess"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dbaccess"."roles" ADD CONSTRAINT "roles_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "dbaccess"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dbaccess"."roles" ADD CONSTRAINT "roles_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dbaccess"."roles" ADD CONSTRAINT "roles_owner_group_id_groups_id_fk" FOREIGN KEY ("owner_group_id") REFERENCES "core"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dbaccess"."requests" ADD CONSTRAINT "requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dbaccess"."requests" ADD CONSTRAINT "requests_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "dbaccess"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dbaccess"."requests" ADD CONSTRAINT "requests_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "dbaccess"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dbaccess"."reveals" ADD CONSTRAINT "reveals_grant_id_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "dbaccess"."grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dbaccess"."reveals" ADD CONSTRAINT "reveals_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "dbaccess"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dbaccess"."reveals" ADD CONSTRAINT "reveals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dbaccess"."review_items" ADD CONSTRAINT "review_items_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "dbaccess"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dbaccess"."review_items" ADD CONSTRAINT "review_items_grant_id_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "dbaccess"."grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dbaccess"."review_items" ADD CONSTRAINT "review_items_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dbaccess"."review_items" ADD CONSTRAINT "review_items_reviewer_group_id_groups_id_fk" FOREIGN KEY ("reviewer_group_id") REFERENCES "core"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dbaccess"."review_items" ADD CONSTRAINT "review_items_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dbaccess"."reviews" ADD CONSTRAINT "reviews_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dbaccess"."servers" ADD CONSTRAINT "servers_owner_group_id_groups_id_fk" FOREIGN KEY ("owner_group_id") REFERENCES "core"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dbaccess"."servers" ADD CONSTRAINT "servers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_server_name_uq" ON "dbaccess"."accounts" USING btree ("server_id","name");--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "dbaccess"."accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "grants_user_idx" ON "dbaccess"."grants" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "grants_server_idx" ON "dbaccess"."grants" USING btree ("server_id","status");--> statement-breakpoint
CREATE INDEX "grants_role_idx" ON "dbaccess"."grants" USING btree ("role_id","status");--> statement-breakpoint
CREATE INDEX "grants_expires_idx" ON "dbaccess"."grants" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_accounts_uq" ON "dbaccess"."inventory_accounts" USING btree ("server_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_memberships_uq" ON "dbaccess"."inventory_memberships" USING btree ("server_id","database","role_name","member_name");--> statement-breakpoint
CREATE INDEX "inventory_memberships_member_idx" ON "dbaccess"."inventory_memberships" USING btree ("server_id","member_name");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_roles_uq" ON "dbaccess"."inventory_roles" USING btree ("server_id","database","name");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_server_role_uq" ON "dbaccess"."roles" USING btree ("server_id","database","role_name");--> statement-breakpoint
CREATE INDEX "roles_owner_user_idx" ON "dbaccess"."roles" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "roles_owner_group_idx" ON "dbaccess"."roles" USING btree ("owner_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "requests_number_uq" ON "dbaccess"."requests" USING btree ("number");--> statement-breakpoint
CREATE INDEX "requests_requester_idx" ON "dbaccess"."requests" USING btree ("requester_id","status");--> statement-breakpoint
CREATE INDEX "requests_role_idx" ON "dbaccess"."requests" USING btree ("role_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "requests_pending_uq" ON "dbaccess"."requests" USING btree ("requester_id","role_id") WHERE "dbaccess"."requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "reveals_grant_idx" ON "dbaccess"."reveals" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "reveals_user_idx" ON "dbaccess"."reveals" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_items_uq" ON "dbaccess"."review_items" USING btree ("review_id","grant_id");--> statement-breakpoint
CREATE INDEX "review_items_user_idx" ON "dbaccess"."review_items" USING btree ("reviewer_user_id");--> statement-breakpoint
CREATE INDEX "review_items_group_idx" ON "dbaccess"."review_items" USING btree ("reviewer_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_number_uq" ON "dbaccess"."reviews" USING btree ("number");--> statement-breakpoint
CREATE INDEX "reviews_status_idx" ON "dbaccess"."reviews" USING btree ("status","due_on");--> statement-breakpoint
CREATE UNIQUE INDEX "servers_connection_uq" ON "dbaccess"."servers" USING btree ("connection_id");