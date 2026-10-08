CREATE TABLE "itam"."approved_software" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" varchar(200) NOT NULL,
	"publisher" varchar(200),
	"version" varchar(64),
	"license_model" varchar(20) NOT NULL,
	"license_id" uuid,
	"contract_id" uuid,
	"scope" varchar(12) DEFAULT 'company' NOT NULL,
	"status" varchar(10) DEFAULT 'allowed' NOT NULL,
	"valid_until" date,
	"notes" text,
	"request_reference" varchar(40),
	"source" jsonb,
	"expiry_notified_for" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "itam"."approved_software_departments" (
	"entry_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	CONSTRAINT "approved_software_departments_entry_id_department_id_pk" PRIMARY KEY("entry_id","department_id")
);
--> statement-breakpoint
ALTER TABLE "itam"."asset_events" ADD COLUMN "request" jsonb;--> statement-breakpoint
ALTER TABLE "itam"."assets" ADD COLUMN "data_retain_until" date;--> statement-breakpoint
ALTER TABLE "itam"."assets" ADD COLUMN "wipe_due" date;--> statement-breakpoint
ALTER TABLE "itam"."assets" ADD COLUMN "wipe_reminders" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "itam"."assets" ADD COLUMN "wiped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "itam"."assets" ADD COLUMN "wiped_by" uuid;--> statement-breakpoint
ALTER TABLE "itam"."assets" ADD COLUMN "wipe_method" varchar(30);--> statement-breakpoint
ALTER TABLE "itam"."approved_software" ADD CONSTRAINT "approved_software_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "itam"."licenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itam"."approved_software" ADD CONSTRAINT "approved_software_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "itam"."contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itam"."approved_software" ADD CONSTRAINT "approved_software_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itam"."approved_software_departments" ADD CONSTRAINT "approved_software_departments_entry_id_approved_software_id_fk" FOREIGN KEY ("entry_id") REFERENCES "itam"."approved_software"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itam"."approved_software_departments" ADD CONSTRAINT "approved_software_departments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "core"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approved_software_title_idx" ON "itam"."approved_software" USING btree (lower("title"));--> statement-breakpoint
CREATE INDEX "approved_software_title_trgm" ON "itam"."approved_software" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "approved_software_status_idx" ON "itam"."approved_software" USING btree ("status","valid_until");--> statement-breakpoint
CREATE INDEX "approved_software_valid_until_idx" ON "itam"."approved_software" USING btree ("valid_until") WHERE "itam"."approved_software"."valid_until" is not null;--> statement-breakpoint
CREATE INDEX "approved_software_license_idx" ON "itam"."approved_software" USING btree ("license_id");--> statement-breakpoint
CREATE INDEX "approved_software_contract_idx" ON "itam"."approved_software" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "approved_software_updated_idx" ON "itam"."approved_software" USING btree ("updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "approved_software_run_idx" ON "itam"."approved_software" USING btree (("source"->>'runId')) WHERE "itam"."approved_software"."source" is not null;--> statement-breakpoint
CREATE INDEX "approved_software_departments_dept_idx" ON "itam"."approved_software_departments" USING btree ("department_id");--> statement-breakpoint
ALTER TABLE "itam"."assets" ADD CONSTRAINT "assets_wiped_by_users_id_fk" FOREIGN KEY ("wiped_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_events_run_idx" ON "itam"."asset_events" USING btree (("request"->>'runId')) WHERE "itam"."asset_events"."request" is not null;--> statement-breakpoint
CREATE INDEX "assets_wipe_due_idx" ON "itam"."assets" USING btree ("wipe_due") WHERE "itam"."assets"."wipe_due" is not null;