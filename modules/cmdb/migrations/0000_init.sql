CREATE SCHEMA "cmdb";
--> statement-breakpoint
CREATE SEQUENCE "cmdb"."ci_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "cmdb"."ci_classes" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"name" jsonb NOT NULL,
	"description" jsonb,
	"icon" varchar(64) DEFAULT 'box' NOT NULL,
	"system" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cmdb"."ci_relationships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"type" varchar(32) NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ci_relationships_not_self" CHECK ("cmdb"."ci_relationships"."source_id" <> "cmdb"."ci_relationships"."target_id")
);
--> statement-breakpoint
CREATE TABLE "cmdb"."cis" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" bigint DEFAULT nextval('cmdb.ci_number_seq') NOT NULL,
	"name" varchar(200) NOT NULL,
	"class_key" varchar(64) NOT NULL,
	"status" varchar(20) DEFAULT 'in_use' NOT NULL,
	"environment" varchar(20),
	"criticality" varchar(20) DEFAULT 'medium' NOT NULL,
	"owner_id" uuid,
	"support_group_id" uuid,
	"department_id" uuid,
	"description" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cmdb"."ci_relationships" ADD CONSTRAINT "ci_relationships_source_id_cis_id_fk" FOREIGN KEY ("source_id") REFERENCES "cmdb"."cis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cmdb"."ci_relationships" ADD CONSTRAINT "ci_relationships_target_id_cis_id_fk" FOREIGN KEY ("target_id") REFERENCES "cmdb"."cis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cmdb"."ci_relationships" ADD CONSTRAINT "ci_relationships_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cmdb"."cis" ADD CONSTRAINT "cis_class_key_ci_classes_key_fk" FOREIGN KEY ("class_key") REFERENCES "cmdb"."ci_classes"("key") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "cmdb"."cis" ADD CONSTRAINT "cis_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cmdb"."cis" ADD CONSTRAINT "cis_support_group_id_groups_id_fk" FOREIGN KEY ("support_group_id") REFERENCES "core"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cmdb"."cis" ADD CONSTRAINT "cis_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "core"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ci_relationships_uq" ON "cmdb"."ci_relationships" USING btree ("source_id","target_id","type");--> statement-breakpoint
CREATE INDEX "ci_relationships_target_idx" ON "cmdb"."ci_relationships" USING btree ("target_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "cis_number_uq" ON "cmdb"."cis" USING btree ("number");--> statement-breakpoint
CREATE INDEX "cis_name_trgm" ON "cmdb"."cis" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "cis_name_idx" ON "cmdb"."cis" USING btree ("name");--> statement-breakpoint
CREATE INDEX "cis_class_status_idx" ON "cmdb"."cis" USING btree ("class_key","status");--> statement-breakpoint
CREATE INDEX "cis_owner_idx" ON "cmdb"."cis" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "cis_support_group_idx" ON "cmdb"."cis" USING btree ("support_group_id");--> statement-breakpoint
CREATE INDEX "cis_department_idx" ON "cmdb"."cis" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "cis_updated_idx" ON "cmdb"."cis" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "cis_tags_gin" ON "cmdb"."cis" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "cis_attributes_gin" ON "cmdb"."cis" USING gin ("attributes" jsonb_path_ops);