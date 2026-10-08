CREATE SCHEMA "isms";
--> statement-breakpoint
CREATE SEQUENCE "isms"."account_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "isms"."review_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "isms"."stocktake_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "isms"."account_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" varchar(24) NOT NULL,
	"user_id" uuid,
	"note" text,
	"data" jsonb,
	"dedupe_key" varchar(100),
	"actor_id" uuid,
	"actor_name" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "isms"."account_members" (
	"account_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"added_by" uuid,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_members_account_id_user_id_pk" PRIMARY KEY("account_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "isms"."asset_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"asset_id" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"changes" jsonb,
	"note" text,
	"actor_id" uuid,
	"actor_name" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "isms"."assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" varchar(20) NOT NULL,
	"name" varchar(200) NOT NULL,
	"class_id" uuid NOT NULL,
	"subclass_id" uuid,
	"site_id" uuid NOT NULL,
	"manager_id" uuid,
	"manager_group_id" uuid,
	"user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"users_text" varchar(500),
	"location" varchar(200),
	"brand" varchar(100),
	"model" varchar(100),
	"version" varchar(100),
	"quantity" integer DEFAULT 1 NOT NULL,
	"confidentiality" smallint NOT NULL,
	"integrity" smallint NOT NULL,
	"availability" smallint NOT NULL,
	"value" smallint NOT NULL,
	"label_id" uuid,
	"status" varchar(12) DEFAULT 'active' NOT NULL,
	"notes" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_ref" varchar(200),
	"last_verified_on" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_cia" CHECK ("isms"."assets"."confidentiality" between 1 and 4 and "isms"."assets"."integrity" between 1 and 4
      and "isms"."assets"."availability" between 1 and 4 and "isms"."assets"."value" = greatest("isms"."assets"."confidentiality", "isms"."assets"."integrity", "isms"."assets"."availability"))
);
--> statement-breakpoint
CREATE TABLE "isms"."classes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" varchar(4) NOT NULL,
	"name" jsonb NOT NULL,
	"description" jsonb,
	"guidance" jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "isms"."labels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" varchar(40) NOT NULL,
	"name" jsonb NOT NULL,
	"description" jsonb,
	"rank" integer DEFAULT 0 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "isms"."number_counters" (
	"prefix" varchar(12) PRIMARY KEY NOT NULL,
	"last" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "isms"."review_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"review_id" uuid NOT NULL,
	"account_name" varchar(200) NOT NULL,
	"user_name" varchar(200),
	"user_id" uuid,
	"privilege" varchar(10) DEFAULT 'user' NOT NULL,
	"account_status" varchar(10) DEFAULT 'enabled' NOT NULL,
	"detail" varchar(500),
	"decision" varchar(10),
	"done_on" date,
	"note" text,
	"ticket_id" varchar(64),
	"ticket_ref" varchar(64),
	"ticket_href" varchar(300),
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "isms"."reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" bigint DEFAULT nextval('isms.review_number_seq') NOT NULL,
	"target" varchar(200) NOT NULL,
	"target_ref" varchar(200),
	"reviewer_id" uuid,
	"start_on" date NOT NULL,
	"due_on" date NOT NULL,
	"status" varchar(12) DEFAULT 'open' NOT NULL,
	"source" varchar(12) DEFAULT 'manual' NOT NULL,
	"application_id" uuid,
	"recurrence" varchar(10) DEFAULT 'none' NOT NULL,
	"previous_id" uuid,
	"reminded_on" date,
	"overdue_notified_on" date,
	"created_by" uuid,
	"completed_by" uuid,
	"completed_at" timestamp with time zone,
	"signed_off_by" uuid,
	"signed_off_at" timestamp with time zone,
	"sign_off_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "isms"."shared_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" bigint DEFAULT nextval('isms.account_number_seq') NOT NULL,
	"account_name" varchar(200) NOT NULL,
	"target_system" varchar(200),
	"target_ref" varchar(200),
	"custodian_id" uuid,
	"department_id" uuid,
	"purpose" text,
	"project" varchar(200),
	"request_reference" varchar(64),
	"last_password_change_on" date,
	"password_due_since" timestamp with time zone,
	"password_due_reason" varchar(20),
	"password_due_user_id" uuid,
	"status" varchar(10) DEFAULT 'active' NOT NULL,
	"next_review_on" date,
	"review_notified_on" date,
	"last_reviewed_on" date,
	"last_reviewed_by" uuid,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "isms"."sites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" varchar(8) NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "isms"."stocktake_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"stocktake_id" uuid NOT NULL,
	"asset_id" uuid,
	"snapshot" jsonb NOT NULL,
	"assignee_id" uuid,
	"assignee_group_id" uuid,
	"result" varchar(12),
	"changes" jsonb,
	"note" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "isms"."stocktakes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" bigint DEFAULT nextval('isms.stocktake_number_seq') NOT NULL,
	"name" varchar(200) NOT NULL,
	"status" varchar(12) NOT NULL,
	"scope" jsonb NOT NULL,
	"start_on" date NOT NULL,
	"due_on" date NOT NULL,
	"recurrence" varchar(10) DEFAULT 'none' NOT NULL,
	"previous_id" uuid,
	"reminded_on" date,
	"overdue_notified_on" date,
	"ready_notified_at" timestamp with time zone,
	"created_by" uuid,
	"signed_off_by" uuid,
	"signed_off_at" timestamp with time zone,
	"sign_off_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "isms"."subclasses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"class_id" uuid NOT NULL,
	"key" varchar(40) NOT NULL,
	"name" jsonb NOT NULL,
	"description" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "isms"."account_events" ADD CONSTRAINT "account_events_account_id_shared_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "isms"."shared_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isms"."account_events" ADD CONSTRAINT "account_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isms"."account_events" ADD CONSTRAINT "account_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isms"."account_members" ADD CONSTRAINT "account_members_account_id_shared_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "isms"."shared_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isms"."account_members" ADD CONSTRAINT "account_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isms"."account_members" ADD CONSTRAINT "account_members_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isms"."asset_events" ADD CONSTRAINT "asset_events_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "isms"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isms"."asset_events" ADD CONSTRAINT "asset_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isms"."assets" ADD CONSTRAINT "assets_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "isms"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isms"."assets" ADD CONSTRAINT "assets_subclass_id_subclasses_id_fk" FOREIGN KEY ("subclass_id") REFERENCES "isms"."subclasses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isms"."assets" ADD CONSTRAINT "assets_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "isms"."sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isms"."assets" ADD CONSTRAINT "assets_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isms"."assets" ADD CONSTRAINT "assets_manager_group_id_groups_id_fk" FOREIGN KEY ("manager_group_id") REFERENCES "core"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isms"."assets" ADD CONSTRAINT "assets_label_id_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "isms"."labels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isms"."assets" ADD CONSTRAINT "assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isms"."review_items" ADD CONSTRAINT "review_items_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "isms"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isms"."review_items" ADD CONSTRAINT "review_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isms"."review_items" ADD CONSTRAINT "review_items_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isms"."reviews" ADD CONSTRAINT "reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isms"."reviews" ADD CONSTRAINT "reviews_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isms"."reviews" ADD CONSTRAINT "reviews_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isms"."reviews" ADD CONSTRAINT "reviews_signed_off_by_users_id_fk" FOREIGN KEY ("signed_off_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isms"."shared_accounts" ADD CONSTRAINT "shared_accounts_custodian_id_users_id_fk" FOREIGN KEY ("custodian_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isms"."shared_accounts" ADD CONSTRAINT "shared_accounts_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "core"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isms"."shared_accounts" ADD CONSTRAINT "shared_accounts_password_due_user_id_users_id_fk" FOREIGN KEY ("password_due_user_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isms"."shared_accounts" ADD CONSTRAINT "shared_accounts_last_reviewed_by_users_id_fk" FOREIGN KEY ("last_reviewed_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isms"."shared_accounts" ADD CONSTRAINT "shared_accounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isms"."stocktake_items" ADD CONSTRAINT "stocktake_items_stocktake_id_stocktakes_id_fk" FOREIGN KEY ("stocktake_id") REFERENCES "isms"."stocktakes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isms"."stocktake_items" ADD CONSTRAINT "stocktake_items_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "isms"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isms"."stocktake_items" ADD CONSTRAINT "stocktake_items_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isms"."stocktake_items" ADD CONSTRAINT "stocktake_items_assignee_group_id_groups_id_fk" FOREIGN KEY ("assignee_group_id") REFERENCES "core"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isms"."stocktake_items" ADD CONSTRAINT "stocktake_items_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isms"."stocktakes" ADD CONSTRAINT "stocktakes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isms"."stocktakes" ADD CONSTRAINT "stocktakes_signed_off_by_users_id_fk" FOREIGN KEY ("signed_off_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isms"."subclasses" ADD CONSTRAINT "subclasses_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "isms"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_events_account_idx" ON "isms"."account_events" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "account_events_dedupe_uq" ON "isms"."account_events" USING btree ("account_id","dedupe_key") WHERE "isms"."account_events"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "account_members_user_idx" ON "isms"."account_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "asset_events_asset_idx" ON "isms"."asset_events" USING btree ("asset_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_number_uq" ON "isms"."assets" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_source_uq" ON "isms"."assets" USING btree ("source_ref") WHERE "isms"."assets"."source_ref" is not null;--> statement-breakpoint
CREATE INDEX "assets_class_idx" ON "isms"."assets" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX "assets_subclass_idx" ON "isms"."assets" USING btree ("subclass_id");--> statement-breakpoint
CREATE INDEX "assets_site_idx" ON "isms"."assets" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "assets_manager_idx" ON "isms"."assets" USING btree ("manager_id");--> statement-breakpoint
CREATE INDEX "assets_manager_group_idx" ON "isms"."assets" USING btree ("manager_group_id");--> statement-breakpoint
CREATE INDEX "assets_label_idx" ON "isms"."assets" USING btree ("label_id");--> statement-breakpoint
CREATE INDEX "assets_status_value_idx" ON "isms"."assets" USING btree ("status","value");--> statement-breakpoint
CREATE INDEX "assets_name_idx" ON "isms"."assets" USING btree ("name");--> statement-breakpoint
CREATE INDEX "assets_updated_idx" ON "isms"."assets" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "assets_attributes_gin" ON "isms"."assets" USING gin ("attributes" jsonb_path_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "classes_code_uq" ON "isms"."classes" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "labels_key_uq" ON "isms"."labels" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "review_items_account_uq" ON "isms"."review_items" USING btree ("review_id",lower("account_name"));--> statement-breakpoint
CREATE INDEX "review_items_review_idx" ON "isms"."review_items" USING btree ("review_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_number_uq" ON "isms"."reviews" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_previous_uq" ON "isms"."reviews" USING btree ("previous_id") WHERE "isms"."reviews"."previous_id" is not null;--> statement-breakpoint
CREATE INDEX "reviews_status_idx" ON "isms"."reviews" USING btree ("status","due_on");--> statement-breakpoint
CREATE INDEX "reviews_reviewer_idx" ON "isms"."reviews" USING btree ("reviewer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shared_accounts_number_uq" ON "isms"."shared_accounts" USING btree ("number");--> statement-breakpoint
CREATE INDEX "shared_accounts_custodian_idx" ON "isms"."shared_accounts" USING btree ("custodian_id");--> statement-breakpoint
CREATE INDEX "shared_accounts_status_idx" ON "isms"."shared_accounts" USING btree ("status","account_name");--> statement-breakpoint
CREATE INDEX "shared_accounts_due_idx" ON "isms"."shared_accounts" USING btree ("password_due_since") WHERE "isms"."shared_accounts"."password_due_since" is not null;--> statement-breakpoint
CREATE INDEX "shared_accounts_review_idx" ON "isms"."shared_accounts" USING btree ("next_review_on");--> statement-breakpoint
CREATE UNIQUE INDEX "sites_code_uq" ON "isms"."sites" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "stocktake_items_asset_uq" ON "isms"."stocktake_items" USING btree ("stocktake_id","asset_id");--> statement-breakpoint
CREATE INDEX "stocktake_items_stocktake_idx" ON "isms"."stocktake_items" USING btree ("stocktake_id","result");--> statement-breakpoint
CREATE INDEX "stocktake_items_assignee_idx" ON "isms"."stocktake_items" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "stocktake_items_group_idx" ON "isms"."stocktake_items" USING btree ("assignee_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stocktakes_number_uq" ON "isms"."stocktakes" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "stocktakes_previous_uq" ON "isms"."stocktakes" USING btree ("previous_id") WHERE "isms"."stocktakes"."previous_id" is not null;--> statement-breakpoint
CREATE INDEX "stocktakes_status_idx" ON "isms"."stocktakes" USING btree ("status","due_on");--> statement-breakpoint
CREATE UNIQUE INDEX "subclasses_key_uq" ON "isms"."subclasses" USING btree ("class_id","key");