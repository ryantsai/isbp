CREATE TABLE "itam"."discovery_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"asset_id" uuid NOT NULL,
	"source" varchar(10) NOT NULL,
	"file_name" varchar(255),
	"reported" integer NOT NULL,
	"added" integer NOT NULL,
	"updated" integer NOT NULL,
	"removed" integer NOT NULL,
	"actor_id" uuid,
	"actor_name" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "itam"."software_title_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" varchar(200) NOT NULL,
	"license_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "itam"."software_installations" ADD COLUMN "reported_as" varchar(200);--> statement-breakpoint
ALTER TABLE "itam"."discovery_reports" ADD CONSTRAINT "discovery_reports_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "itam"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itam"."discovery_reports" ADD CONSTRAINT "discovery_reports_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itam"."software_title_rules" ADD CONSTRAINT "software_title_rules_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "itam"."licenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itam"."software_title_rules" ADD CONSTRAINT "software_title_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "core"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discovery_reports_created_idx" ON "itam"."discovery_reports" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "discovery_reports_asset_idx" ON "itam"."discovery_reports" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "software_title_rules_title_uq" ON "itam"."software_title_rules" USING btree (lower("title"));--> statement-breakpoint
CREATE INDEX "software_title_rules_license_idx" ON "itam"."software_title_rules" USING btree ("license_id");--> statement-breakpoint
CREATE INDEX "software_title_rules_created_idx" ON "itam"."software_title_rules" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "software_installations_reported_as_idx" ON "itam"."software_installations" USING btree (lower("reported_as")) WHERE "itam"."software_installations"."reported_as" is not null;--> statement-breakpoint
CREATE INDEX "software_installations_seen_idx" ON "itam"."software_installations" USING btree ("last_seen_at" DESC NULLS LAST);